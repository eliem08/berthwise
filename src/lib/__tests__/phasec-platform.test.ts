import { describe, it, expect } from "vitest";
import { z } from "zod";
import { AuditLog } from "../audit";
import { DevMockAuthProvider, requireAction } from "../auth";
import { TokenBucketRateLimiter } from "../rate-limit";
import { MAX_BODY_BYTES, errorEnvelope, parseJsonBody, statusForError } from "../http";
import {
  approvePlan,
  generatePlan,
  supersedePlan,
  __resetPlanServiceState,
} from "../plan-service";
import { baseRequest, freshDeps } from "./phasec-fixtures";

function mockAuth(): DevMockAuthProvider {
  const provider = new DevMockAuthProvider();
  provider.addUser("tok-viewer", { id: "u-viewer", name: "Viewer", roles: ["viewer"] });
  provider.addUser("tok-planner", { id: "u-planner", name: "Planner", roles: ["planner"] });
  provider.addUser("tok-approver", { id: "u-approver", name: "Approver", roles: ["approver"] });
  provider.addUser("tok-admin", { id: "u-admin", name: "Admin", roles: ["admin"] });
  return provider;
}

describe("phase C: append-only audit trail", () => {
  it("appends events and exposes only frozen snapshots (no update/delete path)", () => {
    const log = new AuditLog();
    const e1 = log.append({ type: "plan.generated", planId: "plan_a", actor: "svc", role: "planner" });
    log.append({
      type: "plan.approved",
      planId: "plan_a",
      actor: "u-approver",
      role: "approver",
      reason: "looks good",
    });
    expect(log.count()).toBe(2);
    expect(e1.eventId).toMatch(/^evt_/);
    const snapshot = log.list();
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(() => (snapshot as unknown[]).push("tamper")).toThrow();
    expect(log.count()).toBe(2); // the log itself is untouched
    expect(log.eventsForPlan("plan_a")).toHaveLength(2);
    expect(log.eventsForPlan("plan_nope")).toHaveLength(0);
  });
});

describe("phase C: auth / RBAC adapter", () => {
  it("fails closed on unknown tokens", async () => {
    const provider = mockAuth();
    const result = await provider.authenticate("tok-ghost");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("unauthorized");
  });

  it("grants plan:approve only to approver and admin", async () => {
    const provider = mockAuth();
    for (const [token, allowed] of [
      ["tok-viewer", false],
      ["tok-planner", false],
      ["tok-approver", true],
      ["tok-admin", true],
    ] as const) {
      const auth = await provider.authenticate(token);
      expect(auth.ok).toBe(true);
      if (!auth.ok) continue;
      expect(provider.authorize(auth.value, "plan:approve"), token).toBe(allowed);
    }
  });

  it("requireAction denies closed with a structured forbidden error", async () => {
    const provider = mockAuth();
    const auth = await provider.authenticate("tok-planner");
    expect(auth.ok).toBe(true);
    if (!auth.ok) return;
    const gate = requireAction(auth.value, provider, "plan:approve");
    expect(gate.ok).toBe(false);
    if (gate.ok) return;
    expect(gate.error.code).toBe("forbidden");
    expect(statusForError(gate.error)).toBe(403);
  });
});

