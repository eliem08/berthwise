import { describe, it, expect } from "vitest";
import { mulberry32 } from "../rng";
import {
  planNaive,
  planOptimized,
  planTabu,
  compareAlgorithms,
} from "../berth";
import { planGA } from "../ga";
import { planALNS } from "../alns";
import { solveExact, EXACT_MAX_VESSELS } from "../exact";
import { scheduleCranes } from "../cranes";
import { CRANE_POOL_LIMIT } from "../economics";
import { countRehandles, stackNaive, stackOptimized } from "../yard";
import { simulateRelocations } from "../relocation";
import { assertPlanFullyFeasible, randomInstance, EPS } from "./verify-helpers";
import type { Berth, BerthPlan, Box, CraneAssignment, Vessel } from "../types";

/**
 * Phase D.2 — property-based plan-validity tests.
 *
 * A small self-contained PRNG (mulberry32, from ../rng) drives random
 * berth-planning and yard instances. Every property is an invariant that
 * must hold for EVERY generated instance; a single counterexample is a
 * defect. Same-seed runs are checked for bit-identical reproducibility.
 *
 * Instances are SYNTHETIC (seeded PRNG draws from plausible ranges) — they
 * prove software correctness (the code honours its own constraints), not
 * real-world accuracy. See fixtures/synthetic/ for the real-data story.
 */

/* ------------------------------------------------------------------ */
/* Berth planning properties                                           */
/* ------------------------------------------------------------------ */

interface PlannerCase {
  id: string;
  run: (vessels: Vessel[], berths: Berth[], seed: number) => BerthPlan;
  seeded: boolean;
}

const PLANNERS: PlannerCase[] = [
  { id: "greedy", run: (v, b) => planNaive(v, b, { tidesEnabled: false }), seeded: false },
  {
    id: "annealing",
    run: (v, b, s) => planOptimized(v, b, { seed: s, timeLimitMs: 30, tidesEnabled: false }),
    seeded: true,
  },
  {
    id: "tabu",
    run: (v, b, s) => planTabu(v, b, { seed: s, timeLimitMs: 30, tidesEnabled: false }),
    seeded: true,
  },
  { id: "ga", run: (v, b, s) => planGA(v, b, { seed: s }), seeded: true },
  { id: "alns", run: (v, b, s) => planALNS(v, b, { seed: s }), seeded: true },
];

const N_PROPERTY_INSTANCES = 25;

/** Random instance shapes: 1..12 vessels, 1..4 berths, tides on/off. */
function propertyInstance(i: number): { vessels: Vessel[]; berths: Berth[]; tides: boolean } {
  const rand = mulberry32(9000 + i);
  const nVessels = 1 + Math.floor(rand() * 12);
  const nBerths = 1 + Math.floor(rand() * 4);
  const { vessels, berths } = randomInstance(9000 + i, nVessels, nBerths);
  return { vessels, berths, tides: rand() < 0.5 };
}

/** Independent sweep-line: max simultaneous crane usage, computed from the raw intervals. */
function sweepPeak(assignments: CraneAssignment[]): number {
  const events: Array<[number, number]> = [];
  for (const a of assignments) {
    events.push([a.startHours, a.cranes]);
    events.push([a.endHours, -a.cranes]);
  }
  events.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  let inUse = 0;
  let peak = 0;
  for (const [, delta] of events) {
    inUse += delta;
    if (inUse > peak) peak = inUse;
  }
  return peak;
}

