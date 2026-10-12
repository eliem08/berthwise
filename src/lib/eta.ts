import { mulberry32 } from "./rng";
import type { EtaPrediction, Vessel } from "./types";

export type { CargoType, EtaPrediction, Vessel } from "./types";

/**
 * berthwise — vessel ETA prediction for the Port of Casablanca berth planner.
 *
 * Model (deliberately simple and explainable):
 *
 *   predictedHours = scheduledHours + delayHours
 *   delayHours     = max(0, congestion * 16h + jitter)
 *
 * The vessel is already en route, so `vessel.etaHours` (the schedule) already
 * accounts for the sailing leg — `distanceNm / speedKn` is informational only.
 * What actually moves the ETA is congestion at the port, plus a small
 * deterministic per-vessel jitter so replays are reproducible.
 */

/** Fallback leg used when a vessel has no explicit leg in the legs map. */
const DEFAULT_LEG: { distanceNm: number; speedKn: number } = {
  distanceNm: 800,
  speedKn: 14,
};

/** Hours of delay added at full congestion (congestion === 1). */
const CONGESTION_DELAY_HOURS = 16;

/** Peak-to-peak spread of the deterministic per-vessel jitter, in hours. */
const JITTER_HOURS = 6;

/** Modulus keeping the string hash inside a safe 32-bit-ish integer range. */
const HASH_MODULUS = 2147483647;

/** Round to two decimals (used for every hour value we surface). */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Tiny deterministic string hash: sum of (charCode * 31), folded into a
 * positive integer. Gives every vessel id its own reproducible RNG stream.
 */
function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash + input.charCodeAt(i) * 31) % HASH_MODULUS;
  }
  return hash;
}

/** Guard against NaN / Infinity sneaking into the model. */
function assertFinite(value: number, name: string): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number`);
  }
}

/**
 * Predict the ETA for a single vessel.
 *
 * @param vessel      Vessel whose schedule (`etaHours`) is the baseline.
 * @param distanceNm  Remaining distance to the berth, in nautical miles (>= 0).
 * @param speedKn     Service speed in knots (> 0).
 * @param congestion  Port congestion factor in [0, 1].
 * @param seed        Base RNG seed; combined with a hash of `vessel.id`.
 */
export function predictEta(
  vessel: Vessel,
  distanceNm: number,
  speedKn: number,
  congestion: number,
  seed = 7,
): EtaPrediction {
  if (!vessel || typeof vessel.id !== "string" || vessel.id.length === 0) {
    throw new Error("vessel with a non-empty string id is required");
  }

  assertFinite(distanceNm, "distanceNm");
  assertFinite(speedKn, "speedKn");
  assertFinite(congestion, "congestion");
  assertFinite(seed, "seed");

  if (distanceNm < 0) {
    throw new Error("distanceNm must be >= 0");
  }
  if (speedKn <= 0) {
    throw new Error("speedKn must be > 0");
  }
  if (congestion < 0 || congestion > 1) {
    throw new Error("congestion must be within [0, 1]");
  }

  // Informational only: the vessel is already en route, so `vessel.etaHours`
  // already reflects the sailing leg. Only the congestion delay shifts the ETA.
  // sailingHours = distanceNm / speedKn

  const rand = mulberry32(seed + hashString(vessel.id))();

  const delayHours = round2(
    Math.max(0, congestion * CONGESTION_DELAY_HOURS + (rand - 0.5) * JITTER_HOURS),
  );
  const predictedHours = round2(vessel.etaHours + delayHours);

  return {
    vesselId: vessel.id,
    scheduledHours: vessel.etaHours,
    predictedHours,
    delayHours,
    distanceNm,
    speedKn,
  };
}

/**
 * Predict ETAs for a fleet, preserving input order.
 * Vessels missing from `legs` fall back to { distanceNm: 800, speedKn: 14 }.
 */
export function predictAll(
  vessels: Vessel[],
  legs: Record<string, { distanceNm: number; speedKn: number }>,
  congestion: number,
  seed = 7,
): EtaPrediction[] {
  if (!Array.isArray(vessels)) {
    throw new Error("vessels must be an array");
  }

  const legMap = legs ?? {};

  return vessels.map((vessel) => {
    const leg = legMap[vessel.id] ?? DEFAULT_LEG;
    return predictEta(vessel, leg.distanceNm, leg.speedKn, congestion, seed);
  });
}

/**
 * Apply predictions to the fleet: returns new vessel objects whose `etaHours`
 * is the predicted ETA. Inputs are never mutated; vessels without a matching
 * prediction keep their scheduled ETA.
 */
export function applyPredictions(
  vessels: Vessel[],
  predictions: EtaPrediction[],
): Vessel[] {
  if (!Array.isArray(vessels)) {
    throw new Error("vessels must be an array");
  }

  const predictedById = new Map<string, number>();
  for (const prediction of predictions ?? []) {
    if (
      prediction &&
      typeof prediction.vesselId === "string" &&
      Number.isFinite(prediction.predictedHours)
    ) {
      predictedById.set(prediction.vesselId, prediction.predictedHours);
    }
  }

  return vessels.map((vessel) => {
    const predictedHours = predictedById.get(vessel.id);
    if (predictedHours === undefined) {
      return { ...vessel };
    }
    return { ...vessel, etaHours: predictedHours };
  });
}