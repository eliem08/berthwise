import { describe, it, expect } from "vitest";
import { planNaive, planOptimized } from "../berth";
import { scheduleCranes, cranesFreeAt } from "../cranes";
import { cranesForVessel, CRANE_POOL_LIMIT } from "../economics";
import { BERTHS, VESSELS } from "../data";
import type { BerthPlan } from "../types";

const EPS = 1e-9;

/** Max simultaneous crane usage of a plan, computed from its assignments. */
function peakCraneUsage(plan: BerthPlan, poolLimit: number = CRANE_POOL_LIMIT): number {
  const events: Array<{ t: number; delta: number }> = [];
  const vesselById = new Map(VESSELS.map((v) => [v.id, v]));
  const berthById = new Map(BERTHS.map((b) => [b.id, b]));
  for (const a of plan.assignments) {
    const v = vesselById.get(a.vesselId);
    const b = berthById.get(a.berthId);
    if (!v || !b) continue;
    // The scheduler caps a single vessel at the pool size.
    const n = Math.min(cranesForVessel(v, b), poolLimit);
    events.push({ t: a.startHours, delta: n });
    events.push({ t: a.endHours, delta: -n });
  }
  events.sort((x, y) => x.t - y.t || x.delta - y.delta);
  let cur = 0;
  let peak = 0;
  for (const e of events) {
    cur += e.delta;
    if (cur > peak) peak = cur;
  }
  return peak;
}

describe("crane scheduling", () => {
  it("never over-allocates the crane pool", () => {
    const raw = planOptimized(VESSELS, BERTHS, { seed: 42, timeLimitMs: 200 });
    const { plan, schedule } = scheduleCranes(raw, VESSELS, BERTHS, {
      poolLimit: CRANE_POOL_LIMIT,
    });
    expect(peakCraneUsage(plan)).toBeLessThanOrEqual(CRANE_POOL_LIMIT);
    expect(schedule.peakUsage).toBeLessThanOrEqual(CRANE_POOL_LIMIT);
    expect(schedule.peakUsage).toBe(peakCraneUsage(plan));
  });

  it("never over-allocates with a tiny pool", () => {
    const raw = planNaive(VESSELS, BERTHS);
    const { plan } = scheduleCranes(raw, VESSELS, BERTHS, { poolLimit: 2 });
    expect(peakCraneUsage(plan, 2)).toBeLessThanOrEqual(2);
  });

  it("keeps berth sequences feasible (no overlaps, no early starts)", () => {
    const raw = planOptimized(VESSELS, BERTHS, { seed: 7, timeLimitMs: 200 });
    const { plan } = scheduleCranes(raw, VESSELS, BERTHS, {
      poolLimit: CRANE_POOL_LIMIT,
      tidesEnabled: true,
    });
    const vesselById = new Map(VESSELS.map((v) => [v.id, v]));
    const byBerth = new Map<string, typeof plan.assignments>();
    for (const a of plan.assignments) {
      const list = byBerth.get(a.berthId);
      if (list) list.push(a);
      else byBerth.set(a.berthId, [a]);
    }
    for (const list of byBerth.values()) {
      const sorted = [...list].sort((x, y) => x.startHours - y.startHours);
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i].startHours).toBeGreaterThanOrEqual(sorted[i - 1].endHours - EPS);
      }
    }
    for (const a of plan.assignments) {
      const v = vesselById.get(a.vesselId)!;
      expect(a.startHours).toBeGreaterThanOrEqual(v.etaHours - EPS);
      expect(a.endHours - a.startHours).toBeCloseTo(v.handlingHours, 9);
    }
  });

  it("respects tide windows when tides are enabled", () => {
    const raw = planOptimized(VESSELS, BERTHS, { seed: 42, timeLimitMs: 200, tidesEnabled: true });
    const { plan } = scheduleCranes(raw, VESSELS, BERTHS, {
      poolLimit: CRANE_POOL_LIMIT,
      tidesEnabled: true,
    });
    const vesselById = new Map(VESSELS.map((v) => [v.id, v]));
    // Deep-draft starts must sit inside a tide window: start mod 12.42 within [1, 5).
    for (const a of plan.assignments) {
      const v = vesselById.get(a.vesselId)!;
      if (v.draftM < 12) continue;
      const phase = ((a.startHours - 1) % 12.42 + 12.42) % 12.42;
      expect(phase, `vessel ${a.vesselId} start h+${a.startHours}`).toBeLessThan(4 + EPS);
    }
  });

  it("crane counts follow the TEU rule and grain uses one crane", () => {
    const berthById = new Map(BERTHS.map((b) => [b.id, b]));
    const v1 = VESSELS.find((v) => v.id === "V1")!;
    expect(cranesForVessel(v1, berthById.get("B1")!)).toBe(3); // 3800 TEU, berth cap 3
    const grain = VESSELS.find((v) => v.id === "V7")!;
    expect(cranesForVessel(grain, berthById.get("B3")!)).toBe(1);
  });

  it("cranesFreeAt detects an over-allocated window", () => {
    const raw = planNaive(VESSELS, BERTHS);
    const { plan } = scheduleCranes(raw, VESSELS, BERTHS, { poolLimit: 3 });
    // With pool 3, asking for another vessel at a busy hour must report < 0.
    const busy = plan.assignments[0];
    const free = cranesFreeAt(
      plan.assignments,
      VESSELS,
      BERTHS,
      "V4",
      busy.berthId,
      busy.startHours,
      3,
    );
    expect(free).toBeLessThan(0);
  });

  it("usage series matches the schedule", () => {
    const raw = planNaive(VESSELS, BERTHS);
    const { schedule } = scheduleCranes(raw, VESSELS, BERTHS, {
      poolLimit: CRANE_POOL_LIMIT,
    });
    expect(schedule.usageSeries.length).toBeGreaterThan(0);
    for (const p of schedule.usageSeries) {
      expect(p.cranesInUse).toBeLessThanOrEqual(CRANE_POOL_LIMIT);
      expect(p.cranesInUse).toBeGreaterThanOrEqual(0);
    }
    expect(schedule.totalCraneHours).toBeGreaterThan(0);
    expect(schedule.avgUtilizationPct).toBeGreaterThan(0);
    expect(schedule.avgUtilizationPct).toBeLessThanOrEqual(100);
  });
});
