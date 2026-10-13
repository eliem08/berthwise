import { describe, it, expect } from "vitest";
import { BENCHMARK_INSTANCES } from "../benchmarks";
import { solveExact } from "../exact";
import { compareAlgorithms } from "../berth";

const WEIGHTS = { waiting: 1, fuel: 0, crane: 0 };

describe("Cordeau-style benchmarks", () => {
  it("defines three instances at the documented scales", () => {
    expect(BENCHMARK_INSTANCES.map((b) => b.id)).toEqual(["CB-1", "CB-2", "CB-3"]);
    const [cb1, cb2, cb3] = BENCHMARK_INSTANCES;
    expect(cb1.vessels).toHaveLength(6);
    expect(cb1.berths).toHaveLength(2);
    expect(cb2.vessels).toHaveLength(12);
    expect(cb2.berths).toHaveLength(3);
    expect(cb3.vessels).toHaveLength(25);
    expect(cb3.berths).toHaveLength(5);
    // Every instance documents how its ground truth was established.
    for (const b of BENCHMARK_INSTANCES) {
      expect(b.groundTruth.length).toBeGreaterThan(0);
    }
  });

  it("CB-1 is exactly solvable and all heuristics are graded against it", () => {
    const cb1 = BENCHMARK_INSTANCES[0];
    const exact = solveExact(cb1.vessels, cb1.berths, { weights: WEIGHTS });
    expect(exact.provenOptimal).toBe(true);
    const { results } = compareAlgorithms(cb1.vessels, cb1.berths, {
      weights: WEIGHTS,
      seed: 42,
      timeLimitMs: 100,
    });
    expect(results).toHaveLength(5);
    for (const r of results) {
      expect(r.economics.objective).toBeGreaterThanOrEqual(exact.objective - 1e-9);
    }
  });

  it("CB-3 (I2-scale) is solved by all five heuristics", () => {
    const cb3 = BENCHMARK_INSTANCES[2];
    const { results } = compareAlgorithms(cb3.vessels, cb3.berths, {
      weights: WEIGHTS,
      seed: 42,
      timeLimitMs: 100,
    });
    expect(results).toHaveLength(5);
    for (const r of results) {
      expect(r.plan.assignments.length).toBeGreaterThan(0);
      expect(r.economics.objective).toBeGreaterThanOrEqual(0);
    }
  });
});
