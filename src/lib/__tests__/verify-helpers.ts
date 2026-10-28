import { expect } from "vitest";
import { mulberry32 } from "../rng";
import { berthFeasible } from "../berth";
import {
  OBJECTIVE_REFERENCE,
  FUEL_BURN_T_PER_HOUR,
  CRANE_COST_USD_PER_HOUR,
  cranesForVessel,
  normalizeWeights,
} from "../economics";
import {
  generateTideWindows,
  isInTideWindow,
  needsTideWindow,
  nextTideWindowStart,
} from "../tide";
import type { Berth, BerthPlan, Box, ObjectiveWeights, Vessel } from "../types";

/**
 * Shared independent verifiers for the planning audits.
 *
 * First built for the Phase B audit (B.9) and reused by the Phase D
 * wider-verification and property suites. They deliberately share only the
 * tide helpers and berthFeasible with the solvers: the brute-force optimum,
 * its sweep, and its objective calculation are independent code paths, so an
 * exact-vs-brute-force match is evidence from two separate implementations
 * of the same documented semantics.
 */

export const EPS = 1e-9;

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

export function vessel(
  id: string,
  etaHours: number,
  handlingHours: number,
  opts: Partial<Vessel> = {},
): Vessel {
  return {
    id,
    name: id,
    line: "Test",
    etaHours,
    lengthM: 200,
    draftM: 10,
    cargo: "container",
    handlingHours,
    teu: 1000,
    origin: "Test",
    ...opts,
  };
}

export const BERTHS: Berth[] = [
  { id: "B1", name: "Berth 1", lengthM: 350, grainCapable: false, cranes: 3 },
  { id: "B2", name: "Berth 2", lengthM: 300, grainCapable: true, cranes: 2 },
];

export function box(id: string, retrievalRank: number): Box {
  return { id, retrievalRank, destination: "X" };
}

/** Seeded random instance generator for the verifier sweeps. */
export function randomInstance(seed: number, nVessels: number, nBerths: number): { vessels: Vessel[]; berths: Berth[] } {
  const rand = mulberry32(seed);
  const cargos = ["container", "container", "grain"] as const;
  const vessels: Vessel[] = [];
  for (let i = 0; i < nVessels; i++) {
    const cargo = cargos[Math.floor(rand() * cargos.length)];
    vessels.push({
      id: `V${i + 1}`,
      name: `Vessel ${i + 1}`,
      line: "Test",
      etaHours: Math.round(rand() * 24 * 10) / 10,
      lengthM: 150 + Math.floor(rand() * 170),
      draftM: 9 + rand() * 5,
      cargo,
      handlingHours: 2 + Math.floor(rand() * 9),
      teu: cargo === "grain" ? 0 : 800 + Math.floor(rand() * 3000),
      origin: "Test",
    });
  }
  const berths: Berth[] = [];
  for (let i = 0; i < nBerths; i++) {
    berths.push({
      id: `B${i + 1}`,
      name: `Berth ${i + 1}`,
      lengthM: 250 + Math.floor(rand() * 120),
      grainCapable: rand() < 0.5,
      cranes: 2 + Math.floor(rand() * 3),
    });
  }
  // Guarantee every vessel fits somewhere so the optimum is meaningful.
  for (const v of vessels) {
    if (!berths.some((b) => berthFeasible(v, b))) {
      berths[0].lengthM = Math.max(berths[0].lengthM, v.lengthM);
      if (v.cargo === "grain") berths[0].grainCapable = true;
    }
  }
  return { vessels, berths };
}

/* ------------------------------------------------------------------ */
/* Independent brute-force verifier (B.9)                               */
/*                                                                     */
/* Enumerates EVERY feasible per-berth sequence partition (assignment  */
/* x permutations) with its own sweep and its own objective            */
/* calculation — the only shared code with the solvers is the tide     */
/* helpers and berthFeasible.                                          */
/* ------------------------------------------------------------------ */

export interface BruteResult {
  objective: number;
  seqs: Map<string, string[]>;
}

