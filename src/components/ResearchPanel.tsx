"use client";

import { useState } from "react";
import { AlertTriangle, FlaskConical, Play } from "lucide-react";
import { compareAlgorithms } from "@/lib/berth";
import { solveExact, gapAgainstExact } from "@/lib/exact";
import { BENCHMARK_INSTANCES } from "@/lib/benchmarks";
import type {
  AlgorithmId,
  BenchmarkResult,
  Berth,
  ExactResult,
  Vessel,
} from "@/lib/types";

const fmt = (n: number, digits = 2) => (Number.isFinite(n) ? n.toFixed(digits) : "—");

function GapBadge({ gap, proven }: { gap: number | null; proven: boolean }) {
  if (gap === null) return <span className="text-slate-500">—</span>;
  // "OPTIMAL" is shown only against a PROVEN optimum. Against an unproven
  // (node-cap-hit) reference the badge would be a lie, so show the raw gap.
  if (proven && Math.abs(gap) < 0.005) {
    return (
      <span className="inline-flex rounded-full bg-emerald-400/15 px-2 py-0.5 font-mono text-xs font-bold text-emerald-300">
        OPTIMAL
      </span>
    );
  }
  return (
    <span className="font-mono text-sm text-signal-300">
      +{gap.toFixed(1)}%{proven ? "" : " (ref. unproven)"}
    </span>
  );
}

