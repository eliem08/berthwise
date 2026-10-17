import { describe, it, expect } from "vitest";
import { mulberry32 } from "../rng";
import {
  compareAlgorithms,
  planNaive,
  planOptimized,
  planTabu,
  rebuildAfterMove,
  sequencesToPlan,
  validateMove,
} from "../berth";
import { planGA } from "../ga";
import { planALNS } from "../alns";
import { solveExact } from "../exact";
import { scheduleCranes, cranesFreeAt } from "../cranes";
import { planEconomics } from "../economics";
import {
  generateTideWindows,
  isInTideWindow,
  needsTideWindow,
  nextTideWindowStart,
} from "../tide";
import { countRehandles, stackNaive, stackOptimized } from "../yard";
import { simulateRelocations, stackByExpectedRelocations } from "../relocation";
import { computeKpis } from "../kpi";
import { robustnessTradeoff, stressTestPlan, UNCERTAINTY_HALF_WIDTH_HOURS } from "../robust";
import { predictAll } from "../eta";
import type { Berth, BerthPlan, Box, ObjectiveWeights, Vessel } from "../types";
import {
  assertPlanFullyFeasible,
  bruteForceOptimum,
  randomInstance,
  vessel,
  box,
  BERTHS,
  EPS,
} from "./verify-helpers";


/* ------------------------------------------------------------------ */
/* B.9 — exact solver vs independent brute force                        */
/* ------------------------------------------------------------------ */

describe("phase B audit: exact solver vs independent brute force", () => {
  const weightSets: ObjectiveWeights[] = [
    { waiting: 1, fuel: 0, crane: 0 },
    { waiting: 70, fuel: 20, crane: 10 },
    { waiting: 0, fuel: 1, crane: 1 },
  ];

  for (const tides of [false, true]) {
    it(`matches brute force on 8 seeded 5v/2b instances (tides ${tides ? "on" : "off"})`, () => {
      for (let s = 0; s < 8; s++) {
        const { vessels, berths } = randomInstance(1000 + s, 5, 2);
        const weights = weightSets[s % weightSets.length];
        const brute = bruteForceOptimum(vessels, berths, weights, tides);
        const exact = solveExact(vessels, berths, { weights, tidesEnabled: tides });
        expect(exact.provenOptimal, `seed ${s}: not proven`).toBe(true);
        expect(exact.objective, `seed ${s}: objective mismatch`).toBeCloseTo(brute.objective, 6);
        assertPlanFullyFeasible(exact.plan, vessels, berths, { tidesEnabled: tides });
      }
    });
  }

  it("matches brute force with tides on a deep-draft instance", () => {
    const vessels = [
      vessel("A", 0, 8, { draftM: 13.5 }),
      vessel("B", 2, 4, { draftM: 12.1 }),
      vessel("C", 5, 6, { draftM: 9.0 }),
      vessel("D", 9, 3, { draftM: 13.0 }),
    ];
    const brute = bruteForceOptimum(vessels, BERTHS, { waiting: 1, fuel: 0, crane: 0 }, true);
    const exact = solveExact(vessels, BERTHS, { weights: { waiting: 1, fuel: 0, crane: 0 }, tidesEnabled: true });
    expect(exact.provenOptimal).toBe(true);
    expect(exact.objective).toBeCloseTo(brute.objective, 6);
    // Independent tide check: every deep-draft start inside a window.
    const windows = generateTideWindows(200);
    for (const a of exact.plan.assignments) {
      const v = vessels.find((x) => x.id === a.vesselId)!;
      if (needsTideWindow(v)) expect(isInTideWindow(a.startHours, windows)).toBe(true);
    }
  });

  it("all five heuristics score >= the proven optimum on random instances", () => {
    for (let s = 0; s < 5; s++) {
      const { vessels, berths } = randomInstance(2000 + s, 6, 2);
      const weights = { waiting: 1, fuel: 0, crane: 0 };
      const brute = bruteForceOptimum(vessels, berths, weights, false);
      const { results } = compareAlgorithms(vessels, berths, { weights, seed: 5, timeLimitMs: 150 });
      for (const r of results) {
        expect(r.economics.objective, `${r.id} beats optimum (seed ${s})`).toBeGreaterThanOrEqual(
          brute.objective - 1e-6,
        );
        assertPlanFullyFeasible(r.plan, vessels, berths);
      }
    }
  });
});

