import { describe, it, expect } from "vitest";
import { planNaive, planOptimized, berthFeasible } from "../berth";
import { BERTHS, VESSELS } from "../data";
import type { BerthPlan, Assignment } from "../berth";
import type { Vessel, Berth } from "../data";

const EPS = 1e-9;

const vesselById = new Map<string, Vessel>(VESSELS.map((v) => [v.id, v]));
const berthById = new Map<string, Berth>(BERTHS.map((b) => [b.id, b]));

/** Asserts that no two assignments on the same berth overlap in time. */
function noOverlap(plan: BerthPlan): void {
  const byBerth = new Map<string, Assignment[]>();
  for (const a of plan.assignments) {
    const list = byBerth.get(a.berthId);
    if (list) {
      list.push(a);
    } else {
      byBerth.set(a.berthId, [a]);
    }
  }

  for (const [berthId, list] of byBerth) {
    const sorted = [...list].sort((x, y) => x.startHours - y.startHours);
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      expect(
        curr.startHours,
        `overlap on berth ${berthId}: ${curr.vesselId} starts at ${curr.startHours} before ${prev.vesselId} ends at ${prev.endHours}`,
      ).toBeGreaterThanOrEqual(prev.endHours - EPS);
    }
  }
}

function totalWaitingHours(plan: BerthPlan): number {
  return plan.assignments.reduce((sum, a) => sum + a.waitingHours, 0);
}

/** Shared feasibility assertions for a plan built from the full fixture set. */
function assertPlanFeasible(plan: BerthPlan): void {
  noOverlap(plan);

  for (const a of plan.assignments) {
    const vessel = vesselById.get(a.vesselId);
    const berth = berthById.get(a.berthId);

    expect(vessel, `unknown vessel id in assignment: ${a.vesselId}`).toBeDefined();
    expect(berth, `unknown berth id in assignment: ${a.berthId}`).toBeDefined();

    expect(
      berthFeasible(vessel as Vessel, berth as Berth),
      `infeasible assignment: vessel ${a.vesselId} on berth ${a.berthId}`,
    ).toBe(true);

    expect(a.waitingHours, `negative waiting for ${a.vesselId}`).toBeGreaterThanOrEqual(-EPS);

    const duration = a.endHours - a.startHours;
    expect(
      Math.abs(duration - (vessel as Vessel).handlingHours),
      `duration mismatch for ${a.vesselId}: got ${duration}, expected ${(vessel as Vessel).handlingHours}`,
    ).toBeLessThanOrEqual(EPS);

    expect(a.startHours).toBeGreaterThanOrEqual(-EPS);
    expect(a.endHours).toBeGreaterThanOrEqual(a.startHours - EPS);
  }
}

describe("berth planning", () => {
  it("naive plan is feasible", () => {
    const plan = planNaive(VESSELS, BERTHS);
    assertPlanFeasible(plan);
  });

  it("optimized plan is feasible", () => {
    const plan = planOptimized(VESSELS, BERTHS, { seed: 42, timeLimitMs: 150 });
    assertPlanFeasible(plan);
  });

  it("deterministic with seed", () => {
    const a = planOptimized(VESSELS, BERTHS, { seed: 123 });
    const b = planOptimized(VESSELS, BERTHS, { seed: 123 });
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });

  it("optimized beats or matches naive on waiting", () => {
    const naive = planNaive(VESSELS, BERTHS);
    const optimized = planOptimized(VESSELS, BERTHS, { seed: 42, timeLimitMs: 150 });
    expect(totalWaitingHours(optimized)).toBeLessThanOrEqual(totalWaitingHours(naive) + EPS);
  });

  it("grain vessels never on non-grain berths", () => {
    const plan = planOptimized(VESSELS, BERTHS, {
      seed: 42,
      grainPriority: true,
      timeLimitMs: 150,
    });

    for (const a of plan.assignments) {
      const vessel = vesselById.get(a.vesselId);
      const berth = berthById.get(a.berthId);
      expect(vessel).toBeDefined();
      expect(berth).toBeDefined();

      if ((vessel as Vessel).cargo === "grain") {
        expect(
          (berth as Berth).grainCapable,
          `grain vessel ${a.vesselId} placed on non-grain berth ${a.berthId}`,
        ).toBe(true);
      }
    }
  });

  it("oversized vessel is unassigned", () => {
    const huge: Vessel = { ...VESSELS[0], id: "huge-vessel", lengthM: 9999 };
    const plan = planNaive([huge], BERTHS);

    expect(plan.assignments).toHaveLength(0);
    expect(plan.unassigned).toContain(huge.id);
  });

  it("empty inputs", () => {
    const plan = planNaive([], BERTHS);
    expect(plan.assignments).toHaveLength(0);
    expect(plan.makespanHours).toBe(0);

    expect(() => planOptimized([], [], {})).not.toThrow();
  });

  it("does not mutate inputs", () => {
    const vesselsBefore = JSON.stringify(VESSELS);
    const berthsBefore = JSON.stringify(BERTHS);

    planOptimized(VESSELS, BERTHS, { seed: 7, timeLimitMs: 150 });

    expect(JSON.stringify(VESSELS)).toBe(vesselsBefore);
    expect(JSON.stringify(BERTHS)).toBe(berthsBefore);
  });
});