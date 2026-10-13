"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { CraneSchedule } from "@/lib/types";

const TOOLTIP_STYLE = {
  backgroundColor: "#0a1628",
  border: "1px solid #1b3355",
  borderRadius: 8,
  color: "#e2e8f0",
  fontSize: 12,
} as const;

export default function CraneChart({ schedule }: { schedule: CraneSchedule }) {
  if (schedule.usageSeries.length === 0) {
    return (
      <div className="card p-6 text-sm text-slate-400">
        No crane schedule available yet.
      </div>
    );
  }

  return (
    <section className="card p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="section-label">Crane pool</p>
          <h3 className="mt-1 font-display text-lg text-slate-100">
            Crane utilisation over time
          </h3>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="rounded-full border border-harbor-600 bg-harbor-850 px-3 py-1 font-mono text-xs text-slate-300">
            Peak {schedule.peakUsage} / {schedule.poolLimit}
          </span>
          <span className="rounded-full border border-harbor-600 bg-harbor-850 px-3 py-1 font-mono text-xs text-slate-300">
            Avg {schedule.avgUtilizationPct}%
          </span>
          <span className="rounded-full border border-harbor-600 bg-harbor-850 px-3 py-1 font-mono text-xs text-slate-300">
            {Math.round(schedule.totalCraneHours)} crane-hours
          </span>
        </div>
      </div>

      <div className="mt-4 h-[280px] w-full">
        <ResponsiveContainer width="100%" height={280}>
          <AreaChart data={schedule.usageSeries} margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
            <CartesianGrid stroke="#1b3355" vertical={false} />
            <XAxis
              dataKey="hour"
              tick={{ fill: "#94a3b8", fontSize: 12 }}
              stroke="#1b3355"
              tickFormatter={(v: number) => `h+${v}`}
            />
            <YAxis
              tick={{ fill: "#94a3b8", fontSize: 12 }}
              stroke="#1b3355"
              width={40}
              allowDecimals={false}
              domain={[0, schedule.poolLimit]}
            />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              labelStyle={{ color: "#e2e8f0", fontWeight: 600 }}
              itemStyle={{ color: "#cbd5e1" }}
              formatter={(value: number | string) => [`${value} cranes`, "In use"]}
              labelFormatter={(v: number) => `h+${v}`}
              cursor={{ fill: "#122540" }}
            />
            <ReferenceLine
              y={schedule.poolLimit}
              stroke="#f87171"
              strokeDasharray="6 4"
              label={{ value: `Pool limit (${schedule.poolLimit})`, fill: "#f87171", fontSize: 11, position: "insideTopRight" }}
            />
            <Area
              type="stepAfter"
              dataKey="cranesInUse"
              name="Cranes in use"
              stroke="#38bdf8"
              fill="#38bdf8"
              fillOpacity={0.25}
              strokeWidth={2}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <p className="mt-3 text-xs leading-relaxed text-slate-500">
        Cranes are shared across berths: container vessels take up to 3 cranes
        (1 per ~1,200 TEU, capped by the berth), grain vessels take 1. The
        scheduler never exceeds the pool — when cranes run out, a vessel waits
        for the next free crane instead of over-allocating.
      </p>
    </section>
  );
}
