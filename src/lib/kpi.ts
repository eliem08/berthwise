import type { BerthPlan, YardSolution, Kpis } from "./types";

export type { BerthPlan, Assignment, YardSolution, Box, Kpis } from "./types";

/** Round to `factor` decimal places, guarding against NaN/Infinity. */
function roundTo(n: number, factor: number): number {
  if (!Number.isFinite(n)) return 0;
  const scaled = n * factor;
  // Nudge away from binary floating point representation error before rounding.
  const nudged = scaled >= 0 ? scaled + Number.EPSILON : scaled - Number.EPSILON;
  return Math.round(nudged) / factor;
}

/** Round to 2 decimal places. */
function r2(n: number): number {
  return roundTo(n, 100);
}

/** Round to 1 decimal place. */
function r1(n: number): number {
  return roundTo(n, 10);
}

/**
 * Compute the headline KPIs for a berth plan + yard solution pair.
 *
 * All divisions are guarded so that an empty or degenerate plan yields zeros
 * rather than NaN/Infinity.
 */
export function computeKpis(plan: BerthPlan, yard: YardSolution): Kpis {
  const assignments = plan.assignments ?? [];
  const unassigned = plan.unassigned ?? [];

  const assigned = assignments.length;
  const vesselCount = assigned + unassigned.length;

  const rawTotalWaitingHours = Number.isFinite(plan.totalWaitingHours)
    ? plan.totalWaitingHours
    : 0;
  const totalWaitingHours = r2(rawTotalWaitingHours);
  const avgWaitingHours = assigned > 0 ? r2(rawTotalWaitingHours / assigned) : 0;

  const makespanHours = Number.isFinite(plan.makespanHours) ? plan.makespanHours : 0;
  const berthBusyHours = plan.berthBusyHours ?? {};
  const berthIds = Object.keys(berthBusyHours);

  let berthUtilizationPct = 0;
  if (makespanHours > 0 && berthIds.length > 0) {
    const totalUtilization = berthIds.reduce((acc, berthId) => {
      const busy = berthBusyHours[berthId];
      const safeBusy = Number.isFinite(busy) ? busy : 0;
      return acc + (safeBusy / makespanHours) * 100;
    }, 0);
    berthUtilizationPct = r1(totalUtilization / berthIds.length);
  }

  const rehandles = Number.isFinite(yard.rehandles) ? yard.rehandles : 0;
  const totalBoxes = Number.isFinite(yard.totalBoxes) ? yard.totalBoxes : 0;
  const rehandleRatePct = totalBoxes > 0 ? r1((rehandles / totalBoxes) * 100) : 0;

  const throughputPerDay = makespanHours > 0 ? r2(assigned / (makespanHours / 24)) : 0;

  return {
    avgWaitingHours,
    totalWaitingHours,
    berthUtilizationPct,
    rehandles,
    rehandleRatePct,
    throughputPerDay,
    vesselCount,
    unassignedCount: unassigned.length,
  };
}

export interface KpiDelta {
  label: string;
  before: number;
  after: number;
  delta: number;
  unit: string;
  betterWhen: "lower" | "higher";
}

/**
 * Compare two KPI snapshots, returning one delta row per headline metric.
 * `delta` is always `after - before` (rounded to 2 decimals); consumers use
 * `betterWhen` to decide whether that delta represents an improvement.
 */
export function compareKpis(before: Kpis, after: Kpis): KpiDelta[] {
  const rows: Array<
    [label: string, before: number, after: number, unit: string, betterWhen: "lower" | "higher"]
  > = [
    ["Avg vessel waiting time", before.avgWaitingHours, after.avgWaitingHours, "hours", "lower"],
    ["Berth utilization", before.berthUtilizationPct, after.berthUtilizationPct, "%", "higher"],
    ["Rehandles", before.rehandles, after.rehandles, "moves", "lower"],
    ["Rehandle rate", before.rehandleRatePct, after.rehandleRatePct, "%", "lower"],
    ["Throughput", before.throughputPerDay, after.throughputPerDay, "vessels/day", "higher"],
  ];

  return rows.map(([label, beforeValue, afterValue, unit, betterWhen]) => {
    const safeBefore = Number.isFinite(beforeValue) ? beforeValue : 0;
    const safeAfter = Number.isFinite(afterValue) ? afterValue : 0;
    return {
      label,
      before: r2(safeBefore),
      after: r2(safeAfter),
      delta: r2(safeAfter - safeBefore),
      unit,
      betterWhen,
    };
  });
}