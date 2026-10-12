"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ChevronRight,
  Info,
  RotateCcw,
  Ship,
  Sparkles,
  Wheat,
} from "lucide-react";
import GanttChart from "@/components/GanttChart";
import YardVisualizer from "@/components/YardVisualizer";
import KpiCards from "@/components/KpiCards";
import CompareCharts from "@/components/CompareCharts";
import EtaTable from "@/components/EtaTable";
import { planNaive, planOptimized } from "@/lib/berth";
import { stackNaive, stackOptimized } from "@/lib/yard";
import { predictAll, applyPredictions } from "@/lib/eta";
import { computeKpis, compareKpis } from "@/lib/kpi";
import type { KpiDelta } from "@/lib/kpi";
import {
  BERTHS,
  VESSELS,
  YARD_BOXES,
  VOYAGE_LEGS,
  YARD_CONFIG,
} from "@/lib/data";
import type {
  BerthPlan,
  EtaPrediction,
  Kpis,
  Vessel,
  YardSolution,
} from "@/lib/types";

type Mode = "optimized" | "baseline";
type Tab = "overview" | "berth" | "yard" | "eta";

interface ComputeResult {
  predictions: EtaPrediction[];
  vesselsEff: Vessel[];
  planOpt: BerthPlan;
  planBase: BerthPlan;
  yardOpt: YardSolution;
  yardBase: YardSolution;
  kpisOpt: Kpis;
  kpisBase: Kpis;
  deltas: KpiDelta[];
}

const DEFAULTS = { grainPriority: true, congestion: 0.55, seed: 42 };

function computeAll(grainPriority: boolean, congestion: number, seed: number): ComputeResult {
  const predictions = predictAll(VESSELS, VOYAGE_LEGS, congestion, seed);
  const vesselsEff = applyPredictions(VESSELS, predictions);
  const planOpt = planOptimized(vesselsEff, BERTHS, {
    grainPriority,
    seed,
    timeLimitMs: 600,
  });
  const planBase = planNaive(vesselsEff, BERTHS);
  const yardOpt = stackOptimized(
    YARD_BOXES,
    YARD_CONFIG.stackCount,
    YARD_CONFIG.maxHeight,
  );
  const yardBase = stackNaive(
    YARD_BOXES,
    YARD_CONFIG.stackCount,
    YARD_CONFIG.maxHeight,
  );
  const kpisOpt = computeKpis(planOpt, yardOpt);
  const kpisBase = computeKpis(planBase, yardBase);
  const deltas = compareKpis(kpisBase, kpisOpt);
  return {
    predictions,
    vesselsEff,
    planOpt,
    planBase,
    yardOpt,
    yardBase,
    kpisOpt,
    kpisBase,
    deltas,
  };
}

function Skeleton() {
  return (
    <div className="space-y-4" aria-label="Computing plan">
      <div className="card animate-pulse">
        <div className="h-6 w-1/3 rounded bg-harbor-700" />
        <div className="mt-4 h-40 rounded-lg bg-harbor-800" />
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="card animate-pulse">
            <div className="h-4 w-2/3 rounded bg-harbor-700" />
            <div className="mt-3 h-8 w-1/2 rounded bg-harbor-800" />
          </div>
        ))}
      </div>
    </div>
  );
}

const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "berth", label: "Berth plan" },
  { id: "yard", label: "Yard stacking" },
  { id: "eta", label: "Vessel ETAs" },
];

const STEPS = [
  "Set port congestion",
  "Toggle grain priority",
  "Compare AI vs FCFS baseline",
];

