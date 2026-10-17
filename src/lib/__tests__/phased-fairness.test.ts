import { describe, it, expect } from "vitest";
import {
  assertFairComparison,
  canonicalInstanceString,
  compareAlgorithms,
  comparisonFingerprint,
} from "../berth";
import { planEconomics } from "../economics";
import { BERTHS, VESSELS } from "../data";
import type { AlgorithmResult, Vessel } from "../types";

const EPS = 1e-9;

describe("comparison fairness (phase D)", () => {
  const OPTS = { seed: 42, timeLimitMs: 150, weights: { waiting: 1, fuel: 0, crane: 0 } };

  it("all five results carry the same input fingerprint", () => {
    const { results } = compareAlgorithms(VESSELS, BERTHS, OPTS);
    expect(results).toHaveLength(5);
    const fps = new Set(results.map((r) => r.inputFingerprint));
    expect(fps.size).toBe(1);
    expect(results[0].inputFingerprint).toBe(comparisonFingerprint(VESSELS, BERTHS, OPTS));
  });

  it("fingerprints discriminate instances, weights, tides and budgets", () => {
    const base = comparisonFingerprint(VESSELS, BERTHS, OPTS);
    const moved: Vessel[] = VESSELS.map((v) =>
      v.id === "V1" ? { ...v, etaHours: v.etaHours + 0.5 } : v,
    );
    expect(comparisonFingerprint(moved, BERTHS, OPTS)).not.toBe(base);
    expect(
      comparisonFingerprint(VESSELS, BERTHS, { ...OPTS, weights: { waiting: 0, fuel: 1, crane: 0 } }),
    ).not.toBe(base);
    expect(comparisonFingerprint(VESSELS, BERTHS, { ...OPTS, tidesEnabled: true })).not.toBe(base);
    expect(comparisonFingerprint(VESSELS, BERTHS, { ...OPTS, timeLimitMs: 300 })).not.toBe(base);
    // Array order does not change the fingerprint: same instance, different order.
    expect(comparisonFingerprint([...VESSELS].reverse(), [...BERTHS].reverse(), OPTS)).toBe(base);
  });

  it("does not mutate the shared input arrays (deep comparison)", () => {
    const vesselsBefore = JSON.parse(JSON.stringify(VESSELS)) as Vessel[];
    const berthsBefore = JSON.parse(JSON.stringify(BERTHS));
    compareAlgorithms(VESSELS, BERTHS, OPTS);
    expect(canonicalInstanceString(VESSELS, BERTHS)).toBe(
      canonicalInstanceString(vesselsBefore, berthsBefore),
    );
    expect(JSON.stringify(VESSELS)).toBe(JSON.stringify(vesselsBefore));
    expect(JSON.stringify(BERTHS)).toBe(JSON.stringify(berthsBefore));
  });

  it("every result's economics are graded with the same objective", () => {
    const { results } = compareAlgorithms(VESSELS, BERTHS, OPTS);
    for (const r of results) {
      const recomputed = planEconomics(r.plan, VESSELS, BERTHS, OPTS.weights);
      expect(recomputed.objective, `${r.id} objective`).toBeCloseTo(r.economics.objective, 9);
    }
  });

  it("fails loudly when results from mismatched instances are mixed", () => {
    const runA = compareAlgorithms(VESSELS, BERTHS, OPTS);
    const moved: Vessel[] = VESSELS.map((v) =>
      v.id === "V1" ? { ...v, etaHours: v.etaHours + 0.5 } : v,
    );
    const runB = compareAlgorithms(moved, BERTHS, OPTS);
    const mixed: AlgorithmResult[] = [runA.results[0], runB.results[1]];
    expect(() => assertFairComparison(mixed)).toThrow(/mismatched/);
  });

  it("fails when results from mismatched objectives are mixed", () => {
    const runA = compareAlgorithms(VESSELS, BERTHS, OPTS);
    const runC = compareAlgorithms(VESSELS, BERTHS, {
      ...OPTS,
      weights: { waiting: 0, fuel: 1, crane: 0 },
    });
    expect(() => assertFairComparison([runA.results[0], runC.results[0]])).toThrow(/mismatched/);
  });

  it("rejects empty or fingerprint-less result sets", () => {
    expect(() => assertFairComparison([])).toThrow(/no results/);
    const { results } = compareAlgorithms(VESSELS, BERTHS, OPTS);
    const stripped = results.map(({ inputFingerprint: _drop, ...r }) => r);
    expect(() => assertFairComparison(stripped as AlgorithmResult[])).toThrow(/missing inputFingerprint/);
  });
});