export function bruteForceOptimum(
  vessels: Vessel[],
  berths: Berth[],
  weights: ObjectiveWeights,
  tidesEnabled: boolean,
): BruteResult {
  const w = normalizeWeights(weights);
  const vesselById = new Map(vessels.map((v) => [v.id, v]));
  const feasibleBerths = new Map<string, Berth[]>();
  for (const v of vessels) feasibleBerths.set(v.id, berths.filter((b) => berthFeasible(v, b)));
  const searchable = vessels.filter((v) => (feasibleBerths.get(v.id) ?? []).length > 0);

  const horizon = Math.max(0, ...searchable.map((v) => v.etaHours)) +
    searchable.reduce((s, v) => s + v.handlingHours, 0) + 48;
  const windows = generateTideWindows(horizon);

  // Independent sweep: own code path, same documented semantics.
  function sweep(seqs: Map<string, string[]>): { waiting: number; fuel: number; craneCost: number; makespan: number } {
    let waiting = 0;
    let fuel = 0;
    let craneCost = 0;
    let makespan = 0;
    for (const [berthId, seq] of seqs) {
      const berth = berths.find((b) => b.id === berthId)!;
      let prevEnd = 0;
      for (const vid of seq) {
        const v = vesselById.get(vid)!;
        let start = Math.max(v.etaHours, prevEnd);
        if (tidesEnabled && needsTideWindow(v)) start = nextTideWindowStart(start, windows);
        const end = start + v.handlingHours;
        waiting += Math.max(0, start - v.etaHours);
        fuel += Math.max(0, start - v.etaHours) * (FUEL_BURN_T_PER_HOUR[v.cargo] ?? 0.9);
        craneCost += cranesForVessel(v, berth) * v.handlingHours * CRANE_COST_USD_PER_HOUR;
        if (end > makespan) makespan = end;
        prevEnd = end;
      }
    }
    return { waiting, fuel, craneCost, makespan };
  }

  function objective(seqs: Map<string, string[]>): number {
    const { waiting, fuel, craneCost, makespan } = sweep(seqs);
    return (
      w.waiting * (waiting / OBJECTIVE_REFERENCE.waitingHours) +
      w.fuel * (fuel / OBJECTIVE_REFERENCE.fuelTonnes) +
      w.crane * (craneCost / OBJECTIVE_REFERENCE.craneCostUsd) +
      0.01 * (makespan / 100)
    );
  }

  // Enumerate: assignment function x per-berth permutations.
  const berthIds = berths.map((b) => b.id);
  const assignChoices = searchable.map((v) => feasibleBerths.get(v.id)!.map((b) => b.id));
  let best = Number.POSITIVE_INFINITY;
  let bestSeqs: Map<string, string[]> | null = null;

  function* permutations<T>(items: T[]): Generator<T[]> {
    if (items.length <= 1) { yield items.slice(); return; }
    for (let i = 0; i < items.length; i++) {
      const rest = items.slice(0, i).concat(items.slice(i + 1));
      for (const tail of permutations(rest)) yield [items[i], ...tail];
    }
  }

  function enumerateAssignments(idx: number, current: string[]): void {
    if (idx === searchable.length) {
      // Build per-berth vessel lists, then permute each.
      const perBerth = new Map<string, string[]>();
      for (const id of berthIds) perBerth.set(id, []);
      searchable.forEach((v, i) => perBerth.get(current[i])!.push(v.id));
      const berthLists = berthIds.map((id) => ({ id, list: perBerth.get(id)! }));
      const permIters = berthLists.map(({ list }) => [...permutations(list)]);
      const combo: string[][] = berthLists.map(() => []);
      const recurse = (bi: number) => {
        if (bi === berthLists.length) {
          const seqs = new Map<string, string[]>();
          berthLists.forEach(({ id }, k) => seqs.set(id, combo[k]));
          const obj = objective(seqs);
          if (obj < best) { best = obj; bestSeqs = seqs; }
          return;
        }
        for (const p of permIters[bi]) { combo[bi] = p; recurse(bi + 1); }
      };
      recurse(0);
      return;
    }
    for (const b of assignChoices[idx]) { current[idx] = b; enumerateAssignments(idx + 1, current); }
  }
  enumerateAssignments(0, new Array(searchable.length));

  return { objective: best, seqs: bestSeqs! };
}

