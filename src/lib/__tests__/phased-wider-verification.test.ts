import { describe, it, expect } from "vitest";
import { mulberry32 } from "../rng";
import {
  assertPlanFullyFeasible,
  bruteForceOptimum,
  randomInstance,
  EPS,
} from "./verify-helpers";
import { solveExact } from "../exact";
import { scheduleCranes } from "../cranes";
import type { Berth, ObjectiveWeights, Vessel } from "../types";

/**
 * Phase D.1 — wider exact-vs-brute-force verification.
 *
 * Phase B proved the exact solver against an independent exhaustive
 * enumerator on 16 seeded 5v/2b instances (+ a deep-draft tide case).
 * This suite widens the sweep: every vessel count from 2 up to the exact
 * solver's 8-vessel ceiling, tight vs loose berth counts, tide-on/tide-off,
 * draft-heavy, grain-heavy, and crane-contention scenarios.
 *
 * Every mismatch is treated as a defect (fix or document). The brute-force
 * enumerator shares only the tide helpers and berthFeasible with the
 * solvers; sweep, objective and enumeration are independent code paths.
 */

const WEIGHT_SETS: ObjectiveWeights[] = [
  { waiting: 1, fuel: 0, crane: 0 },
  { waiting: 70, fuel: 20, crane: 10 },
  { waiting: 0, fuel: 1, crane: 1 },
];

interface Shape {
  name: string;
  seedBase: number;
  nVessels: number;
  nBerths: number;
  tides: boolean;
  seeds: number;
  weights: number; // how many weight sets per seed
  /** Post-process the instance: "draftHeavy" | "grainHeavy" | undefined. */
  profile?: "draftHeavy" | "grainHeavy";
}

const SHAPES: Shape[] = [
  // Baseline small shapes.
  { name: "2v/2b", seedBase: 5100, nVessels: 2, nBerths: 2, tides: false, seeds: 4, weights: 3 },
  { name: "3v/2b tides", seedBase: 5200, nVessels: 3, nBerths: 2, tides: true, seeds: 4, weights: 3 },
  { name: "4v/3b", seedBase: 5300, nVessels: 4, nBerths: 3, tides: false, seeds: 4, weights: 2 },
  // Tight vs loose berth counts at mid size.
  { name: "6v/2b tight-berth", seedBase: 5400, nVessels: 6, nBerths: 2, tides: false, seeds: 3, weights: 2 },
  { name: "6v/4b loose-berth", seedBase: 5500, nVessels: 6, nBerths: 4, tides: false, seeds: 3, weights: 2 },
  { name: "6v/3b tides", seedBase: 5600, nVessels: 6, nBerths: 3, tides: true, seeds: 3, weights: 2 },
  // Tight berth + tight draft + tight tide simultaneously.
  { name: "7v/2b tight-berth draft-heavy tides", seedBase: 5700, nVessels: 7, nBerths: 2, tides: true, seeds: 2, weights: 2, profile: "draftHeavy" },
  // Ceiling shapes.
  { name: "8v/2b ceiling", seedBase: 5800, nVessels: 8, nBerths: 2, tides: false, seeds: 2, weights: 2 },
  { name: "8v/3b ceiling tides", seedBase: 5900, nVessels: 8, nBerths: 3, tides: true, seeds: 2, weights: 2 },
  // Cargo-mix stress.
  { name: "6v/2b grain-heavy", seedBase: 6000, nVessels: 6, nBerths: 2, tides: false, seeds: 3, weights: 2, profile: "grainHeavy" },
];

function applyProfile(
  seed: number,
  profile: Shape["profile"],
  vessels: Vessel[],
  berths: Berth[],
): { vessels: Vessel[]; berths: Berth[] } {
  if (!profile) return { vessels, berths };
  const rand = mulberry32(seed ^ 0x9e37);
  if (profile === "draftHeavy") {
    const vs = vessels.map((v, i) => ({
      ...v,
      draftM: i % 3 === 2 ? 9 + rand() * 2 : 12.5 + rand() * 2.5, // 2/3 deep draft
    }));
    return { vessels: vs, berths };
  }
  // grainHeavy: 2/3 of vessels carry grain; guarantee a grain berth exists.
  const vs = vessels.map((v, i) =>
    i % 3 === 2 ? { ...v, cargo: "container" as const } : { ...v, cargo: "grain" as const, teu: 0 },
  );
  const bs = berths.map((b, i) => ({ ...b, grainCapable: b.grainCapable || i === 0 }));
  return { vessels: vs, berths: bs };
}

