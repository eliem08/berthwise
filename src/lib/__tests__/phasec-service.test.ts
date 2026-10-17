import { describe, it, expect } from "vitest";
import {
  generatePlan,
  validatePlanRecords,
  __resetPlanServiceState,
  type MappedInputs,
} from "../plan-service";
import { BerthPlanSchema, type BerthPlan as ContractBerthPlan, type ResourceAvailability, type VesselSchedule } from "../../contracts";
import {
  H0,
  baseRequest,
  berthResource,
  craneResource,
  freshDeps,
  isoPlusHours,
  scheduleVessel,
} from "./phasec-fixtures";

describe("phase C: plan generation service", () => {
  it("generates a contract-valid plan for a feasible scenario", () => {
    const result = generatePlan(baseRequest(), freshDeps());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const res = result.value;
    expect(res.planId).toMatch(/^plan_/);
    expect(res.version).toBe(1);
    expect(res.records).toHaveLength(2);
    // Every emitted record parses against the versioned contract.
    for (const rec of res.records) {
      expect(() => BerthPlanSchema.parse(rec)).not.toThrow();
      expect(rec.status).toBe("proposed");
      expect(rec.planId).toBe(res.planId);
    }
    expect(res.summary.assignedCount).toBe(2);
    expect(res.summary.unassigned).toHaveLength(0);
    expect(res.summary.totalWaitingHours).toBeGreaterThanOrEqual(0);
    // The undeclared TEU on V2 surfaces as a documented assumption, not a silent default.
    expect(res.assumptions.some((a) => a.includes("V2") && a.includes("TEU"))).toBe(true);
  });

  it("rejects malformed input with structured validation issues (never throws, never coerces)", () => {
    const bad = baseRequest({
      schedules: [scheduleVessel("V1", 0, 10, { etaUtc: "tomorrow-ish" })],
    });
    const result = generatePlan(bad, freshDeps());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("validation_failed");
    if (result.error.code !== "validation_failed") return;
    expect(result.error.issues.length).toBeGreaterThan(0);
    for (const issue of result.error.issues) {
      expect(issue.path).toBeTypeOf("string");
      expect(issue.message).toBeTypeOf("string");
      expect(issue.code).toBeTypeOf("string");
    }
  });

  it("regression: vessel too deep for every berth is infeasible (draft vs depth)", () => {
    const req = baseRequest({
      schedules: [scheduleVessel("DEEP", 0, 10, { draftM: 16 })],
    });
    const result = generatePlan(req, freshDeps());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("infeasible");
    if (result.error.code !== "infeasible") return;
    expect(result.error.details?.some((d) => d.code === "vessel_infeasible" && /draft/.test(d.message))).toBe(true);
  });

  it("regression: oversize vessel is infeasible, never squeezed onto a short berth", () => {
    const req = baseRequest({
      schedules: [scheduleVessel("BIG", 0, 10, { loaM: 400 })],
    });
    const result = generatePlan(req, freshDeps());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("infeasible");
  });

  it("regression: grain vessel with no grain-capable berth is infeasible", () => {
    const req = baseRequest({
      schedules: [scheduleVessel("G", 0, 10, { cargoType: "grain", teu: 0 })],
    });
    const result = generatePlan(req, freshDeps());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("infeasible");
    if (result.error.code !== "infeasible") return;
    expect(result.error.details?.some((d) => /grain/.test(d.message))).toBe(true);
  });

  it("regression: overlapping availability windows for the same berth are rejected", () => {
    const req = baseRequest({
      resources: [
        berthResource("B1"),
        berthResource("B1", { availableFromUtc: isoPlusHours(48), availableToUtc: isoPlusHours(120) }),
        berthResource("B2"),
        craneResource(8),
      ],
    });
    const result = generatePlan(req, freshDeps());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("validation_failed");
    if (result.error.code !== "validation_failed") return;
    expect(result.error.issues.some((i) => /overlapping availability/.test(i.message))).toBe(true);
  });

  it("regression: crane over-allocation is refused, never emitted", () => {
    // Two vessels in parallel need 2 cranes each (teu 2400), but only 2 are declared.
    const req = baseRequest({
      schedules: [
        scheduleVessel("V1", 0, 10, { teu: 2400 }),
        scheduleVessel("V2", 0, 10, { teu: 2400 }),
      ],
      resources: [berthResource("B1"), berthResource("B2"), craneResource(2)],
    });
    const result = generatePlan(req, freshDeps());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("infeasible");
    if (result.error.code !== "infeasible") return;
    expect(result.error.details?.some((d) => d.code === "crane_over_allocated")).toBe(true);
  });

  it("regression: depth-violating planner output is refused (planner is depth-unaware by design)", () => {
    // B1 (shallow, sorts first) and B2 (deep): greedy picks B1 for the deep vessel.
    const req = baseRequest({
      schedules: [scheduleVessel("DEEP", 0, 10, { draftM: 14 })],
      resources: [
        berthResource("B1", { maxDraftM: 12 }),
        berthResource("B2", { maxDraftM: 16 }),
        craneResource(8),
      ],
    });
    const result = generatePlan(req, freshDeps());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("infeasible");
    if (result.error.code !== "infeasible") return;
    expect(result.error.details?.some((d) => d.code === "draft_exceeds_depth")).toBe(true);
  });

  it("regression: ETA before the horizon anchor is rejected", () => {
    const req = baseRequest({
      schedules: [scheduleVessel("V1", -2, 10)],
    });
    const result = generatePlan(req, freshDeps());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("validation_failed");
  });
});

