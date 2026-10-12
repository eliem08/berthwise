"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { TrendingDown, TrendingUp } from "lucide-react";
import type { KpiDelta } from "@/lib/kpi";

const SHORT_LABELS: Record<string, string> = {
  "Avg vessel waiting time": "Waiting (h)",
  "Berth utilization": "Utilization (%)",
  Rehandles: "Rehandles",
  "Rehandle rate": "Rehandle %",
  Throughput: "Throughput",
};

function shortLabel(label: string): string {
  return SHORT_LABELS[label] ?? label;
}

function formatNumber(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function formatValue(value: number, unit: string): string {
  const n = formatNumber(value);
  return unit ? `${n} ${unit}` : n;
}

type Verdict = "better" | "worse" | "flat";

function verdictOf(delta: KpiDelta): Verdict {
  if (delta.delta === 0) return "flat";
  const improved =
    delta.betterWhen === "lower" ? delta.delta < 0 : delta.delta > 0;
  return improved ? "better" : "worse";
}

const PILL_STYLES: Record<Verdict, string> = {
  better: "text-emerald-400 border-emerald-800 bg-emerald-950",
  worse: "text-red-400 border-red-900 bg-red-950",
  flat: "text-slate-400 border-slate-700 bg-slate-900",
};

const TOOLTIP_STYLE = {
  backgroundColor: "#0a1628",
  border: "1px solid #1b3355",
  borderRadius: 8,
  color: "#e2e8f0",
  fontSize: 12,
} as const;

export default function CompareCharts({ deltas }: { deltas: KpiDelta[] }) {
  const chartData = deltas.map((d) => ({
    name: shortLabel(d.label),
    Baseline: d.before,
    Optimized: d.after,
  }));

  if (deltas.length === 0) {
    return (
      <div className="card p-6 text-sm text-slate-400">
        No comparison data available yet.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="card p-4 sm:p-6">
        <p className="section-label">Baseline vs optimized</p>
        <h3 className="mt-1 font-display text-lg text-slate-100">
          KPI comparison
        </h3>

        <div className="mt-4 w-full overflow-x-auto">
          <div className="h-[320px] min-w-[520px]">
            <ResponsiveContainer width="100%" height={320}>
              <BarChart
                data={chartData}
                margin={{ top: 8, right: 12, bottom: 8, left: 0 }}
                barGap={4}
              >
                <CartesianGrid stroke="#1b3355" vertical={false} />
                <XAxis
                  dataKey="name"
                  tick={{ fill: "#94a3b8", fontSize: 12 }}
                  interval={0}
                  angle={-18}
                  textAnchor="end"
                  height={60}
                  stroke="#1b3355"
                />
                <YAxis
                  tick={{ fill: "#94a3b8", fontSize: 12 }}
                  stroke="#1b3355"
                  width={48}
                />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  labelStyle={{ color: "#e2e8f0", fontWeight: 600 }}
                  itemStyle={{ color: "#cbd5e1" }}
                  cursor={{ fill: "#122540" }}
                  formatter={(value: number | string) => formatNumber(Number(value))}
                />
                <Legend
                  wrapperStyle={{ color: "#94a3b8", fontSize: 12, paddingTop: 8 }}
                />
                <Bar
                  dataKey="Baseline"
                  fill="#475569"
                  radius={[6, 6, 0, 0]}
                  maxBarSize={48}
                />
                <Bar
                  dataKey="Optimized"
                  fill="#f5a623"
                  radius={[6, 6, 0, 0]}
                  maxBarSize={48}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

      <section className="card p-4 sm:p-6">
        <p className="section-label">Delta breakdown</p>
        <h3 className="mt-1 font-display text-lg text-slate-100">
          Change per metric
        </h3>

        <ul className="mt-4 divide-y divide-harbor-700">
          {deltas.map((d) => {
            const verdict = verdictOf(d);
            const sign = d.delta > 0 ? "+" : d.delta < 0 ? "\u2212" : "";
            const pillText = `${sign}${formatValue(Math.abs(d.delta), d.unit)}`;

            return (
              <li
                key={d.label}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-200">
                    {d.label}
                  </p>
                  <p className="mt-0.5 font-mono text-xs text-slate-400">
                    {formatValue(d.before, d.unit)}
                    <span className="mx-1.5 text-slate-600">&rarr;</span>
                    {formatValue(d.after, d.unit)}
                  </p>
                </div>

                <span
                  className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-xs ${PILL_STYLES[verdict]}`}
                >
                  {verdict === "better" && <TrendingDown size={14} />}
                  {verdict === "worse" && <TrendingUp size={14} />}
                  {verdict === "flat" && (
                    <span aria-hidden="true" className="text-slate-500">
                      &ndash;
                    </span>
                  )}
                  {pillText}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}