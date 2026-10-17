import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  BERTH_PLAN_CONTRACT_VERSION,
  hoursBetween,
  ResourceAvailabilitySchema,
  toMs,
  VesselScheduleSchema,
  type BerthPlan as ContractBerthPlan,
  type ResourceAvailability,
  type VesselSchedule,
} from "../contracts";
import { planNaive } from "./berth";
import { scheduleCranes } from "./cranes";
import { generateTideWindows, needsTideWindow } from "./tide";
import { isoUtcString } from "../contracts/shared";
import { err, issuesFromZod, ok, type PlanIssue, type PlanResult } from "./result";
import { fingerprintRequest, InMemoryIdempotencyStore } from "./idempotency";
import { auditLog as defaultAuditLog } from "./audit";
import {
  primaryRole,
  requireAction,
  type AuthProvider,
  type User,
} from "./auth";
import type { Berth, Vessel } from "./types";

/**
 * Contract-validated plan generation.
 *
 * This is the server-side entry point for berth planning: raw JSON comes in,
 * zod contracts validate it, and a typed `PlanResult` comes out. There is no
 * API route in this repo's history, so this function (plus the demo routes in
 * `src/app/api/`) IS the boundary — every public planner function it calls
 * underneath keeps its own Phase B input validation untouched.
 *
 * Pipeline:
 *   1. Parse the raw input against the versioned contracts (never coerce).
 *   2. Idempotency: a repeated key returns the stored response deep-equal;
 *      the same key with a different payload is rejected loudly.
 *   3. Feasibility pre-gates (length / grain / draft-vs-depth): a vessel with
 *      no feasible berth fails as `infeasible` — it is never silently
 *      dropped into `unassigned` and never squeezed onto an unfit berth.
 *   4. The audited Phase B planner runs unchanged (greedy + crane pool).
 *   5. Post-gates validate the emitted records against the resources:
 *      draft vs berth depth, window inside availability, crane capacity over
 *      time. A violating output is refused, never emitted.
 */

export const PLAN_GENERATION_CONTRACT_VERSION = "1.0.0";

/** Conservative planning default when a container schedule omits TEU (→ 1 crane). */
const DEFAULT_CONTAINER_TEU = 1200;
/** Assumed quay cranes when a berth resource omits the count. */
const DEFAULT_BERTH_CRANES = 2;
/** Horizon padding past the last departure, mirroring the sweep's own margin. */
const HORIZON_PADDING_HOURS = 48;

export const PlanGenerationRequestSchema = z
  .object({
    contractVersion: z.literal(PLAN_GENERATION_CONTRACT_VERSION).default(PLAN_GENERATION_CONTRACT_VERSION),
    /** Client-supplied idempotency key (min 8 chars). */
    idempotencyKey: z.string().min(8).max(128),
    /** Anchor t0: all internal hours are measured from here; ETAs must not precede it. */
    horizonStartUtc: isoUtcString,
    tidesEnabled: z.boolean().default(false),
    schedules: z.array(VesselScheduleSchema).min(1).max(500),
    resources: z.array(ResourceAvailabilitySchema).min(1).max(200),
  })
  .superRefine((req, ctx) => {
    const seenVessels = new Set<string>();
    for (let i = 0; i < req.schedules.length; i++) {
      const s = req.schedules[i];
      if (seenVessels.has(s.vesselId)) {
        ctx.addIssue({
          code: "custom",
          path: ["schedules", i, "vesselId"],
          message: `duplicate vesselId "${s.vesselId}"`,
        });
      }
      seenVessels.add(s.vesselId);
      if (toMs(s.etaUtc) < toMs(req.horizonStartUtc)) {
        ctx.addIssue({
          code: "custom",
          path: ["schedules", i, "etaUtc"],
          message: "etaUtc must not be before horizonStartUtc",
        });
      }
    }
    const seenResources = new Set<string>();
    for (let i = 0; i < req.resources.length; i++) {
      const r = req.resources[i];
      if (seenResources.has(r.resourceId)) {
        ctx.addIssue({
          code: "custom",
          path: ["resources", i, "resourceId"],
          message: `duplicate resourceId "${r.resourceId}"`,
        });
      }
      seenResources.add(r.resourceId);
    }
    // Overlapping availability windows for the same berth are ambiguous input.
    const berthWindows = new Map<string, ResourceAvailability[]>();
    for (const r of req.resources) {
      if (r.resourceType !== "berth") continue;
      const list = berthWindows.get(r.resourceId) ?? [];
      list.push(r);
      berthWindows.set(r.resourceId, list);
    }
    for (const [berthId, list] of berthWindows) {
      const sorted = [...list].sort((a, b) => toMs(a.availableFromUtc) - toMs(b.availableFromUtc));
      for (let i = 1; i < sorted.length; i++) {
        if (toMs(sorted[i].availableFromUtc) < toMs(sorted[i - 1].availableToUtc)) {
          ctx.addIssue({
            code: "custom",
            path: ["resources"],
            message: `overlapping availability windows for berth "${berthId}"`,
          });
        }
      }
    }
  });