describe("phase C: approval flow with RBAC + audit", () => {
  it("a viewer cannot approve; an approver can, and the audit trail records it", async () => {
    const provider = mockAuth();
    const deps = freshDeps();
    const gen = generatePlan(baseRequest({ idempotencyKey: "appr-flow-1" }), deps);
    expect(gen.ok).toBe(true);
    if (!gen.ok) return;
    const planId = gen.value.planId;

    const viewer = await provider.authenticate("tok-viewer");
    expect(viewer.ok).toBe(true);
    if (!viewer.ok) return;
    const denied = approvePlan(planId, viewer.value, provider, "nope", deps);
    expect(denied.ok).toBe(false);
    if (denied.ok) return;
    expect(denied.error.code).toBe("forbidden");

    const approver = await provider.authenticate("tok-approver");
    expect(approver.ok).toBe(true);
    if (!approver.ok) return;
    const approved = approvePlan(planId, approver.value, provider, "capacity checks out", deps);
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;
    expect(approved.value.every((r) => r.status === "approved")).toBe(true);

    const events = deps.audit.eventsForPlan(planId);
    const approval = events.find((e) => e.type === "plan.approved");
    expect(approval).toBeDefined();
    expect(approval?.actor).toBe("u-approver");
    expect(approval?.role).toBe("approver");
    expect(approval?.reason).toBe("capacity checks out");

    // Approving twice is a conflict, not a silent no-op.
    const again = approvePlan(planId, approver.value, provider, "again", deps);
    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.error.code).toBe("conflict");
  });

  it("supersession links before/after plan ids with approver and reason", async () => {
    const provider = mockAuth();
    const deps = freshDeps();
    const genA = generatePlan(baseRequest({ idempotencyKey: "sup-old-1" }), deps);
    const genB = generatePlan(baseRequest({ idempotencyKey: "sup-new-1" }), deps);
    expect(genA.ok && genB.ok).toBe(true);
    if (!genA.ok || !genB.ok) return;

    const planner = await provider.authenticate("tok-planner");
    expect(planner.ok).toBe(true);
    if (!planner.ok) return;
    const result = supersedePlan(genA.value.planId, genB.value.planId, planner.value, provider, "better tides", deps);
    expect(result.ok).toBe(true);

    const events = deps.audit.list().filter((e) => e.type === "plan.superseded");
    expect(events).toHaveLength(1);
    expect(events[0].previousPlanId).toBe(genA.value.planId);
    expect(events[0].planId).toBe(genB.value.planId);
    expect(events[0].actor).toBe("u-planner");
    expect(events[0].reason).toBe("better tides");

    // A viewer cannot supersede.
    const viewer = await provider.authenticate("tok-viewer");
    expect(viewer.ok).toBe(true);
    if (!viewer.ok) return;
    const denied = supersedePlan(genB.value.planId, genA.value.planId, viewer.value, provider, "x", deps);
    expect(denied.ok).toBe(false);
    if (denied.ok) return;
    expect(denied.error.code).toBe("forbidden");
  });
});

describe("phase C: API hygiene", () => {
  it("token bucket allows bursts then denies with a retry hint", () => {
    const limiter = new TokenBucketRateLimiter({ capacity: 2, refillPerSecond: 1 });
    const t0 = 1_000_000;
    expect(limiter.tryConsume("c", t0).allowed).toBe(true);
    expect(limiter.tryConsume("c", t0).allowed).toBe(true);
    const third = limiter.tryConsume("c", t0);
    expect(third.allowed).toBe(false);
    expect(third.retryAfterMs).toBeGreaterThan(0);
    expect(third.retryAfterMs).toBeLessThanOrEqual(1000);
    // After a refill interval the bucket admits again.
    expect(limiter.tryConsume("c", t0 + 1500).allowed).toBe(true);
    // Other client keys are unaffected.
    expect(limiter.tryConsume("other", t0).allowed).toBe(true);
  });

  it("oversized bodies are rejected before parsing", () => {
    const schema = z.object({ a: z.string() });
    const big = "x".repeat(MAX_BODY_BYTES + 1);
    const result = parseJsonBody(big, schema);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("body_too_large");
    expect(statusForError(result.error)).toBe(413);
  });

  it("malformed JSON becomes a structured validation error, not an exception", () => {
    const schema = z.object({ a: z.string() });
    const result = parseJsonBody("{not json", schema);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("validation_failed");
    const envelope = errorEnvelope(result.error);
    expect(envelope.error).toBe("validation_failed");
    expect(JSON.stringify(envelope)).not.toMatch(/stack/i);
  });

  it("error envelopes never carry stack traces or internals", () => {
    const envelope = errorEnvelope({ code: "internal_error", message: "unexpected error processing the request" });
    expect(envelope).toEqual({ error: "internal_error", message: "unexpected error processing the request" });
    expect(statusForError({ code: "internal_error", message: "x" })).toBe(500);
  });
});

describe("phase C: module state hygiene", () => {
  it("reset leaves no residue for the next suite", () => {
    __resetPlanServiceState();
  });
});