describe("phase D: plan-validity properties over random instances", () => {
  for (const planner of PLANNERS) {
    it(`${planner.id}: every random instance yields a fully feasible plan`, () => {
      for (let i = 0; i < N_PROPERTY_INSTANCES; i++) {
        const { vessels, berths, tides } = propertyInstance(i);
        const before = JSON.stringify([vessels, berths]);
        const plan = planner.run(vessels, berths, 1234);
        // Planners must never mutate their inputs.
        expect(JSON.stringify([vessels, berths]), `${planner.id} instance ${i}: inputs mutated`).toBe(
          before,
        );
        assertPlanFullyFeasible(plan, vessels, berths, { tidesEnabled: false });
      }
    });
  }

  it("exact solver: feasible on every random instance at/below the 8-vessel ceiling", () => {
    let checked = 0;
    for (let i = 0; i < N_PROPERTY_INSTANCES; i++) {
      const { vessels, berths, tides } = propertyInstance(i);
      if (vessels.length > EXACT_MAX_VESSELS) continue;
      const exact = solveExact(vessels, berths, { tidesEnabled: tides });
      expect(exact.provenOptimal, `instance ${i}: not proven`).toBe(true);
      assertPlanFullyFeasible(exact.plan, vessels, berths, { tidesEnabled: tides });
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("crane pool is never exceeded: independent sweep over scheduleCranes output", () => {
    for (let i = 0; i < N_PROPERTY_INSTANCES; i++) {
      const { vessels, berths } = propertyInstance(i);
      const tightPool = Math.max(1, Math.floor(CRANE_POOL_LIMIT / 2));
      for (const planner of PLANNERS) {
        const raw = planner.run(vessels, berths, 777);
        const { plan, schedule } = scheduleCranes(raw, vessels, berths, { poolLimit: tightPool });
        expect(schedule.poolLimit).toBe(tightPool);
        expect(sweepPeak(schedule.assignments), `${planner.id} instance ${i}`).toBe(
          schedule.peakUsage,
        );
        expect(schedule.peakUsage, `${planner.id} instance ${i}: pool exceeded`).toBeLessThanOrEqual(
          tightPool,
        );
        assertPlanFullyFeasible(plan, vessels, berths, { tidesEnabled: false });
      }
    }
  });
});

describe("phase D: same-seed reproducibility", () => {
  it("seeded planners are bit-identical across same-seed runs", () => {
    for (let i = 0; i < 10; i++) {
      const { vessels, berths } = propertyInstance(i);
      for (const planner of PLANNERS) {
        if (!planner.seeded) continue;
        const a = planner.run(vessels, berths, 4242);
        const b = planner.run(vessels, berths, 4242);
        expect(JSON.stringify(a), `${planner.id} instance ${i}: not reproducible`).toBe(
          JSON.stringify(b),
        );
      }
    }
  });

  it("different seeds may diverge (PRNG is actually consumed)", () => {
    // Sanity: the seed does something. Use annealing, which is the most
    // seed-sensitive planner, on a non-trivial instance.
    const { vessels, berths } = propertyInstance(3);
    const seen = new Set<string>();
    for (let s = 1; s <= 8; s++) {
      seen.add(JSON.stringify(planOptimized(vessels, berths, { seed: s, timeLimitMs: 30 })));
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it("compareAlgorithms is deterministic end to end", () => {
    const { vessels, berths } = propertyInstance(5);
    const opts = { seed: 99, timeLimitMs: 60 };
    const a = compareAlgorithms(vessels, berths, opts);
    const b = compareAlgorithms(vessels, berths, opts);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

/* ------------------------------------------------------------------ */
/* Yard properties                                                      */
/* ------------------------------------------------------------------ */

function randomYard(i: number): { stacks: Box[][]; maxHeight: number } {
  const rand = mulberry32(60000 + i);
  const stackCount = 2 + Math.floor(rand() * 4);
  const maxHeight = 3 + Math.floor(rand() * 3);
  // Leave at least one full stack-height of spare capacity: the relocation
  // model needs somewhere to put blocking boxes (RELOCATION_BUFFER_STACKS).
  const nBoxes = 1 + Math.floor(rand() * (stackCount * (maxHeight - 1)));
  // Ranks 1..N shuffled; boxes dropped into random stacks with room.
  const ranks = Array.from({ length: nBoxes }, (_, k) => k + 1);
  for (let k = ranks.length - 1; k > 0; k--) {
    const j = Math.floor(rand() * (k + 1));
    [ranks[k], ranks[j]] = [ranks[j], ranks[k]];
  }
  const stacks: Box[][] = Array.from({ length: stackCount }, () => []);
  for (let k = 0; k < nBoxes; k++) {
    const candidates = stacks.map((s, sIdx) => sIdx).filter((sIdx) => stacks[sIdx].length < maxHeight);
    const sIdx = candidates[Math.floor(rand() * candidates.length)];
    stacks[sIdx].push({ id: `BX${k}`, retrievalRank: ranks[k], destination: "D" });
  }
  return { stacks, maxHeight };
}

const N_YARD_INSTANCES = 40;

describe("phase D: yard invariants over random yards", () => {
  it("countRehandles is pure and deterministic", () => {
    for (let i = 0; i < N_YARD_INSTANCES; i++) {
      const { stacks } = randomYard(i);
      const before = JSON.stringify(stacks);
      const a = countRehandles(stacks);
      const b = countRehandles(stacks);
      expect(JSON.stringify(stacks), `instance ${i}: input mutated`).toBe(before);
      expect(a).toBe(b);
      expect(Number.isInteger(a) && a >= 0, `instance ${i}`).toBe(true);
    }
  });

  it("stackNaive / stackOptimized respect maxHeight and place every box", () => {
    for (let i = 0; i < N_YARD_INSTANCES; i++) {
      const rand = mulberry32(61000 + i);
      const stackCount = 2 + Math.floor(rand() * 4);
      const maxHeight = 3 + Math.floor(rand() * 3);
      const nBoxes = 1 + Math.floor(rand() * (stackCount * maxHeight - 1));
      const ranks = Array.from({ length: nBoxes }, (_, k) => k + 1);
      for (let k = ranks.length - 1; k > 0; k--) {
        const j = Math.floor(rand() * (k + 1));
        [ranks[k], ranks[j]] = [ranks[j], ranks[k]];
      }
      const boxes: Box[] = ranks.map((r, k) => ({ id: `BX${k}`, retrievalRank: r, destination: "D" }));
      for (const stack of [stackNaive, stackOptimized]) {
        const sol = stack(boxes, stackCount, maxHeight);
        expect(sol.totalBoxes).toBe(nBoxes);
        for (const s of sol.stacks) {
          expect(s.length, `${stack.name} instance ${i}: height`).toBeLessThanOrEqual(maxHeight);
        }
        // Every input box appears exactly once (rank multiset preserved).
        const outRanks = sol.stacks.flat().map((b) => b.retrievalRank).sort((x, y) => x - y);
        expect(outRanks).toEqual(ranks.slice().sort((x, y) => x - y));
        expect(sol.rehandles, `${stack.name} instance ${i}`).toBe(countRehandles(sol.stacks));
        // Deterministic.
        expect(JSON.stringify(stack(boxes, stackCount, maxHeight).stacks)).toBe(
          JSON.stringify(sol.stacks),
        );
      }
    }
  });

  it("simulateRelocations: replay honours the relocation semantics", () => {
    for (let i = 0; i < N_YARD_INSTANCES; i++) {
      const { stacks, maxHeight } = randomYard(i);
      const result = simulateRelocations(stacks, maxHeight);
      expect(result.rehandles, `instance ${i}: rehandles != moves`).toBe(result.moves.length);

      // Replay every move on a scratch copy and check the semantics.
      const yard: Box[][] = stacks.map((s) => s.map((b) => ({ ...b })));
      const rankOf = new Map(yard.flat().map((b) => [b.id, b.retrievalRank]));
      const total = yard.reduce((s, st) => s + st.length, 0);
      let moveIdx = 0;
      for (let rank = 1; rank <= total; rank++) {
        while (moveIdx < result.moves.length && result.moves[moveIdx].servingRank === rank) {
          const m = result.moves[moveIdx++];
          const from = yard[m.fromStack];
          const top = from[from.length - 1];
          expect(top?.id, `instance ${i} move ${moveIdx}: moved box not on top`).toBe(m.boxId);
          expect(yard[m.toStack].length, `instance ${i} move ${moveIdx}: destination full`).toBeLessThan(
            maxHeight,
          );
          expect(rankOf.get(m.boxId)!, `instance ${i} move ${moveIdx}: serving a dead box`).toBeGreaterThan(
            rank,
          );
          from.pop();
          yard[m.toStack].push(top!);
        }
        // The served box must now be on top of its stack (nothing buries it).
        let found = false;
        for (let s = 0; s < yard.length && !found; s++) {
          const idx = yard[s].findIndex((b) => b.retrievalRank === rank);
          if (idx >= 0) {
            expect(idx, `instance ${i}: rank ${rank} buried after relocations`).toBe(
              yard[s].length - 1,
            );
            yard[s].pop();
            found = true;
          }
        }
        expect(found, `instance ${i}: rank ${rank} missing`).toBe(true);
        for (const st of yard) {
          expect(st.length, `instance ${i}: height exceeded`).toBeLessThanOrEqual(maxHeight);
        }
      }
      expect(moveIdx, `instance ${i}: unreplayed moves`).toBe(result.moves.length);
      expect(yard.flat().length, `instance ${i}: yard not empty at end`).toBe(0);
    }
  });

  it("simulateRelocations is deterministic", () => {
    for (let i = 0; i < 10; i++) {
      const { stacks, maxHeight } = randomYard(i);
      const a = simulateRelocations(stacks, maxHeight);
      const b = simulateRelocations(stacks, maxHeight);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    }
  });
});