describe("phase C: idempotency", () => {
  it("a repeated key returns the identical plan (deep-equal), with no duplicate record", () => {
    const deps = freshDeps();
    const req = baseRequest({ idempotencyKey: "idem-key-0001" });
    const first = generatePlan(req, deps);
    const second = generatePlan(structuredClone(req), deps);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(JSON.stringify(second.value)).toBe(JSON.stringify(first.value));
    expect(second.value.planId).toBe(first.value.planId);
    expect(deps.idempotency.size()).toBe(1);
  });

  it("the same key with a different payload is rejected loudly", () => {
    const deps = freshDeps();
    const req = baseRequest({ idempotencyKey: "idem-key-0002" });
    expect(generatePlan(req, deps).ok).toBe(true);
    const tampered = baseRequest({
      idempotencyKey: "idem-key-0002",
      schedules: [scheduleVessel("V1", 0, 10, { teu: 9999 })],
    });
    const result = generatePlan(tampered, deps);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("idempotency_key_reuse");
  });

  it("__resetPlanServiceState clears module-level demo state", () => {
    generatePlan(baseRequest({ idempotencyKey: "idem-key-0003" }));
    __resetPlanServiceState();
    // After reset the same key is accepted again (fresh store).
    expect(generatePlan(baseRequest({ idempotencyKey: "idem-key-0003" })).ok).toBe(true);
    __resetPlanServiceState();
  });
});

describe("phase C: record validator invariants (unit)", () => {
  function mappedWith(opts: {
    berthDepth: number;
    vesselDraft: number;
    craneQty: number;
    craneDemand: number;
    recordEndH: number;
    availEndH: number;
  }): { mapped: MappedInputs; records: ContractBerthPlan[] } {
    const berth: ResourceAvailability = {
      contractVersion: "1.0.0",
      resourceId: "B1",
      resourceType: "berth",
      capacityUnit: "vessels",
      quantity: 1,
      availableFromUtc: H0,
      availableToUtc: isoPlusHours(opts.availEndH),
      berthLengthM: 350,
      maxDraftM: opts.berthDepth,
    };
    const schedule: VesselSchedule = {
      contractVersion: "1.0.0",
      vesselId: "V1",
      name: "V1",
      loaM: 200,
      beamM: 32,
      draftM: opts.vesselDraft,
      etaUtc: H0,
      etdUtc: isoPlusHours(10),
    };
    const mapped: MappedInputs = {
      vessels: [],
      berths: [],
      berthResources: [berth],
      craneResources: [
        {
          contractVersion: "1.0.0",
          resourceId: "crane-pool",
          resourceType: "crane",
          capacityUnit: "cranes",
          quantity: opts.craneQty,
          availableFromUtc: H0,
          availableToUtc: isoPlusHours(96),
        },
      ],
      assumptions: [],
      horizonStartUtc: H0,
      horizonEndUtc: isoPlusHours(96),
      vesselById: new Map([["V1", schedule]]),
      berthById: new Map([["B1", berth]]),
    };
    const records: ContractBerthPlan[] = [
      {
        contractVersion: "1.0.0",
        planId: "plan_x",
        version: 1,
        vesselId: "V1",
        berthId: "B1",
        berthStartUtc: H0,
        berthEndUtc: isoPlusHours(opts.recordEndH),
        assignedCranes: Array.from({ length: opts.craneDemand }, (_, i) => `pool-crane-0${i + 1}`),
        status: "proposed",
        createdAtUtc: H0,
      },
    ];
    return { mapped, records };
  }

  it("rejects draft > berth depth", () => {
    const { mapped, records } = mappedWith({
      berthDepth: 12, vesselDraft: 14, craneQty: 8, craneDemand: 1, recordEndH: 10, availEndH: 96,
    });
    const issues = validatePlanRecords(records, mapped);
    expect(issues.some((i) => i.code === "draft_exceeds_depth")).toBe(true);
  });

  it("rejects crane demand above declared availability", () => {
    const { mapped, records } = mappedWith({
      berthDepth: 14, vesselDraft: 10, craneQty: 1, craneDemand: 3, recordEndH: 10, availEndH: 96,
    });
    const issues = validatePlanRecords(records, mapped);
    expect(issues.some((i) => i.code === "crane_over_allocated")).toBe(true);
  });

  it("rejects a berth window outside the availability window (time ordering)", () => {
    const { mapped, records } = mappedWith({
      berthDepth: 14, vesselDraft: 10, craneQty: 8, craneDemand: 1, recordEndH: 100, availEndH: 96,
    });
    const issues = validatePlanRecords(records, mapped);
    expect(issues.some((i) => i.code === "window_outside_availability")).toBe(true);
  });

  it("accepts a fully consistent record set", () => {
    const { mapped, records } = mappedWith({
      berthDepth: 14, vesselDraft: 10, craneQty: 8, craneDemand: 2, recordEndH: 10, availEndH: 96,
    });
    expect(validatePlanRecords(records, mapped)).toHaveLength(0);
  });
});