/* ------------------------------------------------------------------ */
/* B.1 — constraint enforcement                                        */
/* ------------------------------------------------------------------ */

describe("phase B audit: constraint enforcement", () => {
  it("oversize vessels are unassigned, never squeezed onto a short berth", () => {
    const vessels = [
      vessel("BIG", 0, 6, { lengthM: 400 }),
      vessel("OK", 1, 4, { lengthM: 200 }),
    ];
    const planners = [
      planNaive(vessels, BERTHS),
      planOptimized(vessels, BERTHS, { seed: 1, timeLimitMs: 50 }),
      planTabu(vessels, BERTHS, { seed: 1, timeLimitMs: 50 }),
      planGA(vessels, BERTHS, { seed: 1 }),
      planALNS(vessels, BERTHS, { seed: 1 }),
      solveExact(vessels, BERTHS).plan,
    ];
    for (const plan of planners) {
      expect(plan.unassigned).toContain("BIG");
      expect(plan.assignments.some((a) => a.vesselId === "BIG")).toBe(false);
      expect(plan.assignments.some((a) => a.vesselId === "OK")).toBe(true);
    }
  });

  it("grain vessels never land on non-grain berths", () => {
    const vessels = [vessel("G", 0, 6, { cargo: "grain", lengthM: 200 })];
    const noGrainBerths: Berth[] = [
      { id: "B1", name: "B1", lengthM: 350, grainCapable: false, cranes: 3 },
    ];
    const planners = [
      planNaive(vessels, noGrainBerths),
      planOptimized(vessels, noGrainBerths, { seed: 2, timeLimitMs: 50 }),
      planGA(vessels, noGrainBerths, { seed: 2 }),
      planALNS(vessels, noGrainBerths, { seed: 2 }),
      solveExact(vessels, noGrainBerths).plan,
    ];
    for (const plan of planners) {
      expect(plan.unassigned).toContain("G");
      expect(plan.assignments).toHaveLength(0);
    }
  });

  it("deep-draft vessels wait for tide windows (greedy and exact)", () => {
    const vessels = [
      vessel("D1", 0, 6, { draftM: 13.2 }),
      vessel("D2", 4, 6, { draftM: 12.8 }),
      vessel("S1", 1, 6, { draftM: 9.5 }),
    ];
    const windows = generateTideWindows(200);
    for (const plan of [
      planNaive(vessels, BERTHS, { tidesEnabled: true }),
      solveExact(vessels, BERTHS, { tidesEnabled: true }).plan,
    ]) {
      for (const a of plan.assignments) {
        const v = vessels.find((x) => x.id === a.vesselId)!;
        if (needsTideWindow(v)) {
          expect(isInTideWindow(a.startHours, windows), `${v.id} start ${a.startHours}`).toBe(true);
        }
      }
    }
    // Without tides the deep-draft vessel starts immediately at ETA.
    const noTide = planNaive(vessels, BERTHS, { tidesEnabled: false });
    const d1 = noTide.assignments.find((a) => a.vesselId === "D1")!;
    expect(d1.startHours).toBeCloseTo(0, 9);
  });

  it("arrival times are honoured: no start before ETA, waiting is exact", () => {
    for (let s = 0; s < 5; s++) {
      const { vessels, berths } = randomInstance(3000 + s, 6, 3);
      for (const plan of [
        planNaive(vessels, berths, { tidesEnabled: true }),
        planOptimized(vessels, berths, { seed: s, timeLimitMs: 80, tidesEnabled: true }),
        planTabu(vessels, berths, { seed: s, timeLimitMs: 80, tidesEnabled: true }),
        planGA(vessels, berths, { seed: s, tidesEnabled: true }),
        planALNS(vessels, berths, { seed: s, tidesEnabled: true }),
      ]) {
        assertPlanFullyFeasible(plan, vessels, berths, { tidesEnabled: true });
      }
    }
  });
});

/* ------------------------------------------------------------------ */
/* B.2 — crane pool never over-allocated                                */
/* ------------------------------------------------------------------ */

