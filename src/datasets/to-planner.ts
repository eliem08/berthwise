import { assertPlanningInputs } from "../lib/validate";
import type { Berth, Vessel } from "../lib/types";
import type { PortCallDataset } from "./schemas";

/**
 * Convert a validated real-world dataset into the planner's internal
 * (Vessel[], Berth[]) representation.
 *
 * Every conversion choice that is NOT present in the source data is
 * recorded in the returned `assumptions` list. These assumptions are
 * exactly what a supervised pilot must replace with measured values —
 * they are the honest boundary between "the software runs" and "the
 * software knows the terminal".
 *
 * Time model: the planner works in hours from a horizon start. All dataset
 * timestamps are ISO UTC; etaHours = (etaUtc − horizonStartUtc) / 1h.
 */

/**
 * Conservative handling-time estimate used ONLY when the dataset does not
 * carry a terminal-provided estimate: 175 TEU per hour, minimum 2 h.
 * This is a placeholder rate, not a measured terminal productivity figure.
 */
export const FALLBACK_TEU_PER_HOUR = 175;
export const FALLBACK_MIN_HANDLING_HOURS = 2;

export interface PlannerInputs {
  vessels: Vessel[];
  berths: Berth[];
  /** Horizon start the etaHours are relative to (ISO UTC). */
  horizonStartUtc: string;
  /** Every non-data conversion choice, in plain language. */
  assumptions: string[];
}

export function toPlannerInputs(
  dataset: PortCallDataset,
  horizonStartUtc?: string,
): PlannerInputs {
  const start =
    horizonStartUtc ??
    dataset.vesselCalls
      .map((v) => v.etaUtc)
      .sort()
      .at(0)!;
  const startMs = Date.parse(start);
  if (!Number.isFinite(startMs)) {
    throw new Error(`invalid horizonStartUtc: ${start}`);
  }

  const assumptions: string[] = [];
  const noted = new Set<string>();
  const note = (a: string) => {
    if (!noted.has(a)) {
      noted.add(a);
      assumptions.push(a);
    }
  };

  const vessels: Vessel[] = dataset.vesselCalls.map((v) => {
    const etaHours = (Date.parse(v.etaUtc) - startMs) / 3_600_000;
    let handlingHours: number;
    if (v.handlingHoursEstimate !== undefined) {
      handlingHours = v.handlingHoursEstimate;
    } else {
      const teu = v.teu ?? 0;
      handlingHours = Math.max(
        FALLBACK_MIN_HANDLING_HOURS,
        teu / FALLBACK_TEU_PER_HOUR,
      );
      note(
        `vessel ${v.vesselId}: no handlingHoursEstimate in dataset — used fallback ` +
          `${FALLBACK_TEU_PER_HOUR} TEU/h (min ${FALLBACK_MIN_HANDLING_HOURS} h). ` +
          "Replace with the terminal's measured productivity before any pilot.",
      );
    }
    if (v.teu === undefined && v.cargoType === "container") {
      note(
        `vessel ${v.vesselId}: teu missing — crane/fuel economics use 0 TEU. ` +
          "Provide TEU from the stowage plan for meaningful cost figures.",
      );
    }
    return {
      id: v.vesselId,
      name: v.name,
      line: "dataset",
      etaHours,
      lengthM: v.loaM,
      draftM: v.draftM,
      cargo: v.cargoType,
      handlingHours,
      teu: v.teu ?? 0,
      origin: v.origin ?? "unknown",
    };
  });

  const berths: Berth[] = dataset.berths.map((b) => ({
    id: b.berthId,
    name: b.name,
    lengthM: b.lengthM,
    grainCapable: b.grainCapable,
    cranes: b.craneCount,
  }));

  note(
    "Crane availability windows in the dataset are NOT yet consumed: the planner " +
      "schedules cranes against a single shared pool (CRANE_POOL_LIMIT). Per-crane " +
      "windows are recorded for a future crane-constrained scheduler.",
  );
  note(
    "Tide restrictions in the dataset are NOT yet consumed: the planner uses its " +
      "stylised semidiurnal model (tide.ts). A pilot must wire real high-water " +
      "tables into the tide-window gate.",
  );
  note(
    "Yard snapshots validate the yard model only; berth planning does not " +
      "consume yard state in this version.",
  );
  if (dataset.tideRestrictions.length > 0) {
    note(
      `Dataset carries ${dataset.tideRestrictions.length} tide-restriction record(s) with ` +
        `depth thresholds (e.g. ${dataset.tideRestrictions[0].depthThresholdM} m); the planner ` +
        "still applies its own 12.0 m default threshold until the tables are wired in.",
    );
  }

  // The planner's own input validation is the last gate: malformed
  // conversions fail here, never silently.
  assertPlanningInputs(vessels, berths);

  return { vessels, berths, horizonStartUtc: start, assumptions };
}
