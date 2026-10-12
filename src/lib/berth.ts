import type { Assignment, Berth, BerthPlan, PlanOptions, Vessel } from "./types";
import { mulberry32 } from "./rng";

/** Simulated-annealing tuning constants. */
const SA_TEMP_START = 8;
const SA_TEMP_END = 0.02;
const MAKESPAN_WEIGHT = 0.05;
/** Iterations per millisecond of time budget — keeps runs deterministic. */
const ITERATIONS_PER_MS = 200;
const DEFAULT_SEED = 42;
const DEFAULT_TIME_LIMIT_MS = 500;

/**
 * A vessel can only be moored at a berth that is long enough for it, and grain
 * vessels additionally require a grain-capable berth.
 */
export function berthFeasible(vessel: Vessel, berth: Berth): boolean {
  if (vessel.lengthM > berth.lengthM) return false;
  if (vessel.cargo === "grain" && !berth.grainCapable) return false;
  return true;
}

/** Deterministic lexicographic comparison used for all id tie-breaks. */
function compareIds(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** Deep-ish clone of the berth -> ordered vessel ids representation. */
function cloneSeqs(seqs: Map<string, string[]>): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const [berthId, list] of seqs) out.set(berthId, list.slice());
  return out;
}

/**
 * Sweeps each berth's ordered vessel sequence into concrete assignments.
 *
 * For every berth the vessels are processed in list order:
 *   start = max(vessel.etaHours, previousEnd)
 *   end   = start + vessel.handlingHours
 *
 * Because a berth is swept sequentially, no two assignments on the same berth
 * can ever overlap. Vessels that do not appear in any sequence are reported as
 * unassigned.
 */
function buildPlan(seqs: Map<string, string[]>, vessels: Map<string, Vessel>): BerthPlan {
  const assignments: Assignment[] = [];
  const berthBusyHours: Record<string, number> = {};
  const placed = new Set<string>();

  let totalWaitingHours = 0;
  let makespanHours = 0;

  for (const [berthId, sequence] of seqs) {
    let busyHours = 0;
    let previousEnd = 0;

    for (const vesselId of sequence) {
      const vessel = vessels.get(vesselId);
      if (!vessel) continue;

      const startHours = Math.max(vessel.etaHours, previousEnd);
      const endHours = startHours + vessel.handlingHours;
      const waitingHours = Math.max(0, startHours - vessel.etaHours);

      assignments.push({
        vesselId,
        berthId,
        startHours,
        endHours,
        waitingHours,
      });

      placed.add(vesselId);
      busyHours += vessel.handlingHours;
      previousEnd = endHours;

      if (endHours > makespanHours) makespanHours = endHours;
      totalWaitingHours += waitingHours;
    }

    berthBusyHours[berthId] = busyHours;
  }

  const unassigned: string[] = [];
  for (const vesselId of vessels.keys()) {
    if (!placed.has(vesselId)) unassigned.push(vesselId);
  }

  return {
    assignments,
    unassigned,
    totalWaitingHours,
    makespanHours,
    berthBusyHours,
  };
}

/**
 * Greedy earliest-start placement.
 *
 * Vessels are consumed in the given order. Each vessel is placed on the
 * feasible berth that yields the earliest start time
 * (max(eta, berthAvailable)), with ties broken by berth id. Vessels with no
 * feasible berth are simply skipped (they end up unassigned).
 */
function greedySequences(ordered: Vessel[], berths: Berth[]): Map<string, string[]> {
  const seqs = new Map<string, string[]>();
  const berthAvailable = new Map<string, number>();

  for (const berth of berths) {
    seqs.set(berth.id, []);
    berthAvailable.set(berth.id, 0);
  }

  for (const vessel of ordered) {
    let bestBerth: Berth | null = null;
    let bestStart = Number.POSITIVE_INFINITY;

    for (const berth of berths) {
      if (!berthFeasible(vessel, berth)) continue;

      const available = berthAvailable.get(berth.id) ?? 0;
      const start = Math.max(vessel.etaHours, available);

      if (
        start < bestStart ||
        (start === bestStart && bestBerth !== null && compareIds(berth.id, bestBerth.id) < 0)
      ) {
        bestStart = start;
        bestBerth = berth;
      }
    }

    if (bestBerth === null) continue;

    const list = seqs.get(bestBerth.id);
    if (!list) continue;
    list.push(vessel.id);
    berthAvailable.set(bestBerth.id, bestStart + vessel.handlingHours);
  }

  return seqs;
}

/**
 * First-come-first-served baseline: vessels are processed in ETA order
 * (ties broken by id) and each one takes the feasible berth that lets it start
 * earliest.
 */
