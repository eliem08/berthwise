"use client";

import type { AlgorithmResult, AlgorithmId } from "@/lib/types";

function fmt(n: number, digits = 1): string {
  return Number.isFinite(n) ? n.toFixed(digits) : "—";
}

const METHOD_NOTES: Record<AlgorithmId, string> = {
  greedy: "FCFS: each vessel takes the feasible berth with the earliest start.",
  annealing: "Greedy start, then random relocate moves accepted by a cooling temperature schedule.",
  tabu: "Random relocate moves with a short-term memory that forbids recent (vessel, berth) moves unless they beat the best.",
  ga: "Population of (order, berth) chromosomes; order crossover, swap mutation, elitism. Seeded by the greedy plan.",
  alns: "Adaptive large neighbourhood search (Ropke & Pisinger 2006): destroy operators (random / worst-cost / time-window) + regret-2 repair, adaptive operator weights.",
  exact: "Branch-and-bound: proves the optimum on ≤ 8-vessel instances. Shown on the Research tab, not in this race.",
};

export default function AlgorithmTable({
  results,
  winner,
}: {
  results: AlgorithmResult[];
  winner: AlgorithmId;
}) {
  if (results.length === 0) {
    return (
      <div className="card p-6 text-sm text-slate-400">
        No algorithm results available yet.
      </div>
    );
  }

  return (
    <section className="card overflow-hidden p-0">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead>
            <tr className="border-b border-harbor-700 text-xs uppercase tracking-wider text-slate-500">
              <th className="px-5 py-3 font-semibold">Algorithm</th>
              <th className="px-5 py-3 font-semibold">Waiting</th>
              <th className="px-5 py-3 font-semibold">Makespan</th>
              <th className="px-5 py-3 font-semibold">Fuel proxy</th>
              <th className="px-5 py-3 font-semibold">Crane cost</th>
              <th className="px-5 py-3 font-semibold">Crane-hours</th>
              <th className="px-5 py-3 font-semibold">Objective</th>
              <th className="px-5 py-3 font-semibold">Verdict</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r) => {
              const isWinner = r.id === winner;
              return (
                <tr
                  key={r.id}
                  className={`border-b border-harbor-800 last:border-0 ${
                    isWinner ? "bg-signal-400/5" : ""
                  }`}
                >
                  <td className="px-5 py-3">
                    <p className="font-semibold text-white">{r.label}</p>
                    <p className="mt-0.5 max-w-[240px] text-xs leading-snug text-slate-500">
                      {METHOD_NOTES[r.id]}
                    </p>
                  </td>
                  <td className="px-5 py-3 font-mono text-slate-300">
                    {fmt(r.plan.totalWaitingHours)}h
                  </td>
                  <td className="px-5 py-3 font-mono text-slate-300">
                    {fmt(r.plan.makespanHours)}h
                  </td>
                  <td className="px-5 py-3 font-mono text-slate-300">
                    {fmt(r.economics.fuelTonnes)}t
                  </td>
                  <td className="px-5 py-3 font-mono text-slate-300">
                    ${Math.round(r.economics.craneCostUsd).toLocaleString()}
                  </td>
                  <td className="px-5 py-3 font-mono text-slate-300">
                    {fmt(r.economics.craneHours, 0)}
                  </td>
                  <td className="px-5 py-3 font-mono font-semibold text-white">
                    {r.economics.objective.toFixed(3)}
                  </td>
                  <td className="px-5 py-3">
                    {isWinner ? (
                      <span className="inline-flex rounded-full bg-signal-400 px-2.5 py-0.5 font-mono text-xs font-bold text-harbor-950">
                        WINNER
                      </span>
                    ) : (
                      <span className="text-xs text-slate-500">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="border-t border-harbor-800 px-5 py-3 text-xs leading-relaxed text-slate-500">
        All five run on the same vessel set, weights, and tide setting; every
        plan is then crane-scheduled against the shared 8-crane pool. The
        winner minimises the weighted objective (waiting + fuel + crane cost,
        each normalised — see the sliders). Objective values are comparable
        only within one weight setting. For proof, see the Research tab:
        the exact branch-and-bound solver grades every heuristic against
        the proven optimum on small instances.
      </p>
    </section>
  );
}