describe("phase B audit: crane pool", () => {
  /** Independent sweep-line peak over crane-assignment intervals. */
  function independentPeak(assignments: { startHours: number; endHours: number; cranes: number }[]): number {
    const events: Array<{ t: number; d: number }> = [];
    for (const a of assignments) {
      events.push({ t: a.startHours, d: a.cranes });
      events.push({ t: a.endHours, d: -a.cranes });
    }
    events.sort((x, y) => x.t - y.t || x.d - y.d);
    let cur = 0;
    let peak = 0;
    for (const e of events) {
      cur += e.d;
      peak = Math.max(peak, cur);
    }
    return peak;
  }

  it("pool holds under heavy overlap, incl. tiny pools", () => {
    // Six vessels, all ETA 0, long handling: maximum contention.
    const vessels = Array.from({ length: 6 }, (_, i) =>
      vessel(`V${i + 1}`, 0, 12, { teu: 3000, lengthM: 250 }),
    );
    for (const poolLimit of [1, 2, 8]) {
      const raw = planNaive(vessels, BERTHS);
      const { plan, schedule } = scheduleCranes(raw, vessels, BERTHS, { poolLimit });
      const peak = independentPeak(schedule.assignments);
      expect(peak, `pool ${poolLimit}`).toBeLessThanOrEqual(poolLimit);
      expect(schedule.peakUsage, `pool ${poolLimit} reported peak`).toBe(peak);
      // Crane re-timing must not break berth occupancy.
      assertPlanFullyFeasible(plan, vessels, BERTHS);
    }
  });

  it("crane-scheduled plans stay feasible on random instances", () => {
    for (let s = 0; s < 5; s++) {
      const { vessels, berths } = randomInstance(4000 + s, 8, 3);
      const raw = planOptimized(vessels, berths, { seed: s, timeLimitMs: 100, tidesEnabled: true });
      const { plan, schedule } = scheduleCranes(raw, vessels, berths, {
        poolLimit: 4,
        tidesEnabled: true,
      });
      expect(independentPeak(schedule.assignments)).toBeLessThanOrEqual(4);
      assertPlanFullyFeasible(plan, vessels, berths, { tidesEnabled: true });
    }
  });

  it("validateMove rejects a drop when the crane pool is saturated", () => {
    const berths: Berth[] = [
      { id: "B1", name: "B1", lengthM: 350, grainCapable: false, cranes: 4 },
      { id: "B2", name: "B2", lengthM: 350, grainCapable: false, cranes: 4 },
      { id: "B3", name: "B3", lengthM: 350, grainCapable: false, cranes: 4 },
    ];
    // Two vessels each needing 4 cranes (teu 4800 -> ceil(4800/1200)=4), overlapping, pool = 8.
    const vessels = [
      vessel("A", 0, 10, { teu: 4800 }),
      vessel("B", 0, 10, { teu: 4800 }),
      vessel("C", 0, 10, { teu: 4800, lengthM: 200 }),
    ];
    const raw = sequencesToPlan(
      new Map([["B1", ["A"]], ["B2", ["B"]]]),
      vessels,
      {},
    );
    const { plan } = scheduleCranes(raw, vessels, berths, { poolLimit: 8 });
    // Drop C onto the EMPTY berth B3 at h+1: no berth overlap, but the pool
    // is fully used by A+B, so the crane check must reject it.
    const verdict = validateMove(plan, vessels, berths, "C", "B3", 1, { poolLimit: 8 });
    expect(verdict.valid).toBe(false);
    expect(verdict.reason).toMatch(/crane/i);
    // And cranesFreeAt agrees.
    expect(cranesFreeAt(plan.assignments, vessels, berths, "C", "B3", 1, 8)).toBeLessThan(0);
  });

  it("berthBusyHours covers every berth after crane scheduling (KPI fix)", () => {
    const vessels = [vessel("A", 0, 6, { lengthM: 200 })];
    const { plan } = scheduleCranes(planNaive(vessels, BERTHS), vessels, BERTHS, {});
    expect(Object.keys(plan.berthBusyHours).sort()).toEqual(["B1", "B2"]);
    expect(plan.berthBusyHours["B2"]).toBe(0);
    // Mean utilisation is over ALL berths now: one berth busy 6h of 6h makespan.
    const yard = stackOptimized([box("x1", 1)], 1, 4);
    const kpis = computeKpis(plan, yard);
    expect(kpis.berthUtilizationPct).toBeCloseTo(50, 6);
  });
});

/* ------------------------------------------------------------------ */
/* B.3 — yard placements and relocation sequences                      */
/* ------------------------------------------------------------------ */

