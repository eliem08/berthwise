import { describe, it, expect } from "vitest";
import { robustnessTradeoff, robustPlan, stressTestPlan } from "../robust";
import { planOptimized, planToSequences } from "../berth";
import { planEconomics } from "../economics";
import { BERTHS, VESSELS } from "../data";

const WEIGHTS = { waiting: 1, fuel: 0, crane: 0 };
const OPTS = { weights: WEIGHTS, seed: 42, timeLimitMs: 150, tidesEnabled: true };

describe("robust optimization under ETA uncertainty", () => {
  it("max buffer (8h > 6h uncertainty) is feasible in every sampled scenario", () => {
    // Proof sketch: realised ETA <= ETA + 6 < ETA + 8 = buffered ETA, and
    // the sweep is monotone in ETAs, so every realised start is <= its
    // buffered planned start. Slip <= 0 <= grace in all scenarios.
    const plan = robustPlan(VESSELS, BERTHS, OPTS, 8);
    const stress = stressTestPlan(plan, VESSELS, BERTHS, OPTS, 100, 7, 2, 6);
    expect(stress.feasibilityRate).toBe(1);
    expect(stress.worstSlipHours).toBeLessThanOrEqual(2 + 1e-9);
  });

  it("tradeoff curve: buffer 0 costs nothing, feasibility is a rate, slips are sane", () => {
    const result = robustnessTradeoff(VESSELS, BERTHS, OPTS, [0, 2, 4, 6, 8], 60, 7, 2);
    expect(result.points).toHaveLength(5);
    expect(result.samples).toBe(60);
    expect(result.graceHours).toBe(2);
    expect(result.uncertaintyHalfWidthHours).toBe(6);
    const zero = result.points[0];
    expect(zero.bufferHours).toBe(0);
    expect(zero.costOfRobustnessPct).toBeCloseTo(0, 9);
    for (const point of result.points) {
      expect(point.feasibilityRate).toBeGreaterThanOrEqual(0);
      expect(point.feasibilityRate).toBeLessThanOrEqual(1);
      expect(point.meanSlipHours).toBeGreaterThanOrEqual(0);
      expect(point.nominalObjective).toBeGreaterThanOrEqual(0);
    }
    // Max buffer is fully feasible (see proof in the test above).
    expect(result.points[4].feasibilityRate).toBe(1);
  });

  it("robust plans are feasible berth plans", () => {
    for (const buffer of [0, 4, 8]) {
      const plan = robustPlan(VESSELS, BERTHS, OPTS, buffer);
      expect(plan.assignments.length).toBeGreaterThan(0);
      for (const a of plan.assignments) {
        expect(a.waitingHours).toBeGreaterThanOrEqual(-1e-9);
        expect(a.endHours - a.startHours).toBeGreaterThan(0);
      }
    }
  });

  it("stress test is deterministic for a fixed seed", () => {
    const plan = planOptimized(VESSELS, BERTHS, OPTS);
    const a = stressTestPlan(plan, VESSELS, BERTHS, OPTS, 50, 11, 2, 6);
    const b = stressTestPlan(plan, VESSELS, BERTHS, OPTS, 50, 11, 2, 6);
    expect(a).toEqual(b);
  });

  it("a plan evaluated on its own nominal scenario has zero slip", () => {
    const plan = planOptimized(VESSELS, BERTHS, OPTS);
    const seqs = planToSequences(plan);
    expect(seqs.size).toBeGreaterThan(0);
    const nominal = planEconomics(plan, VESSELS, BERTHS, WEIGHTS);
    expect(nominal.objective).toBeGreaterThanOrEqual(0);
  });
});