export type PlanGenerationRequest = z.infer<typeof PlanGenerationRequestSchema>;

export interface PlanSummary {
  vesselCount: number;
  assignedCount: number;
  unassigned: string[];
  totalWaitingHours: number;
  makespanHours: number;
}

export interface GeneratePlanResponse {
  contractVersion: typeof PLAN_GENERATION_CONTRACT_VERSION;
  planId: string;
  version: number;
  createdAtUtc: string;
  idempotencyKey: string;
  records: ContractBerthPlan[];
  summary: PlanSummary;
  /** Documented assumptions (defaulted TEU / crane counts), never silent. */
  assumptions: string[];
}

export interface PlanServiceDeps {
  idempotency?: InMemoryIdempotencyStore<GeneratePlanResponse>;
  audit?: typeof defaultAuditLog;
  now?: () => number;
}

const defaultIdempotency = new InMemoryIdempotencyStore<GeneratePlanResponse>();

/** DEMO-ONLY in-memory plan registry: planId → current records. */
export interface StoredPlan {
  planId: string;
  version: number;
  records: ContractBerthPlan[];
  createdAtUtc: string;
}

class PlanRegistry {
  private plans = new Map<string, StoredPlan>();

  put(plan: StoredPlan): void {
    this.plans.set(plan.planId, {
      ...plan,
      records: JSON.parse(JSON.stringify(plan.records)) as ContractBerthPlan[],
    });
  }

  get(planId: string): StoredPlan | undefined {
    const p = this.plans.get(planId);
    if (!p) return undefined;
    return { ...p, records: JSON.parse(JSON.stringify(p.records)) as ContractBerthPlan[] };
  }

  updateRecords(planId: string, records: ContractBerthPlan[]): void {
    const p = this.plans.get(planId);
    if (p) {
      p.records = JSON.parse(JSON.stringify(records)) as ContractBerthPlan[];
    }
  }

  clear(): void {
    this.plans.clear();
  }
}

export const planRegistry = new PlanRegistry();

interface MappedInputs {
  vessels: Vessel[];
  berths: Berth[];
  berthResources: ResourceAvailability[];
  craneResources: ResourceAvailability[];
  assumptions: string[];
  horizonStartUtc: string;
  horizonEndUtc: string;
  vesselById: Map<string, VesselSchedule>;
  berthById: Map<string, ResourceAvailability>;
}

