import { describe, it, expect } from "vitest";
import { solveExact, gapAgainstExact } from "../exact";
import { compareAlgorithms, planNaive } from "../berth";
import { planEconomics } from "../economics";
import type { Berth, Vessel } from "../types";

const BERTHS: Berth[] = [
  { id: "B1", name: "Berth 1", lengthM: 350, grainCapable: false, cranes: 3 },
  { id: "B2", name: "Berth 2", lengthM: 350, grainCapable: true, cranes: 3 },
];

function vessel(
  id: string,
  etaHours: number,
  handlingHours: number,
  lengthM = 200,
  cargo: "container" | "grain" = "container",
): Vessel {
  return {
    id,
    name: id,
    line: "Test",
    etaHours,
    lengthM,
    draftM: 10,
    cargo,
    handlingHours,
    teu: 1000,
    origin: "Test",
  };
}

const WEIGHTS = { waiting: 1, fuel: 0, crane: 0 };

describe("exact branch-and-bound", () => {
  it("finds the non-ETA-order optimum (short job jumps the queue)", () => {
    // A: ETA 0, 10h handling. B: ETA 1, 1h handling. One berth.
    // ETA order (A then B): waiting = 0 + 9 = 9.
    // B-first: B waits 0, A starts at 2, waits 2. Total = 2. Optimum = 2.
    const vessels = [vessel("A", 0, 10), vessel("B", 1, 1)];
    const oneBerth = BERTHS.slice(0, 1);
    const exact = solveExact(vessels, oneBerth, { weights: WEIGHTS });
    expect(exact.provenOptimal).toBe(true);
    expect(exact.plan.totalWaitingHours).toBeCloseTo(2, 9);
    const order = exact.plan.assignments
      .slice()
      .sort((a, b) => a.startHours - b.startHours)
      .map((a) => a.vesselId);
    expect(order).toEqual(["B", "A"]);
  });

  it("matches unpruned brute force on tiny instances", () => {
    const vessels = [
      vessel("V1", 0, 6),
      vessel("V2", 2, 4),
      vessel("V3", 3, 8),
      vessel("V4", 1, 3),
      vessel("V5", 5, 5),
    ];
    const pruned = solveExact(vessels, BERTHS, { weights: WEIGHTS });
    const brute = solveExact(vessels, BERTHS, { weights: WEIGHTS }, 10_000_000, false);
    expect(pruned.provenOptimal).toBe(true);
    expect(pruned.objective).toBeCloseTo(brute.objective, 9);
  });

  it("matches unpruned brute force with tides on", () => {
    const vessels = [
      vessel("V1", 0, 6),
      vessel("V2", 2, 4),
      vessel("V3", 3, 8),
      vessel("V4", 1, 3),
    ];
    // Deep drafts so tide windows bind.
    vessels[0].draftM = 13;
    vessels[2].draftM = 13;
    const pruned = solveExact(vessels, BERTHS, { weights: WEIGHTS, tidesEnabled: true });
    const brute = solveExact(vessels, BERTHS, { weights: WEIGHTS, tidesEnabled: true }, 10_000_000, false);
    expect(pruned.provenOptimal).toBe(true);
    expect(pruned.objective).toBeCloseTo(brute.objective, 9);
  });

  it("never scores worse than any heuristic, and gaps are non-negative", () => {
    const vessels = [
      vessel("V1", 0, 6),
      vessel("V2", 2, 4),
      vessel("V3", 3, 8),
      vessel("V4", 1, 3),
      vessel("V5", 5, 5),
      vessel("V6", 4, 7),
    ];
    const exact = solveExact(vessels, BERTHS, { weights: WEIGHTS, seed: 1, timeLimitMs: 100 });
    expect(exact.provenOptimal).toBe(true);
    const { results } = compareAlgorithms(vessels, BERTHS, {
      weights: WEIGHTS,
      seed: 1,
      timeLimitMs: 100,
    });
    for (const r of results) {
      expect(r.economics.objective).toBeGreaterThanOrEqual(exact.objective - 1e-9);
      const gap = gapAgainstExact(r.economics.objective, exact.objective);
      expect(gap).not.toBeNull();
      expect(gap!).toBeGreaterThanOrEqual(-1e-9);
    }
  });

  it("proves optimality on an 8-vessel instance within the node cap", () => {
    const vessels = [
      vessel("V1", 0, 6),
      vessel("V2", 2, 4),
      vessel("V3", 3, 8),
      vessel("V4", 1, 3),
      vessel("V5", 5, 5),
      vessel("V6", 4, 7),
      vessel("V7", 7, 4),
      vessel("V8", 6, 6),
    ];
    const exact = solveExact(vessels, BERTHS, { weights: WEIGHTS });
    expect(exact.provenOptimal).toBe(true);
    expect(exact.vesselCount).toBe(8);
    expect(exact.nodesExplored).toBeGreaterThan(0);
    // Exact optimum beats or ties greedy.
    const greedy = planNaive(vessels, BERTHS, { weights: WEIGHTS });
    const greedyObj = planEconomics(greedy, vessels, BERTHS, WEIGHTS).objective;
    expect(exact.objective).toBeLessThanOrEqual(greedyObj + 1e-9);
  });

  it("rejects instances above the exact limit", () => {
    const vessels = Array.from({ length: 9 }, (_, i) => vessel(`V${i + 1}`, i, 4));
    expect(() => solveExact(vessels, BERTHS, { weights: WEIGHTS })).toThrow(/limited to 8/);
  });

  it("reports not-proven when the node cap is hit", () => {
    const vessels = [
      vessel("V1", 0, 6),
      vessel("V2", 2, 4),
      vessel("V3", 3, 8),
      vessel("V4", 1, 3),
      vessel("V5", 5, 5),
      vessel("V6", 4, 7),
    ];
    const exact = solveExact(vessels, BERTHS, { weights: WEIGHTS }, 5);
    expect(exact.provenOptimal).toBe(false);
  });

  it("gapAgainstExact handles degenerate optima", () => {
    expect(gapAgainstExact(10, 0)).toBeNull();
    expect(gapAgainstExact(10, 10)).toBeCloseTo(0, 9);
    expect(gapAgainstExact(11, 10)).toBeCloseTo(10, 9);
  });
});