/**
 * Independent plan feasibility checker: does not trust the sweep.
 * Verifies occupancy, ETAs, dimensions, tide windows, waiting arithmetic,
 * assignment coverage, and berth/duration consistency.
 */
export function assertPlanFullyFeasible(
  plan: BerthPlan,
  vessels: Vessel[],
  berths: Berth[],
  opts: { tidesEnabled?: boolean } = {},
): void {
  const tidesEnabled = opts.tidesEnabled ?? false;
  const vesselById = new Map(vessels.map((v) => [v.id, v]));
  const berthById = new Map(berths.map((b) => [b.id, b]));
  const horizon = Math.max(0, ...vessels.map((v) => v.etaHours)) +
    vessels.reduce((s, v) => s + v.handlingHours, 0) + 48;
  const windows = generateTideWindows(horizon);

  const seen = new Set<string>();
  for (const a of plan.assignments) {
    const v = vesselById.get(a.vesselId);
    const b = berthById.get(a.berthId);
    expect(v, `unknown vessel ${a.vesselId}`).toBeDefined();
    expect(b, `unknown berth ${a.berthId}`).toBeDefined();
    expect(seen.has(a.vesselId), `vessel ${a.vesselId} assigned twice`).toBe(false);
    seen.add(a.vesselId);
    expect(berthFeasible(v!, b!), `infeasible pair ${a.vesselId}/${a.berthId}`).toBe(true);
    expect(a.startHours, `${a.vesselId} starts before ETA`).toBeGreaterThanOrEqual(v!.etaHours - EPS);
    expect(a.waitingHours, `${a.vesselId} negative waiting`).toBeGreaterThanOrEqual(-EPS);
    expect(a.waitingHours, `${a.vesselId} waiting != start - eta`).toBeCloseTo(
      Math.max(0, a.startHours - v!.etaHours), 9,
    );
    expect(a.endHours - a.startHours, `${a.vesselId} duration`).toBeCloseTo(v!.handlingHours, 9);
    if (tidesEnabled && needsTideWindow(v!)) {
      expect(
        isInTideWindow(a.startHours, windows),
        `${a.vesselId} (draft ${v!.draftM}m) starts at h+${a.startHours} outside every tide window`,
      ).toBe(true);
    }
  }
  // No overlaps per berth.
  const byBerth = new Map<string, typeof plan.assignments>();
  for (const a of plan.assignments) {
    const l = byBerth.get(a.berthId) ?? [];
    l.push(a);
    byBerth.set(a.berthId, l);
  }
  for (const [berthId, list] of byBerth) {
    const sorted = [...list].sort((x, y) => x.startHours - y.startHours);
    for (let i = 1; i < sorted.length; i++) {
      expect(
        sorted[i].startHours,
        `overlap on ${berthId}: ${sorted[i].vesselId} starts ${sorted[i].startHours} < ${sorted[i - 1].vesselId} ends ${sorted[i - 1].endHours}`,
      ).toBeGreaterThanOrEqual(sorted[i - 1].endHours - EPS);
    }
  }
  // Every placeable vessel is placed; every unassigned vessel is unplaceable.
  const unassignedSet = new Set(plan.unassigned);
  for (const v of vessels) {
    const feasible = berths.some((b) => berthFeasible(v, b));
    if (feasible) {
      expect(seen.has(v.id), `feasible vessel ${v.id} left unassigned`).toBe(true);
      expect(unassignedSet.has(v.id), `${v.id} both assigned and unassigned`).toBe(false);
    } else {
      expect(unassignedSet.has(v.id), `unplaceable vessel ${v.id} missing from unassigned`).toBe(true);
    }
  }
  // Totals are consistent with the assignments.
  const waitingSum = plan.assignments.reduce((s, a) => s + a.waitingHours, 0);
  expect(plan.totalWaitingHours).toBeCloseTo(waitingSum, 9);
  const makespan = plan.assignments.reduce((m, a) => Math.max(m, a.endHours), 0);
  expect(plan.makespanHours).toBeCloseTo(makespan, 9);
}