function mapToInternal(req: PlanGenerationRequest): MappedInputs {
  const assumptions: string[] = [];
  const vesselById = new Map<string, VesselSchedule>();
  const vessels: Vessel[] = req.schedules.map((s) => {
    vesselById.set(s.vesselId, s);
    let teu = s.teu ?? 0;
    if (s.teu === undefined && (s.cargoType ?? "container") === "container") {
      teu = DEFAULT_CONTAINER_TEU;
      assumptions.push(
        `vessel ${s.vesselId}: TEU not declared, assuming ${DEFAULT_CONTAINER_TEU} TEU (1-crane minimum)`,
      );
    }
    return {
      id: s.vesselId,
      name: s.name,
      line: "Contract import",
      etaHours: hoursBetween(req.horizonStartUtc, s.etaUtc),
      lengthM: s.loaM,
      draftM: s.draftM,
      cargo: s.cargoType ?? "container",
      handlingHours: hoursBetween(s.etaUtc, s.etdUtc),
      teu,
      origin: "Contract import",
    } satisfies Vessel;
  });

  const berthResources = req.resources.filter((r) => r.resourceType === "berth");
  const craneResources = req.resources.filter((r) => r.resourceType === "crane");
  const berthById = new Map<string, ResourceAvailability>();
  const berths: Berth[] = berthResources.map((r) => {
    berthById.set(r.resourceId, r);
    let cranes = r.cranes;
    if (cranes === undefined) {
      cranes = DEFAULT_BERTH_CRANES;
      assumptions.push(`berth ${r.resourceId}: crane count not declared, assuming ${DEFAULT_BERTH_CRANES}`);
    }
    return {
      id: r.resourceId,
      name: r.resourceId,
      lengthM: r.berthLengthM as number,
      grainCapable: r.grainCapable ?? false,
      cranes,
    } satisfies Berth;
  });

  const maxEtd = Math.max(...req.schedules.map((s) => toMs(s.etdUtc)));
  const horizonEndUtc = new Date(maxEtd + HORIZON_PADDING_HOURS * 3_600_000).toISOString();

  return {
    vessels,
    berths,
    berthResources,
    craneResources,
    assumptions,
    horizonStartUtc: req.horizonStartUtc,
    horizonEndUtc,
    vesselById,
    berthById,
  };
}

/**
 * Feasibility pre-gate: every vessel must have at least one berth that fits
 * its length, grain requirement AND draft (draft-vs-depth). A vessel with no
 * such berth is an infeasible request — the audit proved oversize/deep
 * vessels must never be squeezed onto an unfit berth, and silently listing
 * them as `unassigned` would hide a broken input.
 */
function preGateFeasibility(mapped: MappedInputs): PlanIssue[] {
  const issues: PlanIssue[] = [];
  // Only berths available across the whole derived horizon can take work.
  const usableBerths = mapped.berths.filter((b) => {
    const r = mapped.berthById.get(b.id);
    return (
      r !== undefined &&
      toMs(r.availableFromUtc) <= toMs(mapped.horizonStartUtc) &&
      toMs(r.availableToUtc) >= toMs(mapped.horizonEndUtc)
    );
  });
  if (usableBerths.length === 0) {
    issues.push({
      path: "resources",
      message: "no berth resource covers the full planning horizon",
      code: "no_berth_available",
    });
    return issues;
  }
  for (const v of mapped.vessels) {
    const fits = usableBerths.filter((b) => {
      const r = mapped.berthById.get(b.id);
      if (!r) return false;
      if (v.lengthM > b.lengthM) return false;
      if (v.cargo === "grain" && !b.grainCapable) return false;
      if (v.draftM > (r.maxDraftM as number)) return false;
      return true;
    });
    if (fits.length === 0) {
      const reasons: string[] = [];
      for (const b of usableBerths) {
        const r = mapped.berthById.get(b.id);
        if (v.lengthM > b.lengthM) reasons.push(`${b.id}: vessel loa ${v.lengthM}m > berth length ${b.lengthM}m`);
        else if (v.cargo === "grain" && !b.grainCapable) reasons.push(`${b.id}: grain vessel, berth not grain-capable`);
        else if (r && v.draftM > (r.maxDraftM as number))
          reasons.push(`${b.id}: vessel draft ${v.draftM}m > berth depth ${r.maxDraftM}m`);
      }
      issues.push({
        path: `schedules.${v.id}`,
        message: `vessel ${v.id} has no feasible berth (${reasons.join("; ") || "no berth usable"})`,
        code: "vessel_infeasible",
      });
    }
  }
  return issues;
}

