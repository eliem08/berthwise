import { describe, it, expect } from "vitest";
import {
  compareAlgorithms,
  planTabu,
  planOptimized,
  planNaive,
  validateMove,
  rebuildAfterMove,
  berthFeasible,
} from "../berth";
import { planEconomics } from "../economics";
import { BERTHS, VESSELS } from "../data";
import type { BerthPlan, Assignment } from "../types";

const EPS = 1e-9;
const vesselById = new Map(VESSELS.map((v) => [v.id, v]));
const berthById = new Map(BERTHS.map((b) => [b.id, b]));

function assertPlanFeasible(plan: BerthPlan): void {
  const byBerth = new Map<string, Assignment[]>();
  for (const a of plan.assignments) {
    const list = byBerth.get(a.berthId);
    if (list) list.push(a);
    else byBerth.set(a.berthId, [a]);
  }
  for (const [berthId, list] of byBerth) {
    const sorted = [...list].sort((x, y) => x.startHours - y.startHours);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].startHours).toBeGreaterThanOrEqual(sorted[i - 1].endHours - EPS);
    }
  }
  for (const a of plan.assignments) {
    const v = vesselById.get(a.vesselId)!;
    const b = berthById.get(a.berthId)!;
    expect(berthFeasible(v, b)).toBe(true);
    expect(a.waitingHours).toBeGreaterThanOrEqual(-EPS);
    expect(a.endHours - a.startHours).toBeCloseTo(v.handlingHours, 9);
  }
}

describe("algorithm comparison", () => {
  it("all five algorithms produce feasible plans on seeded data", () => {
    const { results } = compareAlgorithms(VESSELS, BERTHS, {
      seed: 42,
      timeLimitMs: 150,
    });
    expect(results.map((r) => r.id)).toEqual(["greedy", "annealing", "tabu", "ga", "alns"]);
    for (const r of results) {
      assertPlanFeasible(r.plan);
      expect(r.economics.objective).toBeGreaterThanOrEqual(0);
      expect(r.craneSchedule.peakUsage).toBeLessThanOrEqual(8);
    }
  });

  it("winner is the lowest-objective result", () => {
    const { results, winner } = compareAlgorithms(VESSELS, BERTHS, {
      seed: 42,
      timeLimitMs: 150,
    });
    const winnerResult = results.find((r) => r.id === winner)!;
    for (const r of results) {
      expect(winnerResult.economics.objective).toBeLessThanOrEqual(r.economics.objective + EPS);
    }
  });

  it("tabu search is feasible and deterministic", () => {
    const a = planTabu(VESSELS, BERTHS, { seed: 99, timeLimitMs: 150 });
    const b = planTabu(VESSELS, BERTHS, { seed: 99, timeLimitMs: 150 });
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
    assertPlanFeasible(a);
  });

  it("weighted objective responds to weights", () => {
    const waitingOnly = planOptimized(VESSELS, BERTHS, {
      seed: 42,
      timeLimitMs: 200,
      weights: { waiting: 1, fuel: 0, crane: 0 },
    });
    const craneHeavy = planOptimized(VESSELS, BERTHS, {
      seed: 42,
      timeLimitMs: 200,
      weights: { waiting: 0, fuel: 0, crane: 1 },
    });
    const econWaiting = planEconomics(waitingOnly, VESSELS, BERTHS, { waiting: 1, fuel: 0, crane: 0 });
    const econCrane = planEconomics(craneHeavy, VESSELS, BERTHS, { waiting: 0, fuel: 0, crane: 1 });
    // Each plan should be no worse than the other under its own objective.
    expect(econWaiting.objective).toBeLessThanOrEqual(
      planEconomics(craneHeavy, VESSELS, BERTHS, { waiting: 1, fuel: 0, crane: 0 }).objective + 1e-6,
    );
    expect(econCrane.objective).toBeLessThanOrEqual(
      planEconomics(waitingOnly, VESSELS, BERTHS, { waiting: 0, fuel: 0, crane: 1 }).objective + 1e-6,
    );
  });

  it("tide constraints delay deep-draft starts into windows", () => {
    const noTide = planNaive(VESSELS, BERTHS, { tidesEnabled: false });
    const withTide = planNaive(VESSELS, BERTHS, { tidesEnabled: true });
    const deepNoTide = noTide.assignments.filter((a) => vesselById.get(a.vesselId)!.draftM >= 12);
    const deepWithTide = withTide.assignments.filter((a) => vesselById.get(a.vesselId)!.draftM >= 12);
    expect(deepWithTide.length).toBe(deepNoTide.length);
    for (const a of deepWithTide) {
      const phase = ((a.startHours - 1) % 12.42 + 12.42) % 12.42;
      expect(phase, `vessel ${a.vesselId} start h+${a.startHours}`).toBeLessThan(4 + EPS);
    }
  });
});

describe("drag revalidation", () => {
  const plan = planNaive(VESSELS, BERTHS, { tidesEnabled: true });

  it("rejects a vessel that is too long for the target berth", () => {
    // V4 is 330m; B4 is 280m.
    const result = validateMove(plan, VESSELS, BERTHS, "V4", "B4", 40);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/too long/);
  });

  it("rejects grain onto a non-grain berth", () => {
    const result = validateMove(plan, VESSELS, BERTHS, "V7", "B1", 40);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/grain/);
  });

  it("rejects a start before the vessel ETA", () => {
    const result = validateMove(plan, VESSELS, BERTHS, "V4", "B1", 1);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/ETA/);
  });

  it("rejects a deep-draft start outside a tide window", () => {
    // 6.0 is in a tide gap (windows are [1,5), [13.42,17.42), ...).
    const result = validateMove(plan, VESSELS, BERTHS, "V1", "B1", 6.0, { tidesEnabled: true });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/tide window/);
  });

  it("rejects an overlapping drop", () => {
    // V1 (ETA 4.5) dropped onto B1 overlapping another vessel's assignment.
    const other = plan.assignments.find((a) => a.berthId === "B1" && a.vesselId !== "V1")!;
    const result = validateMove(plan, VESSELS, BERTHS, "V1", "B1", other.startHours + 1, {
      tidesEnabled: false,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/Overlaps/);
  });

  it("accepts a legal move and rebuilds a feasible plan", () => {
    // Move V6 (small container vessel) to B4 at a free late slot.
    const result = validateMove(plan, VESSELS, BERTHS, "V6", "B4", 100, { tidesEnabled: true });
    expect(result.valid).toBe(true);
    const rebuilt = rebuildAfterMove(plan, VESSELS, BERTHS, "V6", "B4", 100, { tidesEnabled: true });
    assertPlanFeasible(rebuilt.plan);
    const moved = rebuilt.plan.assignments.find((a) => a.vesselId === "V6")!;
    expect(moved.berthId).toBe("B4");
    expect(moved.startHours).toBeGreaterThanOrEqual(100 - EPS);
  });
});