describe("phase B audit: yard and relocations", () => {
  it("countRehandles matches hand-computed values", () => {
    // A(rank1) on top of B(rank2): nothing buried.
    expect(countRehandles([[box("B", 2), box("A", 1)]])).toBe(0);
    // A(rank1) buried under B(rank2): one rehandle to reach A.
    expect(countRehandles([[box("A", 1), box("B", 2)]])).toBe(1);
    // Three deep: ranks 1,2,3 bottom-up is 0+1+... check: [r3 bottom, r2, r1 top] -> 0.
    expect(
      countRehandles([[box("C", 3), box("B", 2), box("A", 1)]]),
    ).toBe(0);
    // [r1 bottom, r2, r3 top]: retrieve r1 -> 2 above; then r2 -> 1 above... total 2+... let's see:
    // rank1: above = 2 (r2,r3) -> 2; stack becomes [r1]... wait no: splice(j) removes from j upward:
    // rank1 at j=0: rehandles += 3-1-0 = 2; stack=[] (all removed incl. target). Then ranks 2,3 absent -> 0. Total 2.
    expect(countRehandles([[box("A", 1), box("B", 2), box("C", 3)]])).toBe(2);
  });

  it("stacking never exceeds maxHeight and places every box exactly once", () => {
    const rand = mulberry32(99);
    for (let trial = 0; trial < 20; trial++) {
      const n = 5 + Math.floor(rand() * 15);
      const boxes = Array.from({ length: n }, (_, i) => box(`bx${i}`, i + 1));
      // Shuffle ranks.
      for (let i = boxes.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [boxes[i].retrievalRank, boxes[j].retrievalRank] = [boxes[j].retrievalRank, boxes[i].retrievalRank];
      }
      const stacks = 2 + Math.floor(rand() * 3);
      const height = 3 + Math.floor(rand() * 3);
      if (stacks * height < n) continue; // would overflow; skip
      for (const fn of [stackNaive, stackOptimized, stackByExpectedRelocations]) {
        const sol = fn(boxes, stacks, height);
        const flat = sol.stacks.flat();
        expect(flat).toHaveLength(n);
        expect(new Set(flat.map((b) => b.id)).size).toBe(n);
        for (const s of sol.stacks) expect(s.length).toBeLessThanOrEqual(height);
        expect(sol.rehandles).toBe(countRehandles(sol.stacks));
      }
    }
  });

  it("relocation move sequences are legal step by step", () => {
    const rand = mulberry32(7);
    for (let trial = 0; trial < 20; trial++) {
      const n = 6 + Math.floor(rand() * 10);
      const boxes = Array.from({ length: n }, (_, i) => box(`b${i}`, i + 1));
      for (const fn of [stackNaive, stackOptimized, stackByExpectedRelocations]) {
        const sol = fn(boxes, 3, 5);
        const withBuffer = [...sol.stacks.map((s) => s.map((b) => ({ ...b }))), []];
        const result = simulateRelocations(withBuffer, 5);
        // Replay the move log on a fresh copy: every move must take the top
        // box of its fromStack and land on a stack with room.
        const yard = withBuffer.map((s) => s.map((b) => ({ ...b })));
        const retrieved = new Set<number>();
        let moveIdx = 0;
        for (let rank = 1; rank <= n; rank++) {
          while (
            moveIdx < result.moves.length &&
            result.moves[moveIdx].servingRank === rank
          ) {
            const m = result.moves[moveIdx];
            const from = yard[m.fromStack];
            const top = from[from.length - 1];
            expect(top.id, `trial ${trial}: moved box not on top`).toBe(m.boxId);
            expect(yard[m.toStack].length, `trial ${trial}: dest over height`).toBeLessThan(5);
            yard[m.toStack].push(from.pop()!);
            moveIdx++;
          }
          // Target of this rank must now be retrievable (nothing above it
          // except boxes already accounted for as moves).
          let found = false;
          for (const s of yard) {
            const idx = s.findIndex((b) => b.retrievalRank === rank);
            if (idx >= 0) {
              expect(idx, `trial ${trial}: rank ${rank} still buried`).toBe(s.length - 1);
              s.splice(idx, 1);
              found = true;
              break;
            }
          }
          expect(found, `trial ${trial}: rank ${rank} missing`).toBe(true);
          retrieved.add(rank);
        }
        expect(moveIdx).toBe(result.moves.length);
        expect(retrieved.size).toBe(n);
        expect(yard.every((s) => s.length === 0), `trial ${trial}: yard not empty`).toBe(true);
      }
    }
  });

  it("relocation count >= legacy blocking count on the same stacks", () => {
    const rand = mulberry32(21);
    for (let trial = 0; trial < 30; trial++) {
      const n = 4 + Math.floor(rand() * 12);
      const boxes = Array.from({ length: n }, (_, i) => box(`q${i}`, i + 1));
      const sol = stackNaive(boxes, 3, 6);
      const withBuffer = [...sol.stacks.map((s) => s.map((b) => ({ ...b }))), []];
      const relocation = simulateRelocations(withBuffer, 6);
      expect(relocation.rehandles).toBeGreaterThanOrEqual(sol.rehandles);
    }
  });

  it("deadlock throws a clear error instead of hanging", () => {
    // Two full stacks, a blocking box with nowhere to go.
    const stacks = [
      [box("A", 1), box("B", 2)],
      [box("C", 3), box("D", 4)],
    ];
    expect(() => simulateRelocations(stacks, 2)).toThrow(/deadlock/);
  });

  it("non-permutation retrieval ranks are rejected loudly", () => {
    const dup = [box("a", 1), box("b", 1)];
    expect(() => stackNaive(dup, 2, 4)).toThrow(/duplicate retrievalRank/);
    expect(() => stackOptimized(dup, 2, 4)).toThrow(/duplicate retrievalRank/);
    expect(() => stackByExpectedRelocations(dup, 2, 4)).toThrow(/duplicate retrievalRank/);
    const missing = [box("a", 1), box("b", 3)];
    expect(() => stackNaive(missing, 2, 4)).toThrow(/retrievalRank/);
    expect(() => countRehandles([[box("a", 0)]])).toThrow(/retrievalRank/);
    expect(() => simulateRelocations([[box("a", 2)]], 4)).toThrow(/retrievalRank/);
  });
});