/**
 * Post-gate: validate the emitted records against the resources. Catches
 * whatever the pre-gate could not — the internal planner is length/grain
 * aware but NOT depth-aware, so a deep vessel it places on a shallow berth
 * (or a plan that needs more cranes than declared, or a window outside
 * availability) is refused here. Never an invalid schedule out.
 */
function postGateRecords(
  records: ContractBerthPlan[],
  mapped: MappedInputs,
): PlanIssue[] {
  const issues: PlanIssue[] = [];
  for (const rec of records) {
    const schedule = mapped.vesselById.get(rec.vesselId);
    const berthRes = mapped.berthById.get(rec.berthId);
    if (!schedule || !berthRes) {
      issues.push({ path: `records.${rec.vesselId}`, message: "record references unknown vessel or berth", code: "dangling_reference" });
      continue;
    }
    // Draft vs berth depth.
    if (schedule.draftM > (berthRes.maxDraftM as number)) {
      issues.push({
        path: `records.${rec.vesselId}`,
        message: `vessel draft ${schedule.draftM}m exceeds berth ${rec.berthId} depth ${berthRes.maxDraftM}m`,
        code: "draft_exceeds_depth",
      });
    }
    // Window inside the berth's availability (time ordering).
    if (
      toMs(rec.berthStartUtc) < toMs(berthRes.availableFromUtc) ||
      toMs(rec.berthEndUtc) > toMs(berthRes.availableToUtc)
    ) {
      issues.push({
        path: `records.${rec.vesselId}`,
        message: `berth window outside availability of berth ${rec.berthId}`,
        code: "window_outside_availability",
      });
    }
  }
  // Crane capacity over time: sweep-line over record intervals vs the
  // time-varying declared crane availability. Events sharing a timestamp are
  // applied as a group before the capacity check, so boundary ordering
  // cannot smuggle an over-allocation through.
  const deltas = new Map<number, { demand: number; supply: number }>();
  const addDelta = (t: number, demand: number, supply: number) => {
    const d = deltas.get(t) ?? { demand: 0, supply: 0 };
    d.demand += demand;
    d.supply += supply;
    deltas.set(t, d);
  };
  for (const rec of records) {
    addDelta(toMs(rec.berthStartUtc), rec.assignedCranes.length, 0);
    addDelta(toMs(rec.berthEndUtc), -rec.assignedCranes.length, 0);
  }
  for (const c of mapped.craneResources) {
    addDelta(toMs(c.availableFromUtc), 0, c.quantity);
    addDelta(toMs(c.availableToUtc), 0, -c.quantity);
  }
  const times = [...deltas.keys()].sort((a, b) => a - b);
  let demand = 0;
  let supply = 0;
  for (const t of times) {
    const d = deltas.get(t);
    if (!d) continue;
    demand += d.demand;
    supply += d.supply;
    if (demand > supply) {
      issues.push({
        path: "records",
        message: `crane over-allocation at ${new Date(t).toISOString()}: demand ${demand} > declared availability ${supply}`,
        code: "crane_over_allocated",
      });
      break;
    }
  }
  return issues;
}

/** Exported for unit tests: validate emitted records against resources. */
export function validatePlanRecords(
  records: ContractBerthPlan[],
  mapped: MappedInputs,
): PlanIssue[] {
  return postGateRecords(records, mapped);
}

export type { MappedInputs };

function toRecordTimestamps(
  startHours: number,
  endHours: number,
  horizonStartUtc: string,
): { berthStartUtc: string; berthEndUtc: string } {
  const t0 = toMs(horizonStartUtc);
  return {
    berthStartUtc: new Date(t0 + startHours * 3_600_000).toISOString(),
    berthEndUtc: new Date(t0 + endHours * 3_600_000).toISOString(),
  };
}

