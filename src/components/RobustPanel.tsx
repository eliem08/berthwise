"use client";

import { useState } from "react";
import { Play, ShieldCheck } from "lucide-react";
import { robustnessTradeoff, ROBUST_BUFFERS } from "@/lib/robust";
import type { Berth, RobustResult, Vessel } from "@/lib/types";

const fmt = (n: number, digits = 2) => (Number.isFinite(n) ? n.toFixed(digits) : "—");

export default function RobustPanel({
  vessels,
  berths,
  weights,
  tidesEnabled,
  seed,
}: {
  vessels: Vessel[];
  berths: Berth[];
  weights: { waiting: number; fuel: number; crane: number };
  tidesEnabled: boolean;
  seed: number;
}) {
  const [result, setResult] = useState<RobustResult | null>(null);
  const [running, setRunning] = useState(false);

  function run() {
    setRunning(true);
    setTimeout(() => {
      setResult(
        robustnessTradeoff(
          vessels,
          berths,
          { weights, tidesEnabled, seed, timeLimitMs: 400 },
          ROBUST_BUFFERS,
          200,
          7,
          2,
        ),
      );
      setRunning(false);
    }, 30);
  }

  const maxFeasibility = result
    ? Math.max(...result.points.map((p) => p.feasibilityRate), 0.01)
    : 1;

  return (
    <div className="space-y-6">
      <section className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 font-display text-lg font-semibold text-white">
              <ShieldCheck className="h-5 w-5 text-signal-400" />
              Robustness: what ETAs slipping ±6h costs you
            </h3>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-400">
              Each vessel&apos;s realised ETA is assumed to fall in [ETA − 6h,
              ETA + 6h] — a box uncertainty set, no distribution assumed. A
              robust plan with buffer β is optimised against ETAs inflated by
              β, then stress-tested on 200 sampled scenarios. A scenario
              counts as feasible when no vessel&apos;s start slips more than
              2h past its published start.
            </p>
          </div>
          <button
            onClick={run}
            disabled={running}
            className="flex items-center gap-1.5 rounded-xl bg-signal-400 px-3.5 py-2 text-sm font-bold text-harbor-950 transition-colors hover:bg-signal-300 disabled:opacity-50"
          >
            <Play className="h-4 w-4" />
            {running ? "Stress-testing…" : result ? "Re-run stress test" : "Run stress test"}
          </button>
        </div>

        {result && (
          <div className="mt-5 space-y-5">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] text-left text-sm">
                <thead>
                  <tr className="border-b border-harbor-700 text-xs uppercase tracking-wider text-slate-500">
                    <th className="px-3 py-2 font-semibold">Buffer β</th>
                    <th className="px-3 py-2 font-semibold">Nominal objective</th>
                    <th className="px-3 py-2 font-semibold">Cost of robustness</th>
                    <th className="px-3 py-2 font-semibold">Feasibility rate</th>
                    <th className="px-3 py-2 font-semibold">Mean slip</th>
                    <th className="px-3 py-2 font-semibold">Worst slip</th>
                  </tr>
                </thead>
                <tbody>
                  {result.points.map((p) => (
                    <tr key={p.bufferHours} className="border-b border-harbor-800 last:border-0">
                      <td className="px-3 py-2 font-mono font-semibold text-white">
                        {p.bufferHours}h
                      </td>
                      <td className="px-3 py-2 font-mono text-slate-300">
                        {fmt(p.nominalObjective, 3)}
                      </td>
                      <td className="px-3 py-2 font-mono text-slate-300">
                        {p.costOfRobustnessPct >= 0.005
                          ? `+${p.costOfRobustnessPct.toFixed(1)}%`
                          : "±0%"}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`font-mono font-semibold ${
                            p.feasibilityRate >= 0.99
                              ? "text-emerald-300"
                              : p.feasibilityRate >= 0.8
                                ? "text-signal-300"
                                : "text-red-400"
                          }`}
                        >
                          {(p.feasibilityRate * 100).toFixed(0)}%
                        </span>
                      </td>
                      <td className="px-3 py-2 font-mono text-slate-300">
                        {fmt(p.meanSlipHours, 1)}h
                      </td>
                      <td className="px-3 py-2 font-mono text-slate-300">
                        {fmt(p.worstSlipHours, 1)}h
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Tradeoff bars */}
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Tradeoff: feasibility (bars) vs cost of robustness (labels)
              </p>
              {result.points.map((p) => (
                <div key={p.bufferHours} className="flex items-center gap-3">
                  <span className="w-10 shrink-0 font-mono text-xs text-slate-400">
                    β={p.bufferHours}h
                  </span>
                  <div className="h-5 flex-1 overflow-hidden rounded-md bg-harbor-800">
                    <div
                      className={`h-full rounded-md ${
                        p.feasibilityRate >= 0.99
                          ? "bg-emerald-400"
                          : p.feasibilityRate >= 0.8
                            ? "bg-signal-400"
                            : "bg-red-400"
                      }`}
                      style={{ width: `${(p.feasibilityRate / maxFeasibility) * 100}%` }}
                    />
                  </div>
                  <span className="w-28 shrink-0 text-right font-mono text-xs text-slate-400">
                    {(p.feasibilityRate * 100).toFixed(0)}% · +
                    {p.costOfRobustnessPct.toFixed(1)}% cost
                  </span>
                </div>
              ))}
            </div>

            <p className="text-xs leading-relaxed text-slate-500">
              This is the price of robustness (Bertsimas &amp; Sim 2004):
              buying feasibility against ETA slips costs nominal
              performance. Note β = 8h exceeds the 6h uncertainty
              half-width, so its published starts can never slip — the
              sweep is monotone in ETAs — which is why it scores 100%.
              Pick the smallest β whose feasibility you can live with.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