export default function ResearchPanel({
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
  const [subsetSize, setSubsetSize] = useState(6);
  const [exact, setExact] = useState<ExactResult | null>(null);
  const [exactError, setExactError] = useState<string | null>(null);
  const [runningExact, setRunningExact] = useState(false);
  const [benchmarks, setBenchmarks] = useState<BenchmarkResult[] | null>(null);
  const [runningBenchmarks, setRunningBenchmarks] = useState(false);

  const subset = vessels
    .slice()
    .sort((a, b) => a.etaHours - b.etaHours || (a.id < b.id ? -1 : 1))
    .slice(0, Math.min(subsetSize, vessels.length));

  function runExact() {
    setRunningExact(true);
    setExactError(null);
    // Let the UI paint the spinner before the (synchronous) search blocks.
    setTimeout(() => {
      try {
        const result = solveExact(subset, berths, {
          weights,
          tidesEnabled,
          seed,
          timeLimitMs: 400,
        });
        const { results } = compareAlgorithms(subset, berths, {
          weights,
          tidesEnabled,
          seed,
          timeLimitMs: 400,
        });
        result.gaps = results.map((r) => ({
          id: r.id as AlgorithmId,
          label: r.label,
          objective: r.economics.objective,
          gapPct: gapAgainstExact(r.economics.objective, result.objective),
        }));
        setExact(result);
      } catch (e) {
        setExactError(e instanceof Error ? e.message : "Exact solve failed");
      } finally {
        setRunningExact(false);
      }
    }, 30);
  }

  function runBenchmarks() {
    setRunningBenchmarks(true);
    setTimeout(() => {
      const out: BenchmarkResult[] = BENCHMARK_INSTANCES.map((instance) => {
        const { results } = compareAlgorithms(instance.vessels, instance.berths, {
          weights,
          tidesEnabled,
          seed,
          timeLimitMs: 400,
        });
        let exactObjective: number | null = null;
        let provenOptimal = false;
        if (instance.vessels.length <= 8) {
          const exact = solveExact(instance.vessels, instance.berths, {
            weights,
            tidesEnabled,
            seed,
            timeLimitMs: 400,
          });
          exactObjective = exact.objective;
          provenOptimal = exact.provenOptimal;
        }
        return {
          instanceId: instance.id,
          instanceName: instance.name,
          exactObjective,
          provenOptimal,
          rows: results.map((r) => ({
            id: r.id as AlgorithmId,
            label: r.label,
            objective: r.economics.objective,
            gapPct:
              exactObjective !== null
                ? gapAgainstExact(r.economics.objective, exactObjective)
                : null,
          })),
        };
      });
      setBenchmarks(out);
      setRunningBenchmarks(false);
    }, 30);
  }

  return (
    <div className="space-y-6">
      {/* ── Exact solver ─────────────────────────────── */}
      <section className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 font-display text-lg font-semibold text-white">
              <FlaskConical className="h-5 w-5 text-signal-400" />
              Exact solver: heuristics graded against truth
            </h3>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-400">
              Branch-and-bound proves the optimum on the first {subsetSize}{" "}
              vessels (by ETA). Every heuristic&apos;s gap is measured
              against that optimum — not against each other.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-slate-400">
              Vessels
              <select
                value={subsetSize}
                onChange={(e) => {
                  setSubsetSize(Number(e.target.value));
                  setExact(null);
                }}
                className="ml-2 rounded-lg border border-harbor-600 bg-harbor-850 px-2 py-1.5 font-mono text-sm text-white"
                aria-label="Vessels in exact solve"
              >
                <option value={6}>6</option>
                <option value={8}>8</option>
              </select>
            </label>
            <button
              onClick={runExact}
              disabled={runningExact}
              className="flex items-center gap-1.5 rounded-xl bg-signal-400 px-3.5 py-2 text-sm font-bold text-harbor-950 transition-colors hover:bg-signal-300 disabled:opacity-50"
            >
              <Play className="h-4 w-4" />
              {runningExact ? "Proving…" : exact ? "Re-run exact" : "Run exact solver"}
            </button>
          </div>
        </div>

        {exactError && (
          <div className="mt-4 flex items-start gap-3 rounded-2xl border border-red-800 bg-red-950 p-4">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
            <p className="text-sm text-red-300">{exactError}</p>
          </div>
        )}

        {exact && (
          <div className="mt-4 space-y-3">
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full border border-harbor-600 bg-harbor-850 px-3 py-1 font-mono text-xs text-slate-300">
                optimum objective {fmt(exact.objective, 3)}
              </span>
              <span
                className={`rounded-full px-3 py-1 font-mono text-xs font-bold ${
                  exact.provenOptimal
                    ? "bg-emerald-400/15 text-emerald-300"
                    : "bg-red-400/15 text-red-400"
                }`}
              >
                {exact.provenOptimal ? "✓ PROVEN OPTIMAL" : "NOT PROVEN (node cap hit)"}
              </span>
              <span className="rounded-full border border-harbor-600 bg-harbor-850 px-3 py-1 font-mono text-xs text-slate-300">
                {exact.nodesExplored.toLocaleString()} nodes explored
              </span>
              <span className="rounded-full border border-harbor-600 bg-harbor-850 px-3 py-1 font-mono text-xs text-slate-300">
                waiting {fmt(exact.plan.totalWaitingHours, 1)}h · makespan{" "}
                {fmt(exact.plan.makespanHours, 1)}h
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-left text-sm">
                <thead>
                  <tr className="border-b border-harbor-700 text-xs uppercase tracking-wider text-slate-500">
                    <th className="px-3 py-2 font-semibold">Heuristic</th>
                    <th className="px-3 py-2 font-semibold">Objective</th>
                    <th className="px-3 py-2 font-semibold">Gap vs optimum</th>
                  </tr>
                </thead>
                <tbody>
                  {exact.gaps.map((g) => (
                    <tr key={g.id} className="border-b border-harbor-800 last:border-0">
                      <td className="px-3 py-2 font-semibold text-white">{g.label}</td>
                      <td className="px-3 py-2 font-mono text-slate-300">
                        {fmt(g.objective, 3)}
                      </td>
                      <td className="px-3 py-2">
                        <GapBadge gap={g.gapPct} proven={exact.provenOptimal} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs leading-relaxed text-slate-500">
              Gap = (heuristic − optimum) / optimum × 100. A gap of 0 means
              the heuristic found the optimum the solver proved — the green
              OPTIMAL badge is only shown when the search completed
              (provenOptimal); gaps against an unproven reference are marked
              and approximate. The exact solver uses canonical-order
              branch-and-bound: vessels are appended in nondecreasing (start,
              vessel id) order, which visits each distinct plan exactly once,
              with an admissible lower bound (placed cost + cheapest possible
              completion) for pruning.
            </p>
          </div>
        )}
      </section>

      {/* ── Benchmarks ─────────────────────────────── */}
      <section className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-display text-lg font-semibold text-white">
              Cordeau-style benchmark instances
            </h3>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-400">
              Three instances in the documented Cordeau et al. (2005)
              structure — discrete berths, dynamic arrivals, mixed vessel
              sizes — up to the I2 size class (25 ships, 5 berths). Ground
              truth is the exact solver where the instance is small enough;
              see the honesty note below.
            </p>
          </div>
          <button
            onClick={runBenchmarks}
            disabled={runningBenchmarks}
            className="flex items-center gap-1.5 rounded-xl bg-signal-400 px-3.5 py-2 text-sm font-bold text-harbor-950 transition-colors hover:bg-signal-300 disabled:opacity-50"
          >
            <Play className="h-4 w-4" />
            {runningBenchmarks ? "Running…" : benchmarks ? "Re-run benchmarks" : "Run benchmarks"}
          </button>
        </div>

        {benchmarks && (
          <div className="mt-4 space-y-5">
            {benchmarks.map((b) => {
              const instance = BENCHMARK_INSTANCES.find((x) => x.id === b.instanceId)!;
              return (
                <div key={b.instanceId} className="rounded-xl border border-harbor-700 p-4">
                  <p className="font-semibold text-white">{b.instanceName}</p>
                  <p className="mt-0.5 text-xs text-slate-500">{instance.description}</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Ground truth: {instance.groundTruth}
                    {b.exactObjective !== null && (
                      <>
                        {" "}
                        · exact objective {fmt(b.exactObjective, 3)}{" "}
                        {b.provenOptimal ? "(proven)" : "(not proven)"}
                      </>
                    )}
                  </p>
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full min-w-[420px] text-left text-sm">
                      <thead>
                        <tr className="border-b border-harbor-700 text-xs uppercase tracking-wider text-slate-500">
                          <th className="px-3 py-2 font-semibold">Algorithm</th>
                          <th className="px-3 py-2 font-semibold">Objective</th>
                          <th className="px-3 py-2 font-semibold">Gap</th>
                        </tr>
                      </thead>
                      <tbody>
                        {b.rows.map((r) => (
                          <tr key={r.id} className="border-b border-harbor-800 last:border-0">
                            <td className="px-3 py-2 font-semibold text-white">{r.label}</td>
                            <td className="px-3 py-2 font-mono text-slate-300">
                              {fmt(r.objective, 3)}
                            </td>
                            <td className="px-3 py-2">
                              {r.gapPct !== null ? (
                                <GapBadge gap={r.gapPct} proven={b.provenOptimal} />
                              ) : (
                                <span className="text-xs text-slate-500">
                                  no exact reference
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <p className="mt-4 rounded-lg border border-harbor-700 bg-harbor-900 px-3 py-2 text-xs leading-relaxed text-slate-500">
          Honesty note: the original Cordeau et al. (2005) instance files
          are hosted behind a Google sign-in and per-instance published
          optimal values could not be retrieved from any openly accessible
          source at build time. These instances reproduce the documented
          generation structure, not the original files or values. If you
          hold the original files, the same solver and heuristics run
          unchanged on them.
        </p>
      </section>

      {/* ── MILP formulation ─────────────────────────────── */}
      <section className="card p-5">
        <h3 className="font-display text-lg font-semibold text-white">
          The problem, stated formally
        </h3>
        <p className="mt-1 text-sm leading-relaxed text-slate-400">
          Discrete, dynamic berth allocation with time (tide) windows, in the
          taxonomy of Bierwirth &amp; Meisel (2010) and the classification of
          Steenken et al. (2004). The solver below is the mixed-integer
          program the heuristics approximate.
        </p>
        <pre className="mt-4 overflow-x-auto rounded-xl border border-harbor-700 bg-harbor-900 p-4 font-mono text-[12px] leading-relaxed text-slate-300">
{`Sets
  V  vessels i, j        B  berths k        W  tide windows

Parameters
  aᵢ  ETA of vessel i            pᵢ  handling time of vessel i
  Lᵢ  length of vessel i         L̄ₖ  length of berth k
  B(i) ⊆ B  berths feasible for i (length + grain capability)
  draftᵢ, tide windows W (deep-draft vessels: draft ≥ 12 m)

Variables
  xᵢₖ ∈ {0,1}   1 if vessel i is assigned to berth k
  yᵢⱼₖ ∈ {0,1}  1 if vessel j immediately follows vessel i on berth k
  sᵢ ≥ 0        berthing (start) time of vessel i
  wᵢ ≥ 0        waiting time of vessel i

minimise   Σᵢ wᵢ                      (core objective; the app adds
                                      fuel + crane-cost terms, weighted)

subject to
  Σₖ∈B(i) xᵢₖ = 1                  ∀i   every vessel to one feasible berth
  flow conservation on y           ∀i,k each vessel has ≤ 1 predecessor
                                      and ≤ 1 successor per berth
  sᵢ ≥ aᵢ                          ∀i   cannot berth before ETA
  sⱼ ≥ sᵢ + pᵢ − M·(1 − yᵢⱼₖ)       ∀i,j,k  no overlap on a berth (big-M)
  wᵢ = sᵢ − aᵢ                      ∀i   waiting definition
  sᵢ ∈ ∪W  if draftᵢ ≥ 12 m               deep-draft entry only at high water
  xᵢₖ = 0  if Lᵢ > L̄ₖ or (grain i, non-grain k)`}
        </pre>
        <p className="mt-3 text-xs leading-relaxed text-slate-500">
          The MILP is NP-hard (it contains single-machine sequencing with
          release dates). That is why the app solves it with five
          metaheuristics for realistic sizes and reserves the exact
          branch-and-bound for ≤ 8 vessels, where proof is affordable.
        </p>
      </section>

      {/* ── References ─────────────────────────────── */}
      <section className="card p-5">
        <h3 className="font-display text-lg font-semibold text-white">References</h3>
        <ul className="mt-3 space-y-1.5 text-sm leading-relaxed text-slate-400">
          <li>Imai, A., Nagaiwa, K., &amp; Tat, C. W. (1997). Efficient planning of berth allocation for container terminals in Asia. <em>J. Adv. Transp.</em> 31, 75–94.</li>
          <li>Imai, A., Nishimura, E., &amp; Papadimitriou, S. (2001). The dynamic berth allocation problem for a container port. <em>Transp. Res. B</em> 35, 401–417.</li>
          <li>Steenken, D., Voß, S., &amp; Stahlbock, R. (2004). Container terminal operation and operations research — a classification and literature review. <em>OR Spectrum</em> 26(1), 3–49.</li>
          <li>Cordeau, J.-F., Laporte, G., Legato, P., &amp; Moccia, L. (2005). Models and tabu search heuristics for the berth-allocation problem. <em>Transp. Sci.</em> 39(4), 526–538.</li>
          <li>Ropke, S., &amp; Pisinger, D. (2006). An adaptive large neighborhood search heuristic for the pickup and delivery problem with time windows. <em>Transp. Sci.</em> 40(4), 455–472.</li>
          <li>Bierwirth, C., &amp; Meisel, F. (2010). A survey of berth allocation and quay crane scheduling problems in container terminals. <em>Eur. J. Oper. Res.</em> 202(3), 615–627.</li>
          <li>Caserta, M., Schwarze, S., &amp; Voß, S. (2012). A mathematical formulation and complexity considerations for the blocks relocation problem. <em>Eur. J. Oper. Res.</em> 219, 96–104.</li>
          <li>Bierwirth, C., &amp; Meisel, F. (2015). A follow-up survey of berth allocation and quay crane scheduling problems in container terminals. <em>Eur. J. Oper. Res.</em> 244(3), 675–689.</li>
          <li>Kim, K. H. (1997). Evaluation of the number of rehandles in container yards. <em>Comput. Ind. Eng.</em> 32(4), 701–711.</li>
          <li>Bertsimas, D., &amp; Sim, M. (2004). The price of robustness. <em>Oper. Res.</em> 52(1), 35–53.</li>
        </ul>
      </section>
    </div>
  );
}