export function generatePlan(rawInput: unknown, deps: PlanServiceDeps = {}): PlanResult<GeneratePlanResponse> {
  const idem = deps.idempotency ?? defaultIdempotency;
  const audit = deps.audit ?? defaultAuditLog;
  const now = deps.now ?? Date.now;

  // 1. Contract validation — never coerce.
  const parsed = PlanGenerationRequestSchema.safeParse(rawInput);
  if (!parsed.success) {
    return err({ code: "validation_failed", issues: issuesFromZod(parsed.error.issues) });
  }
  const req = parsed.data;

  // 2. Idempotency.
  const { idempotencyKey, ...payload } = req;
  const fingerprint = fingerprintRequest(payload);
  const prior = idem.lookup(idempotencyKey, fingerprint);
  if (prior !== null) {
    if ("conflict" in prior) {
      return err({
        code: "idempotency_key_reuse",
        message: `idempotency key "${idempotencyKey}" was already used with a different payload`,
      });
    }
    return ok(prior.response);
  }

  // 3. Map + feasibility pre-gate.
  const mapped = mapToInternal(req);
  const preIssues = preGateFeasibility(mapped);
  if (preIssues.length > 0) {
    return err({
      code: "infeasible",
      reason: "request failed the feasibility pre-gate: every vessel needs a berth that fits length, grain and draft",
      details: preIssues,
    });
  }

  const poolLimit = mapped.berths.reduce((s, b) => s + b.cranes, 0);
  if (poolLimit <= 0) {
    return err({ code: "infeasible", reason: "no quay cranes declared on any berth" });
  }

  // 4. Audited Phase B planner, unchanged.
  const rawPlan = planNaive(mapped.vessels, mapped.berths, { tidesEnabled: req.tidesEnabled });
  const { plan, schedule } = scheduleCranes(rawPlan, mapped.vessels, mapped.berths, {
    poolLimit,
    tidesEnabled: req.tidesEnabled,
  });

  // 5. Emit versioned contract records.
  const planId = `plan_${randomUUID()}`;
  const createdAtUtc = new Date(now()).toISOString();
  const cranesByVessel = new Map(schedule.assignments.map((c) => [c.vesselId, c.cranes]));
  const horizonHours =
    Math.max(0, ...mapped.vessels.map((v) => v.etaHours)) +
    mapped.vessels.reduce((s, v) => s + v.handlingHours, 0) +
    HORIZON_PADDING_HOURS;
  const tideWindows = req.tidesEnabled ? generateTideWindows(horizonHours) : [];

  const records: ContractBerthPlan[] = plan.assignments.map((a) => {
    const vessel = mapped.vessels.find((v) => v.id === a.vesselId);
    const craneCount = Math.max(1, cranesByVessel.get(a.vesselId) ?? 1);
    const assignedCranes = Array.from({ length: craneCount }, (_, i) => `pool-crane-${String(i + 1).padStart(2, "0")}`);
    let tideWindowRef: string | undefined;
    if (req.tidesEnabled && vessel && needsTideWindow(vessel)) {
      const idx = tideWindows.findIndex((w) => a.startHours >= w.startHours && a.startHours < w.endHours);
      if (idx >= 0) tideWindowRef = `tide-window-${idx}`;
    }
    const { berthStartUtc, berthEndUtc } = toRecordTimestamps(a.startHours, a.endHours, req.horizonStartUtc);
    return {
      contractVersion: BERTH_PLAN_CONTRACT_VERSION,
      planId,
      version: 1,
      vesselId: a.vesselId,
      berthId: a.berthId,
      berthStartUtc,
      berthEndUtc,
      assignedCranes,
      tideWindowRef,
      status: "proposed",
      createdAtUtc,
    } satisfies ContractBerthPlan;
  });

  // 6. Post-gate — refuse invalid output.
  const postIssues = postGateRecords(records, mapped);
  if (postIssues.length > 0) {
    return err({
      code: "infeasible",
      reason: "generated plan violates resource constraints and was refused (never emitted)",
      details: postIssues,
    });
  }

  const response: GeneratePlanResponse = {
    contractVersion: PLAN_GENERATION_CONTRACT_VERSION,
    planId,
    version: 1,
    createdAtUtc,
    idempotencyKey,
    records,
    summary: {
      vesselCount: mapped.vessels.length,
      assignedCount: plan.assignments.length,
      unassigned: plan.unassigned,
      totalWaitingHours: plan.totalWaitingHours,
      makespanHours: plan.makespanHours,
    },
    assumptions: mapped.assumptions,
  };

  idem.store(idempotencyKey, fingerprint, response);
  planRegistry.put({ planId, version: 1, records, createdAtUtc });
  audit.append({ type: "plan.generated", planId, actor: "plan-service", role: "planner", reason: "contract-validated generation" });

  return ok(response);
}

