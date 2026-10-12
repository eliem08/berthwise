"use client";

import { Fragment } from "react";
import type { Assignment, Berth, BerthPlan, Vessel } from "@/lib/types";

const PX_PER_HOUR = 26;
const ROW_HEIGHT = 56;
const LABEL_WIDTH = 180;
const TICK_HOURS = 12;
const BLOCK_HEIGHT = 34;

type GanttChartProps = {
  plan: BerthPlan;
  vessels: Vessel[];
  berths: Berth[];
};

function shortName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length <= 14) return trimmed;
  return `${trimmed.slice(0, 13)}…`;
}

function fmt(value: number, digits = 1): string {
  return value.toFixed(digits);
}

export default function GanttChart({ plan, vessels, berths }: GanttChartProps) {
  const vesselById = new Map<string, Vessel>(vessels.map((v) => [v.id, v]));

  const assignmentsByBerth = new Map<string, Assignment[]>();
  for (const assignment of plan.assignments) {
    const list = assignmentsByBerth.get(assignment.berthId);
    if (list) {
      list.push(assignment);
    } else {
      assignmentsByBerth.set(assignment.berthId, [assignment]);
    }
  }

  const totalHours = Math.max(1, Math.ceil(plan.makespanHours));
  const chartWidth = totalHours * PX_PER_HOUR;

  const ticks: number[] = [];
  for (let hour = 0; hour <= totalHours; hour += TICK_HOURS) {
    ticks.push(hour);
  }

  const isEmpty = plan.assignments.length === 0;

  return (
    <section className="card p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 className="font-display text-base font-semibold text-white sm:text-lg">
          Berth plan — Gantt
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-white/10 bg-harbor-800 px-3 py-1 font-mono text-[11px] text-white/70">
            Makespan {fmt(plan.makespanHours)}h
          </span>
          <span className="rounded-full border border-white/10 bg-harbor-800 px-3 py-1 font-mono text-[11px] text-white/70">
            Total waiting {fmt(plan.totalWaitingHours)}h
          </span>
        </div>
      </div>

      {isEmpty ? (
        <div className="mt-4 rounded-lg border border-dashed border-white/15 bg-harbor-900/60 px-4 py-10 text-center">
          <p className="text-sm text-white/60">No assignments in this plan.</p>
        </div>
      ) : (
        <>
          <div className="mt-4 overflow-x-auto">
            <div className="relative" style={{ minWidth: LABEL_WIDTH + chartWidth }}>
              <div className="flex">
                <div className="shrink-0" style={{ width: LABEL_WIDTH }} />
                <div className="relative h-6" style={{ width: chartWidth }}>
                  {ticks.map((tick) => (
                    <span
                      key={tick}
                      className="absolute top-0 -translate-x-1/2 font-mono text-[10px] text-white/40"
                      style={{ left: tick * PX_PER_HOUR }}
                    >
                      {tick}h
                    </span>
                  ))}
                </div>
              </div>

              <div className="overflow-hidden rounded-lg border border-white/10 bg-harbor-900/60">
                {berths.map((berth, index) => {
                  const rows = assignmentsByBerth.get(berth.id) ?? [];
                  return (
                    <div
                      key={berth.id}
                      className={`flex ${index > 0 ? "border-t border-white/10" : ""}`}
                    >
                      <div
                        className="flex shrink-0 flex-col justify-center px-3"
                        style={{ width: LABEL_WIDTH, height: ROW_HEIGHT }}
                      >
                        <p className="truncate text-sm font-semibold text-white">{berth.name}</p>
                        <p className="mt-0.5 truncate font-mono text-[10px] text-white/50">
                          {berth.lengthM}m · {berth.cranes} cranes
                          {berth.grainCapable ? " · grain" : ""}
                        </p>
                      </div>

                      <div
                        className="relative"
                        style={{ width: chartWidth, height: ROW_HEIGHT }}
                      >
                        {ticks.map((tick) => (
                          <div
                            key={tick}
                            className="absolute top-0 bottom-0 w-px bg-white/10"
                            style={{ left: tick * PX_PER_HOUR }}
                          />
                        ))}

                        {rows.map((assignment) => {
                          const vessel = vesselById.get(assignment.vesselId);
                          const label = vessel ? shortName(vessel.name) : assignment.vesselId;
                          const wait = assignment.waitingHours;
                          const etaHours = vessel
                            ? vessel.etaHours
                            : assignment.startHours - wait;
                          const handlingHours = Math.max(
                            0,
                            assignment.endHours - assignment.startHours,
                          );
                          const isGrain = vessel?.cargo === "grain";
                          const tooltip = `${vessel?.name ?? assignment.vesselId} · ${
                            vessel?.line ?? "—"
                          } · ${berth.name} — ETA h+${fmt(etaHours)} · Start h+${fmt(
                            assignment.startHours,
                          )} · Wait ${fmt(wait)}h · Handling ${fmt(handlingHours)}h`;

                          return (
                            <Fragment key={assignment.vesselId}>
                              {wait > 0.05 && (
                                <div
                                  className="hatch-wait absolute top-1/2 -translate-y-1/2 rounded-md border border-signal-500"
                                  style={{
                                    left: etaHours * PX_PER_HOUR,
                                    width: Math.max(2, wait * PX_PER_HOUR),
                                    height: BLOCK_HEIGHT,
                                  }}
                                  title={tooltip}
                                />
                              )}
                              <div
                                className={`absolute top-1/2 flex -translate-y-1/2 items-center overflow-hidden rounded-md px-2 ${
                                  isGrain ? "bg-signal-400" : "bg-tide-500"
                                }`}
                                style={{
                                  left: assignment.startHours * PX_PER_HOUR,
                                  width: Math.max(2, handlingHours * PX_PER_HOUR),
                                  height: BLOCK_HEIGHT,
                                }}
                                title={tooltip}
                              >
                                <span className="truncate text-[11px] font-semibold text-harbor-950">
                                  {label}
                                </span>
                              </div>
                            </Fragment>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-white/60">
            <span className="flex items-center gap-2">
              <span className="hatch-wait inline-block h-3.5 w-6 rounded-sm border border-signal-500" />
              Waiting at anchorage
            </span>
            <span className="flex items-center gap-2">
              <span className="inline-block h-3.5 w-6 rounded-sm bg-tide-500" />
              Container handling
            </span>
            <span className="flex items-center gap-2">
              <span className="inline-block h-3.5 w-6 rounded-sm bg-signal-400" />
              Grain handling
            </span>
          </div>
        </>
      )}
    </section>
  );
}