function checkShape(shape: Shape): void {
  for (let s = 0; s < shape.seeds; s++) {
    const raw = randomInstance(shape.seedBase + s, shape.nVessels, shape.nBerths);
    const { vessels, berths } = applyProfile(shape.seedBase + s, shape.profile, raw.vessels, raw.berths);
    for (let w = 0; w < shape.weights; w++) {
      const weights = WEIGHT_SETS[(s + w) % WEIGHT_SETS.length];
      const label = `${shape.name} seed=${shape.seedBase + s} w${w}`;
      const brute = bruteForceOptimum(vessels, berths, weights, shape.tides);
      const exact = solveExact(vessels, berths, { weights, tidesEnabled: shape.tides });
      expect(exact.provenOptimal, `${label}: search hit the node cap`).toBe(true);
      expect(exact.objective, `${label}: objective mismatch vs brute force`).toBeCloseTo(
        brute.objective,
        6,
      );
      assertPlanFullyFeasible(exact.plan, vessels, berths, { tidesEnabled: shape.tides });
    }
  }
}

describe("phase D: wider exact-vs-brute-force verification", () => {
  for (const shape of SHAPES) {
    it(`matches brute force: ${shape.name}`, () => {
      checkShape(shape);
    }, 120_000);
  }

  it("rejects 9-vessel input at the exact-solver ceiling boundary", () => {
    const { vessels, berths } = randomInstance(7777, 9, 2);
    expect(() => solveExact(vessels, berths)).toThrow(/limited to 8 vessels/);
  });

  describe("crane contention on verified-optimal plans", () => {
    /**
     * The exact solver does not model the crane pool (that is a post-plan
     * scheduling step); the honest check is that scheduleCranes can place
     * the optimal plan against a TIGHT pool without ever exceeding it.
     * Pool usage is re-verified with an independent sweep over the
     * crane-schedule intervals (no shared code with scheduleCranes).
     */
    it("tight crane pool (3) is never exceeded on 8v/2b optimal plans", () => {
      for (let s = 0; s < 2; s++) {
        const { vessels, berths } = randomInstance(6100 + s, 8, 2);
        const exact = solveExact(vessels, berths, {
          weights: WEIGHT_SETS[s % WEIGHT_SETS.length],
          tidesEnabled: false,
        });
        expect(exact.provenOptimal).toBe(true);
        const { plan, schedule } = scheduleCranes(exact.plan, vessels, berths, { poolLimit: 3 });
        assertPlanFullyFeasible(plan, vessels, berths, { tidesEnabled: false });

        // Independent sweep-line: max simultaneous crane usage from the raw
        // intervals, computed without touching scheduleCranes internals.
        const events: Array<[number, number]> = [];
        for (const a of schedule.assignments) {
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
        expect(peak, `seed ${s}: sweep-line peak ${peak} exceeds schedule peak`).toBe(
          schedule.peakUsage,
        );
        expect(schedule.peakUsage, `seed ${s}: pool limit exceeded`).toBeLessThanOrEqual(3);
      }
    }, 60_000);

    it("tight crane pool (2) holds on a draft-heavy 7v/2b tides instance", () => {
      const raw = randomInstance(6200, 7, 2);
      const { vessels, berths } = applyProfile(6200, "draftHeavy", raw.vessels, raw.berths);
      const exact = solveExact(vessels, berths, {
        weights: { waiting: 70, fuel: 20, crane: 10 },
        tidesEnabled: true,
      });
      expect(exact.provenOptimal).toBe(true);
      const { plan, schedule } = scheduleCranes(exact.plan, vessels, berths, {
        poolLimit: 2,
        tidesEnabled: true,
      });
      assertPlanFullyFeasible(plan, vessels, berths, { tidesEnabled: true });
      expect(schedule.peakUsage).toBeLessThanOrEqual(2);
      // The crane-scheduled plan re-times crane starts; vessel berth windows
      // must be preserved (crane work stays inside the berth window).
      const vesselById = new Map(vessels.map((v) => [v.id, v]));
      for (const a of schedule.assignments) {
        const p = plan.assignments.find((x) => x.vesselId === a.vesselId)!;
        expect(a.startHours, `${a.vesselId} crane start`).toBeGreaterThanOrEqual(p.startHours - EPS);
        expect(a.endHours, `${a.vesselId} crane end`).toBeLessThanOrEqual(p.endHours + EPS);
        expect(vesselById.get(a.vesselId)).toBeDefined();
      }
    }, 60_000);
  });
});