/** Approve every record of a plan. Requires the `approver` role. */
export function approvePlan(
  planId: string,
  user: User,
  provider: AuthProvider,
  reason?: string,
  deps: PlanServiceDeps = {},
): PlanResult<ContractBerthPlan[]> {
  const audit = deps.audit ?? defaultAuditLog;
  const gate = requireAction(user, provider, "plan:approve");
  if (!gate.ok) return gate as PlanResult<ContractBerthPlan[]>;
  const stored = planRegistry.get(planId);
  if (!stored) return err({ code: "not_found", message: `plan "${planId}" not found` });
  if (!stored.records.every((r) => r.status === "proposed")) {
    return err({ code: "conflict", message: `plan "${planId}" is not in proposed status` });
  }
  const approved = stored.records.map((r) => ({ ...r, status: "approved" as const }));
  planRegistry.updateRecords(planId, approved);
  audit.append({
    type: "plan.approved",
    planId,
    actor: user.id,
    role: primaryRole(user),
    reason: reason ?? "approved via plan service",
  });
  return ok(approved);
}

/**
 * Supersede a plan with a newer one: the old records move to `superseded`,
 * and the audit trail links before/after plan ids with approver and reason.
 * Requires `plan:supersede`.
 */
export function supersedePlan(
  oldPlanId: string,
  newPlanId: string,
  user: User,
  provider: AuthProvider,
  reason: string,
  deps: PlanServiceDeps = {},
): PlanResult<{ oldPlanId: string; newPlanId: string }> {
  const audit = deps.audit ?? defaultAuditLog;
  const gate = requireAction(user, provider, "plan:supersede");
  if (!gate.ok) return gate as PlanResult<{ oldPlanId: string; newPlanId: string }>;
  const oldPlan = planRegistry.get(oldPlanId);
  if (!oldPlan) return err({ code: "not_found", message: `plan "${oldPlanId}" not found` });
  const newPlan = planRegistry.get(newPlanId);
  if (!newPlan) return err({ code: "not_found", message: `plan "${newPlanId}" not found` });
  if (oldPlanId === newPlanId) {
    return err({ code: "conflict", message: "a plan cannot supersede itself" });
  }
  if (!oldPlan.records.every((r) => ["proposed", "approved", "active"].includes(r.status))) {
    return err({ code: "conflict", message: `plan "${oldPlanId}" is already ${oldPlan.records[0]?.status}` });
  }
  const superseded = oldPlan.records.map((r) => ({ ...r, status: "superseded" as const }));
  planRegistry.updateRecords(oldPlanId, superseded);
  audit.append({
    type: "plan.superseded",
    planId: newPlanId,
    previousPlanId: oldPlanId,
    actor: user.id,
    role: primaryRole(user),
    reason,
  });
  return ok({ oldPlanId, newPlanId });
}

/** Test seam: reset module-level demo state. */
export function __resetPlanServiceState(): void {
  defaultIdempotency.clear();
  planRegistry.clear();
}
