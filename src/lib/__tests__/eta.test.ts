import { describe, it, expect } from "vitest";
import { predictEta, predictAll, applyPredictions } from "../eta";
import { VESSELS, VOYAGE_LEGS } from "../data";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

describe("eta", () => {
  it("delay is non-negative and predicted >= scheduled", () => {
    const result = predictEta(VESSELS[0], 1200, 14, 0.7, 7);

    expect(result.delayHours).toBeGreaterThanOrEqual(0);
    expect(result.predictedHours).toBeGreaterThanOrEqual(
      result.scheduledHours - 1e-9,
    );
    expect(result.predictedHours).toBe(
      round2(result.scheduledHours + result.delayHours),
    );
  });

  it("zero congestion gives small delay", () => {
    const result = predictEta(VESSELS[0], 1200, 14, 0, 7);

    expect(result.delayHours).toBeLessThanOrEqual(3.01);
  });

  it("higher congestion => not smaller delay on average", () => {
    const high = predictAll(VESSELS, VOYAGE_LEGS, 0.9, 7);
    const low = predictAll(VESSELS, VOYAGE_LEGS, 0.1, 7);

    expect(high.length).toBeGreaterThan(0);
    expect(low.length).toBeGreaterThan(0);

    const highMean = mean(high.map((p) => p.delayHours));
    const lowMean = mean(low.map((p) => p.delayHours));

    expect(highMean).toBeGreaterThan(lowMean);
  });

  it("deterministic per vessel", () => {
    const a = predictEta(VESSELS[0], 1200, 14, 0.7, 7);
    const b = predictEta(VESSELS[0], 1200, 14, 0.7, 7);

    expect(a).toEqual(b);
    expect(a.delayHours).toBe(b.delayHours);
    expect(a.predictedHours).toBe(b.predictedHours);
  });

  it("invalid inputs throw", () => {
    expect(() => predictEta(VESSELS[0], 1200, 0, 0.5, 7)).toThrow();
    expect(() => predictEta(VESSELS[0], 1200, 14, 1.5, 7)).toThrow();
    expect(() => predictEta(VESSELS[0], -1, 14, 0.5, 7)).toThrow();
  });

  it("predictAll falls back for missing legs", () => {
    const preds = predictAll(VESSELS, {}, 0.5, 7);

    expect(preds).toHaveLength(10);
    for (const p of preds) {
      expect(p.distanceNm).toBe(800);
      expect(p.speedKn).toBe(14);
    }
  });

  it("applyPredictions shifts etas and does not mutate", () => {
    const before = VESSELS.map((v) => v.etaHours);
    const preds = predictAll(VESSELS, VOYAGE_LEGS, 0.6, 7);
    const shifted = applyPredictions(VESSELS, preds);

    expect(VESSELS.map((v) => v.etaHours)).toEqual(before);
    expect(shifted[0].etaHours).toBe(preds[0].predictedHours);
    expect(shifted[0].name).toBe(VESSELS[0].name);
    expect(shifted[0].id).toBe(VESSELS[0].id);
  });
});