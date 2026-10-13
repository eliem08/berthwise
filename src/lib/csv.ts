import type { Berth, BerthPlan, CraneSchedule, Vessel } from "./types";
import { cranesForVessel } from "./economics";

function fmt(n: number, digits = 1): string {
  return Number.isFinite(n) ? n.toFixed(digits) : "";
}

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

/**
 * Serialise a berth plan (+ crane schedule) as CSV. Columns: vessel, line,
 * cargo, berth, start, end, waiting, cranes, crane-hours. A trailing summary
 * block carries the headline KPIs so the file is self-describing.
 */
export function planToCsv(
  plan: BerthPlan,
  vessels: Vessel[],
  berths: Berth[],
  craneSchedule?: CraneSchedule,
): string {
  const vesselById = new Map(vessels.map((v) => [v.id, v]));
  const berthById = new Map(berths.map((b) => [b.id, b]));
  const cranesByVessel = new Map(
    (craneSchedule?.assignments ?? []).map((c) => [c.vesselId, c.cranes]),
  );

  const lines: string[] = [];
  lines.push(
    ["Vessel", "Line", "Cargo", "Berth", "Start (h)", "End (h)", "Waiting (h)", "Cranes", "Crane-hours"].join(","),
  );

  const sorted = plan.assignments.slice().sort((a, b) => a.startHours - b.startHours);
  for (const a of sorted) {
    const vessel = vesselById.get(a.vesselId);
    const berth = berthById.get(a.berthId);
    const cranes = cranesByVessel.get(a.vesselId) ?? (vessel && berth ? cranesForVessel(vessel, berth) : 0);
    const duration = Math.max(0, a.endHours - a.startHours);
    lines.push(
      [
        csvCell(vessel?.name ?? a.vesselId),
        csvCell(vessel?.line ?? ""),
        csvCell(vessel?.cargo ?? ""),
        csvCell(berth?.name ?? a.berthId),
        fmt(a.startHours),
        fmt(a.endHours),
        fmt(a.waitingHours),
        String(cranes),
        fmt(duration * cranes),
      ].join(","),
    );
  }

  lines.push("");
  lines.push(`Total waiting (h),${fmt(plan.totalWaitingHours)}`);
  lines.push(`Makespan (h),${fmt(plan.makespanHours)}`);
  lines.push(`Vessels assigned,${plan.assignments.length}`);
  lines.push(`Vessels unassigned,${plan.unassigned.length}`);
  if (craneSchedule) {
    lines.push(`Total crane-hours,${fmt(craneSchedule.totalCraneHours)}`);
    lines.push(`Peak crane usage,${craneSchedule.peakUsage} of ${craneSchedule.poolLimit}`);
    lines.push(`Avg crane utilisation (%),${fmt(craneSchedule.avgUtilizationPct)}`);
  }
  if (plan.unassigned.length > 0) {
    lines.push(`Unassigned vessels,${plan.unassigned.join("; ")}`);
  }

  return lines.join("\n") + "\n";
}