export default function DemoPage() {
  const [grainPriority, setGrainPriority] = useState(DEFAULTS.grainPriority);
  const [congestion, setCongestion] = useState(DEFAULTS.congestion);
  const [seed, setSeed] = useState(DEFAULTS.seed);
  const [mode, setMode] = useState<Mode>("optimized");
  const [tab, setTab] = useState<Tab>("overview");
  const [computing, setComputing] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ComputeResult | null>(null);

  useEffect(() => {
    setComputing(true);
    const t = setTimeout(() => {
      try {
        setResult(computeAll(grainPriority, congestion, seed));
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unknown planning error");
      } finally {
        setComputing(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [grainPriority, congestion, seed]);

  const plan = useMemo(
    () => (result ? (mode === "optimized" ? result.planOpt : result.planBase) : null),
    [result, mode],
  );
  const kpis = useMemo(
    () => (result ? (mode === "optimized" ? result.kpisOpt : result.kpisBase) : null),
    [result, mode],
  );

  const vesselById = useMemo(
    () => new Map((result?.vesselsEff ?? []).map((v) => [v.id, v])),
    [result],
  );
  const berthById = useMemo(() => new Map(BERTHS.map((b) => [b.id, b])), []);
  const sortedAssignments = useMemo(
    () =>
      (plan?.assignments ?? [])
        .slice()
        .sort((a, b) => a.startHours - b.startHours),
    [plan],
  );

  function resetAll() {
    setGrainPriority(DEFAULTS.grainPriority);
    setCongestion(DEFAULTS.congestion);
    setSeed(DEFAULTS.seed);
    setMode("optimized");
  }

  return (
    <div className="bg-harbor-950">
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-14">
        {/* Header */}
        <p className="section-label">Live demo · Port of Casablanca</p>
        <h1 className="mt-3 font-display text-4xl font-bold tracking-tight text-white sm:text-5xl">
          The optimization loop, live.
        </h1>
        <p className="mt-4 max-w-2xl text-lg text-slate-300/85">
          Ten vessels inbound, four berths, forty boxes in the yard. Tune the
          scenario and watch the plan rebuild.
        </p>

        {/* Guided steps */}
        <div className="card mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
          {STEPS.map((step, i) => (
            <div key={step} className="flex items-center gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-signal-400 font-display text-sm font-bold text-harbor-950">
                {i + 1}
              </span>
              <span className="text-sm font-semibold text-slate-200">{step}</span>
              {i < STEPS.length - 1 && (
                <ChevronRight className="hidden h-4 w-4 text-slate-600 sm:block" />
              )}
            </div>
          ))}
        </div>

        {/* Controls */}
        <div className="card mt-6">
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                Planning mode
              </p>
              <div className="flex rounded-xl border border-harbor-600 p-1">
                <button
                  onClick={() => setMode("optimized")}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                    mode === "optimized"
                      ? "bg-signal-400 text-harbor-950"
                      : "text-slate-300 hover:text-white"
                  }`}
                >
                  <Sparkles className="h-4 w-4" /> AI optimized
                </button>
                <button
                  onClick={() => setMode("baseline")}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                    mode === "baseline"
                      ? "bg-signal-400 text-harbor-950"
                      : "text-slate-300 hover:text-white"
                  }`}
                >
                  <Ship className="h-4 w-4" /> FCFS baseline
                </button>
              </div>
            </div>

            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                Grain priority
              </p>
              <button
                onClick={() => setGrainPriority((v) => !v)}
                className={`flex w-full items-center justify-between rounded-xl border px-4 py-2.5 transition-colors ${
                  grainPriority
                    ? "border-signal-400 bg-signal-400/10"
                    : "border-harbor-600 hover:border-slate-500"
                }`}
              >
                <span className="flex items-center gap-2 text-sm font-semibold text-slate-200">
                  <Wheat className="h-4 w-4 text-signal-400" />
                  Grain bulkers first
                </span>
                <span
                  className={`rounded-full px-2.5 py-0.5 font-mono text-xs font-bold ${
                    grainPriority
                      ? "bg-signal-400 text-harbor-950"
                      : "bg-harbor-700 text-slate-400"
                  }`}
                >
                  {grainPriority ? "ON" : "OFF"}
                </span>
              </button>
            </div>

            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                Port congestion · {Math.round(congestion * 100)}%
              </p>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={congestion}
                onChange={(e) => setCongestion(Number(e.target.value))}
                className="w-full accent-amber-500"
                aria-label="Port congestion"
              />
              <p className="mt-1 text-xs text-slate-500">Drives ETA delays</p>
            </div>

            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                Random seed
              </p>
              <div className="flex gap-2">
                <input
                  type="number"
                  value={seed}
                  onChange={(e) => setSeed(Math.floor(Number(e.target.value) || 0))}
                  className="w-full rounded-xl border border-harbor-600 bg-harbor-850 px-3 py-2.5 font-mono text-sm text-white focus:border-signal-400 focus:outline-none"
                  aria-label="Random seed"
                />
                <button
                  onClick={resetAll}
                  title="Reset all controls"
                  className="flex items-center justify-center rounded-xl border border-harbor-600 px-3.5 text-slate-300 transition-colors hover:border-signal-400 hover:text-signal-300"
                >
                  <RotateCcw className="h-4 w-4" />
                </button>
              </div>
              <p className="mt-1 text-xs text-slate-500">Same seed → same plan</p>
            </div>
          </div>
        </div>

        {/* Error banner */}
        {error && (
          <div className="mt-6 flex items-start gap-3 rounded-2xl border border-red-800 bg-red-950 p-4">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
            <div>
              <p className="font-semibold text-red-300">Planning failed</p>
              <p className="mt-1 text-sm text-red-300/80">{error}</p>
              <button
                onClick={resetAll}
                className="mt-2 text-sm font-semibold text-red-200 underline underline-offset-2"
              >
                Reset the controls and try again
              </button>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="mt-8 flex gap-1 overflow-x-auto border-b border-harbor-700">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`whitespace-nowrap px-4 py-3 text-sm font-semibold transition-colors ${
                tab === t.id
                  ? "border-b-2 border-signal-400 text-white"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="mt-6">
          {computing || !result || !plan || !kpis ? (
            <Skeleton />
          ) : (
            <>
              {tab === "overview" && (
                <div className="space-y-6">
                  <KpiCards kpis={kpis} />
                  <CompareCharts deltas={result.deltas} />
                  <div className="card flex items-start gap-3">
                    <Info className="mt-0.5 h-5 w-5 shrink-0 text-tide-400" />
                    <p className="text-sm leading-relaxed text-slate-300">
                      <span className="font-semibold text-white">
                        What this means in money:{" "}
                      </span>
                      multiply the waiting-hour delta by your demurrage rate and
                      the rehandle delta by your crane-move cost — those two
                      products are the savings this plan puts on the table, per
                      planning cycle.
                    </p>
                  </div>
                </div>
              )}

              {tab === "berth" && (
                <div className="space-y-6">
                  <div className="flex flex-wrap gap-2">
                    <span className="rounded-full border border-harbor-600 bg-harbor-850 px-3 py-1 font-mono text-xs text-slate-300">
                      {mode === "optimized" ? "AI optimized" : "FCFS baseline"}
                    </span>
                    <span className="rounded-full border border-harbor-600 bg-harbor-850 px-3 py-1 font-mono text-xs text-slate-300">
                      grain priority {grainPriority ? "on" : "off"}
                    </span>
                    <span className="rounded-full border border-harbor-600 bg-harbor-850 px-3 py-1 font-mono text-xs text-slate-300">
                      seed {seed}
                    </span>
                  </div>
                  <GanttChart
                    plan={plan}
                    vessels={result.vesselsEff}
                    berths={BERTHS}
                  />
                  {plan.unassigned.length > 0 && (
                    <div className="flex items-start gap-3 rounded-2xl border border-red-800 bg-red-950 p-4">
                      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
                      <p className="text-sm text-red-300">
                        {plan.unassigned.length} vessel(s) could not be placed:{" "}
                        {plan.unassigned.join(", ")}. No feasible berth (length
                        or grain capability).
                      </p>
                    </div>
                  )}
                  <div className="card overflow-hidden p-0">
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[640px] text-left text-sm">
                        <thead>
                          <tr className="border-b border-harbor-700 text-xs uppercase tracking-wider text-slate-500">
                            <th className="px-5 py-3 font-semibold">Vessel</th>
                            <th className="px-5 py-3 font-semibold">Berth</th>
                            <th className="px-5 py-3 font-semibold">Start</th>
                            <th className="px-5 py-3 font-semibold">End</th>
                            <th className="px-5 py-3 font-semibold">Waiting</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sortedAssignments.map((a) => {
                            const v = vesselById.get(a.vesselId);
                            const b = berthById.get(a.berthId);
                            return (
                              <tr
                                key={a.vesselId}
                                className="border-b border-harbor-800 last:border-0 hover:bg-harbor-850"
                              >
                                <td className="px-5 py-3">
                                  <span className="font-semibold text-white">
                                    {v?.name ?? a.vesselId}
                                  </span>
                                  <span className="ml-2 text-xs text-slate-500">
                                    {v?.cargo === "grain" ? "grain" : "container"}
                                  </span>
                                </td>
                                <td className="px-5 py-3 text-slate-300">
                                  {b?.name ?? a.berthId}
                                </td>
                                <td className="px-5 py-3 font-mono text-slate-300">
                                  h+{a.startHours.toFixed(1)}
                                </td>
                                <td className="px-5 py-3 font-mono text-slate-300">
                                  h+{a.endHours.toFixed(1)}
                                </td>
                                <td
                                  className={`px-5 py-3 font-mono font-semibold ${
                                    a.waitingHours > 4
                                      ? "text-red-400"
                                      : a.waitingHours > 0.05
                                        ? "text-signal-300"
                                        : "text-emerald-400"
                                  }`}
                                >
                                  {a.waitingHours.toFixed(1)}h
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {tab === "yard" && (
                <div className="space-y-6">
                  <YardVisualizer naive={result.yardBase} optimized={result.yardOpt} />
                  <div className="card flex items-start gap-3">
                    <Info className="mt-0.5 h-5 w-5 shrink-0 text-tide-400" />
                    <p className="text-sm leading-relaxed text-slate-300">
                      <span className="font-semibold text-white">
                        The best-fit rule:{" "}
                      </span>
                      boxes are stacked latest-retrieval-first, each one placed
                      on the stack whose top box leaves soonest after it. The
                      baseline stacks boxes in arrival order — which is why
                      retrievals have to dig.
                    </p>
                  </div>
                </div>
              )}

              {tab === "eta" && (
                <div className="space-y-6">
                  <EtaTable
                    predictions={result.predictions}
                    vessels={VESSELS}
                  />
                  <div className="card flex items-start gap-3">
                    <Info className="mt-0.5 h-5 w-5 shrink-0 text-tide-400" />
                    <p className="text-sm leading-relaxed text-slate-300">
                      Predicted ETAs feed the berth planner — raise the
                      congestion slider above and watch anchorage waiting time
                      grow on the Berth plan tab. The model is intentionally
                      simple (constant-velocity sailing + congestion delay);
                      swap in a live AIS feed by replacing one function in{" "}
                      <span className="font-mono text-tide-300">src/lib/eta.ts</span>.
                    </p>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