/* ------------------------------------------------------------------ */
/* B.7 — invalid inputs fail loudly                                     */
/* ------------------------------------------------------------------ */

describe("phase B audit: invalid inputs", () => {
  const goodBerths = BERTHS;
  const goodVessels = [vessel("A", 0, 4)];

  it("rejects NaN / negative / zero numeric fields", () => {
    expect(() => planNaive([vessel("A", NaN, 4)], goodBerths)).toThrow(/finite/);
    expect(() => planOptimized([vessel("A", 0, -2)], goodBerths)).toThrow(/handlingHours/);
    expect(() => planTabu([vessel("A", 0, 0)], goodBerths)).toThrow(/handlingHours/);
    expect(() => planGA([vessel("A", 0, 4, { lengthM: 0 })], goodBerths)).toThrow(/lengthM/);
    expect(() => planALNS([vessel("A", 0, 4, { draftM: -1 })], goodBerths)).toThrow(/draftM/);
    expect(() => solveExact(goodVessels, [{ ...goodBerths[0], cranes: 1.5 }])).toThrow(/integer/);
    expect(() => scheduleCranes(planNaive(goodVessels, goodBerths), goodVessels, goodBerths, { poolLimit: -1 })).toThrow(
      /poolLimit/,
    );
    expect(() => compareAlgorithms(goodVessels, goodVessels as unknown as Berth[])).toThrow();
  });

  it("rejects duplicate ids", () => {
    expect(() => planNaive([vessel("A", 0, 4), vessel("A", 1, 4)], goodBerths)).toThrow(/duplicate vessel/);
    expect(() => planNaive(goodVessels, [goodBerths[0], { ...goodBerths[0] }])).toThrow(/duplicate berth/);
  });

  it("rejects non-array inputs", () => {
    expect(() => planNaive(null as unknown as Vessel[], goodBerths)).toThrow(/array/);
    expect(() => stackNaive([box("a", 1)], 0, 4)).toThrow(/stackCount/);
    expect(() => stackOptimized([box("a", 1)], 2, 0)).toThrow(/maxHeight/);
  });

  it("empty inputs yield an empty plan, not an error", () => {
    for (const plan of [
      planNaive([], []),
      planOptimized([], BERTHS),
      planTabu([], BERTHS),
      planGA([], BERTHS),
      planALNS([], BERTHS),
    ]) {
      expect(plan.assignments).toHaveLength(0);
      expect(plan.unassigned).toHaveLength(0);
    }
    expect(solveExact([], []).plan.assignments).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/* B.8 — seeded reproducibility                                         */
/* ------------------------------------------------------------------ */

describe("phase B audit: seeded reproducibility", () => {
  it("same seed -> identical results for every randomized algorithm", () => {
    const { vessels, berths } = randomInstance(555, 10, 3);
    const opts = { seed: 11, timeLimitMs: 120, weights: { waiting: 1, fuel: 0, crane: 0 } };
    const planners: Array<[string, (v: Vessel[], b: Berth[]) => BerthPlan]> = [
      ["annealing", (v, b) => planOptimized(v, b, opts)],
      ["tabu", (v, b) => planTabu(v, b, opts)],
      ["ga", (v, b) => planGA(v, b, opts)],
      ["alns", (v, b) => planALNS(v, b, opts)],
    ];
    for (const [name, fn] of planners) {
      const first = JSON.stringify(fn(vessels, berths));
      const second = JSON.stringify(fn(vessels, berths));
      expect(second, `${name} not reproducible`).toBe(first);
    }
    const c1 = JSON.stringify(compareAlgorithms(vessels, berths, opts));
    const c2 = JSON.stringify(compareAlgorithms(vessels, berths, opts));
    expect(c2).toBe(c1);
    const e1 = solveExact(vessels.slice(0, 6), berths, opts).objective;
    const e2 = solveExact(vessels.slice(0, 6), berths, opts).objective;
    expect(e2).toBe(e1);
  });

  it("ETA predictions and stress tests are reproducible", () => {
    const { vessels } = randomInstance(777, 8, 2);
    const legs: Record<string, { distanceNm: number; speedKn: number }> = {};
    for (const v of vessels) legs[v.id] = { distanceNm: 500, speedKn: 14 };
    expect(JSON.stringify(predictAll(vessels, legs, 0.5, 7))).toBe(
      JSON.stringify(predictAll(vessels, legs, 0.5, 7)),
    );
    const plan = planOptimized(vessels, BERTHS, { seed: 3, timeLimitMs: 60 });
    const s1 = stressTestPlan(plan, vessels, BERTHS, {}, 50, 7, 2, UNCERTAINTY_HALF_WIDTH_HOURS);
    const s2 = stressTestPlan(plan, vessels, BERTHS, {}, 50, 7, 2, UNCERTAINTY_HALF_WIDTH_HOURS);
    expect(s2).toEqual(s1);
  });
});

/* ------------------------------------------------------------------ */
/* B.4 — comparison fairness                                            */
/* ------------------------------------------------------------------ */

describe("phase B audit: comparison fairness", () => {
  it("same instances, same objective, deterministic winner", () => {
    for (let s = 0; s < 4; s++) {
      const { vessels, berths } = randomInstance(6000 + s, 9, 3);
      const weights = { waiting: 60, fuel: 25, crane: 15 };
      const opts = { weights, seed: 9, timeLimitMs: 120, tidesEnabled: true };
      const first = compareAlgorithms(vessels, berths, opts);
      const second = compareAlgorithms(vessels, berths, opts);
      expect(first.results.map((r) => r.id)).toEqual(["greedy", "annealing", "tabu", "ga", "alns"]);
      // Every reported objective is recomputed from the same weights.
      for (const r of first.results) {
        const recomputed = planEconomics(r.plan, vessels, berths, weights).objective;
        expect(r.economics.objective, `${r.id} objective mismatch`).toBeCloseTo(recomputed, 12);
      }
      // Winner is the argmin (ties -> first in greedy..alns order).
      const order = ["greedy", "annealing", "tabu", "ga", "alns"];
      let expected = "greedy";
      let best = Number.POSITIVE_INFINITY;
      for (const r of first.results) {
        if (r.economics.objective < best - 1e-9) {
          best = r.economics.objective;
          expected = r.id;
        }
      }
      expect(first.winner).toBe(expected);
      void order;
      expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    }
  });
});

/* ------------------------------------------------------------------ */
/* B.6 — robustness metrics are what they claim to be                   */
/* ------------------------------------------------------------------ */

describe("phase B audit: robustness metrics", () => {
  it("tradeoff curve values are sane and labelled honestly", () => {
    const { vessels, berths } = randomInstance(8080, 8, 2);
    const result = robustnessTradeoff(vessels, berths, { seed: 4, timeLimitMs: 80 }, [0, 4, 8], 60, 7, 2);
    expect(result.points).toHaveLength(3);
    expect(result.samples).toBe(60);
    expect(result.graceHours).toBe(2);
    expect(result.uncertaintyHalfWidthHours).toBe(UNCERTAINTY_HALF_WIDTH_HOURS);
    // Buffer 0 costs nothing by construction.
    expect(result.points[0].costOfRobustnessPct).toBeCloseTo(0, 9);
    for (const p of result.points) {
      expect(p.feasibilityRate).toBeGreaterThanOrEqual(0);
      expect(p.feasibilityRate).toBeLessThanOrEqual(1);
      expect(p.meanSlipHours).toBeGreaterThanOrEqual(0);
      expect(p.worstSlipHours).toBeGreaterThanOrEqual(p.meanSlipHours - 1e-9);
      expect(Number.isFinite(p.nominalObjective)).toBe(true);
    }
    // Feasibility is monotone non-decreasing in buffer on the same seed.
    for (let i = 1; i < result.points.length; i++) {
      expect(result.points[i].feasibilityRate).toBeGreaterThanOrEqual(
        result.points[i - 1].feasibilityRate - 1e-9,
      );
    }
  });
});

/* ------------------------------------------------------------------ */
/* rebuildAfterMove honours the drop position                             */
/* ------------------------------------------------------------------ */

describe("phase B audit: rebuildAfterMove", () => {
  it("honours the requested start and returns a feasible plan", () => {
    const vessels = [
      vessel("A", 0, 6, { lengthM: 200 }),
      vessel("B", 2, 6, { lengthM: 200 }),
    ];
    const plan = planNaive(vessels, BERTHS);
    const { plan: moved, craneSchedule } = rebuildAfterMove(plan, vessels, BERTHS, "A", "B2", 10, {});
    const a = moved.assignments.find((x) => x.vesselId === "A")!;
    expect(a.berthId).toBe("B2");
    expect(a.startHours).toBeGreaterThanOrEqual(10 - EPS);
    assertPlanFullyFeasible(moved, vessels, BERTHS);
    expect(craneSchedule.assignments).toHaveLength(moved.assignments.length);
    // Dragging onto an infeasible berth is rejected up front by validateMove.
    expect(validateMove(plan, vessels, BERTHS, "A", "B9", 10).valid).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* validateMove spot checks                                             */
/* ------------------------------------------------------------------ */

describe("phase B audit: validateMove", () => {
  it("rejects too-long vessels, pre-ETA starts, overlaps and off-tide starts", () => {
    const vessels = [
      vessel("A", 0, 6, { lengthM: 200 }),
      vessel("OTHER", 0, 4, { lengthM: 200 }),
      vessel("BIG", 0, 6, { lengthM: 400 }),
      vessel("DEEP", 2, 6, { draftM: 13 }),
    ];
    const plan = planNaive([vessels[0]], BERTHS, { tidesEnabled: true });
    // Too long.
    expect(validateMove(plan, vessels, BERTHS, "BIG", "B1", 10).valid).toBe(false);
    // Before ETA.
    expect(validateMove(plan, vessels, BERTHS, "A", "B2", -1).valid).toBe(false);
    // Overlap: OTHER dropped onto B1 at h+3 collides with A's [0,6] there.
    // (The dragged vessel's own assignment is ignored by design.)
    expect(validateMove(plan, vessels, BERTHS, "OTHER", "B1", 3).valid).toBe(false);
    // But dragging A itself to B1 at h+3 is allowed (own assignment excluded,
    // drop position honoured, re-sweep keeps feasibility).
    expect(validateMove(plan, vessels, BERTHS, "A", "B1", 3).valid).toBe(true);
    // Deep-draft vessel outside a tide window.
    const windows = generateTideWindows(200);
    const outside = 30; // find a t outside all windows
    expect(windows.every((w) => outside < w.startHours || outside >= w.endHours)).toBe(true);
    const deepVerdict = validateMove(plan, vessels, BERTHS, "DEEP", "B2", outside, { tidesEnabled: true });
    expect(deepVerdict.valid).toBe(false);
    expect(deepVerdict.reason).toMatch(/tide/i);
    // Unknown ids.
    expect(validateMove(plan, vessels, BERTHS, "GHOST", "B1", 10).valid).toBe(false);
    expect(validateMove(plan, vessels, BERTHS, "A", "B9", 10).valid).toBe(false);
  });
});