export function planNaive(vessels: Vessel[], berths: Berth[]): BerthPlan {
  const vesselMap = new Map<string, Vessel>();
  for (const vessel of vessels) vesselMap.set(vessel.id, vessel);

  const ordered = vessels
    .slice()
    .sort((a, b) => a.etaHours - b.etaHours || compareIds(a.id, b.id));

  const seqs = greedySequences(ordered, berths);
  return buildPlan(seqs, vesselMap);
}

/** Objective: waiting dominates, makespan is a mild secondary term. */
function objective(plan: BerthPlan): number {
  return plan.totalWaitingHours + MAKESPAN_WEIGHT * plan.makespanHours;
}

/**
 * Simulated-annealing berth planner.
 *
 * Starts from a greedy solution, then repeatedly moves a single vessel to a
 * random position on a random feasible berth. The full plan is recomputed from
 * the sequences after every move, so the returned plan is always overlap-free
 * and never contains an infeasible vessel/berth pair.
 *
 * All randomness flows through mulberry32(seed), so identical inputs and seed
 * produce identical output.
 */
export function planOptimized(
  vessels: Vessel[],
  berths: Berth[],
  opts: PlanOptions = {},
): BerthPlan {
  const seed = opts.seed ?? DEFAULT_SEED;
  const timeLimitMs = opts.timeLimitMs ?? DEFAULT_TIME_LIMIT_MS;
  const grainPriority = opts.grainPriority ?? false;

  const vesselMap = new Map<string, Vessel>();
  for (const vessel of vessels) vesselMap.set(vessel.id, vessel);

  // --- Ordering -----------------------------------------------------------
  const ordered = vessels.slice().sort((a, b) => {
    if (grainPriority) {
      const ga = a.cargo === "grain" ? 0 : 1;
      const gb = b.cargo === "grain" ? 0 : 1;
      if (ga !== gb) return ga - gb;
    }
    return a.etaHours - b.etaHours || compareIds(a.id, b.id);
  });

  // --- Initial solution ---------------------------------------------------
  let currentSeqs = greedySequences(ordered, berths);
  let currentCost = objective(buildPlan(currentSeqs, vesselMap));

  let bestPlan = buildPlan(currentSeqs, vesselMap);
  let bestCost = currentCost;

  if (vessels.length === 0 || berths.length === 0) return bestPlan;

  // --- Precomputed feasibility -------------------------------------------
  const feasibleBerths = new Map<string, Berth[]>();
  const movable: Vessel[] = [];
  for (const vessel of vessels) {
    const list = berths.filter((berth) => berthFeasible(vessel, berth));
    feasibleBerths.set(vessel.id, list);
    if (list.length > 0) movable.push(vessel);
  }

  if (movable.length === 0) return bestPlan;

  // vesselId -> berthId currently holding it
  const location = new Map<string, string>();
  for (const [berthId, list] of currentSeqs) {
    for (const vesselId of list) location.set(vesselId, berthId);
  }

  // --- Annealing loop -----------------------------------------------------
  // Fixed iteration budget (derived from timeLimitMs) instead of wall-clock
  // timing, so identical inputs + seed always produce identical output.
  const rand = mulberry32(seed);
  const maxIterations = Math.max(64, Math.floor(timeLimitMs * ITERATIONS_PER_MS));

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    const progress = maxIterations <= 1 ? 1 : iteration / (maxIterations - 1);
    const temperature =
      SA_TEMP_START * Math.pow(SA_TEMP_END / SA_TEMP_START, progress);

    // Pick a random movable vessel.
    const vessel = movable[Math.floor(rand() * movable.length)];
    const candidates = feasibleBerths.get(vessel.id);
    if (!candidates || candidates.length === 0) continue;

    // Work on a clone so the current solution is never mutated.
    const nextSeqs = cloneSeqs(currentSeqs);

    const fromBerthId = location.get(vessel.id);
    if (fromBerthId !== undefined) {
      const fromList = nextSeqs.get(fromBerthId);
      if (fromList) {
        const idx = fromList.indexOf(vessel.id);
        if (idx >= 0) fromList.splice(idx, 1);
      }
    }

    const targetBerth = candidates[Math.floor(rand() * candidates.length)];
    const targetList = nextSeqs.get(targetBerth.id);
    if (!targetList) continue;

    const insertAt = Math.floor(rand() * (targetList.length + 1));
    targetList.splice(insertAt, 0, vessel.id);

    const nextPlan = buildPlan(nextSeqs, vesselMap);
    const nextCost = objective(nextPlan);
    const delta = nextCost - currentCost;

    const accept =
      delta <= 0 || rand() < Math.exp(-delta / Math.max(temperature, 1e-9));

    if (accept) {
      currentSeqs = nextSeqs;
      currentCost = nextCost;
      location.set(vessel.id, targetBerth.id);

      if (nextCost < bestCost) {
        bestCost = nextCost;
        bestPlan = nextPlan;
      }
    }
  }

  return bestPlan;
}