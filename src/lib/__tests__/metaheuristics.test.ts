import { describe, it, expect } from "vitest";
import { planGA } from "../ga";
import { planALNS } from "../alns";
import { planNaive } from "../berth";
import { planEconomics } from "../economics";
import { BERTHS, VESSELS } from "../data";
import type { Assignment, BerthPlan } from "../types";

const EPS = 1e-9;

function assertPlanFeasible(plan: BerthPlan): void {
  const byBerth = new Map<string, Assignment[]>();
  for (const a of plan.assignments) {
    const list = byBerth.get(a.berthId);
    if (list) list.push(a);
    else byBerth.set(a.berthId, [a]);
  }
  for (const [, list] of byBerth) {
    const sorted = [...list].sort((x, y) => x.startHours - y.startHours);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].startHours).toBeGreaterThanOrEqual(sorted[i - 1].endHours - EPS);
    }
  }
}

const WEIGHTS = { waiting: 1, fuel: 0, crane: 0 };

describe("genetic algorithm", () => {
  it("produces feasible plans and never scores worse than greedy (elitism + greedy seed)", () => {
    const ga = planGA(VESSELS, BERTHS, { weights: WEIGHTS, seed: 42 });
    assertPlanFeasible(ga);
    const greedy = planNaive(VESSELS, BERTHS, { weights: WEIGHTS });
    const gaObj = planEconomics(ga, VESSELS, BERTHS, WEIGHTS).objective;
    const greedyObj = planEconomics(greedy, VESSELS, BERTHS, WEIGHTS).objective;
    expect(gaObj).toBeLessThanOrEqual(greedyObj + 1e-9);
  });

  it("is deterministic for a fixed seed", () => {
    const a = planGA(VESSELS, BERTHS, { weights: WEIGHTS, seed: 99 });
    const b = planGA(VESSELS, BERTHS, { weights: WEIGHTS, seed: 99 });
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });

  it("handles empty input", () => {
    const plan = planGA([], BERTHS, { weights: WEIGHTS });
    expect(plan.assignments).toEqual([]);
  });
});

describe("ALNS", () => {
  it("produces feasible plans and never scores worse than greedy (best-tracking)", () => {
    const alns = planALNS(VESSELS, BERTHS, { weights: WEIGHTS, seed: 42 });
    assertPlanFeasible(alns);
    const greedy = planNaive(VESSELS, BERTHS, { weights: WEIGHTS });
    const alnsObj = planEconomics(alns, VESSELS, BERTHS, WEIGHTS).objective;
    const greedyObj = planEconomics(greedy, VESSELS, BERTHS, WEIGHTS).objective;
    expect(alnsObj).toBeLessThanOrEqual(greedyObj + 1e-9);
  });

  it("is deterministic for a fixed seed", () => {
    const a = planALNS(VESSELS, BERTHS, { weights: WEIGHTS, seed: 99 });
    const b = planALNS(VESSELS, BERTHS, { weights: WEIGHTS, seed: 99 });
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });

  it("respects tide windows when enabled", () => {
    const alns = planALNS(VESSELS, BERTHS, { weights: WEIGHTS, seed: 42, tidesEnabled: true });
    assertPlanFeasible(alns);
    const vesselById = new Map(VESSELS.map((v) => [v.id, v]));
    for (const a of alns.assignments) {
      const v = vesselById.get(a.vesselId)!;
      if (v.draftM >= 12) {
        const phase = ((a.startHours - 1) % 12.42 + 12.42) % 12.42;
        expect(phase).toBeLessThan(4 + EPS);
      }
    }
  });
});
