"use client";

import { TrendingDown } from "lucide-react";
import type { Box, YardSolution } from "@/lib/types";

type Props = {
  naive: YardSolution;
  optimized: YardSolution;
};

const TIER_CLASSES = [
  "bg-signal-400 text-harbor-950 border-signal-300",
  "bg-signal-600 text-white border-signal-500",
  "bg-harbor-600 text-slate-200 border-harbor-700",
  "bg-harbor-800 text-slate-400 border-harbor-700",
] as const;

const LEGEND = [
  { label: "1–25%", className: TIER_CLASSES[0] },
  { label: "26–50%", className: TIER_CLASSES[1] },
  { label: "51–75%", className: TIER_CLASSES[2] },
  { label: "76–100%", className: TIER_CLASSES[3] },
];

function boxCount(solution: YardSolution): number {
  if (solution.totalBoxes > 0) return solution.totalBoxes;
  return solution.stacks.reduce((sum, stack) => sum + stack.length, 0);
}

function rehandleRate(solution: YardSolution): number {
  const total = boxCount(solution);
  return total > 0 ? (solution.rehandles / total) * 100 : 0;
}

function tierIndex(rank: number, total: number): number {
  if (total <= 0) return 3;
  const ratio = rank / total;
  if (ratio <= 0.25) return 0;
  if (ratio <= 0.5) return 1;
  if (ratio <= 0.75) return 2;
  return 3;
}

function formatBoxId(id: string): string {
  const match = /^([A-Za-z]+)-?(\d+)$/.exec(id);
  if (!match) return id;
  return `${match[1]}-${match[2].padStart(3, "0")}`;
}

function BoxCell({ box, total }: { box: Box; total: number }) {
  const tier = tierIndex(box.retrievalRank, total);
  return (
    <div
      title={`${formatBoxId(box.id)} · retrieved #${box.retrievalRank} · → ${box.destination}`}
      className={`flex h-9 w-12 shrink-0 items-center justify-center rounded-sm border font-mono text-[10px] leading-none ${TIER_CLASSES[tier]}`}
    >
      {box.retrievalRank}
    </div>
  );
}

function YardPanel({
  eyebrow,
  title,
  solution,
}: {
  eyebrow: string;
  title: string;
  solution: YardSolution;
}) {
  const total = boxCount(solution);
  const rate = rehandleRate(solution);

  return (
    <section className="card flex flex-col p-4 sm:p-5">
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="section-label">{eyebrow}</p>
          <h3 className="font-display text-lg leading-tight text-slate-100">{title}</h3>
        </div>
        <div className="shrink-0 text-right">
          <p className="stat-num text-3xl leading-none text-signal-400">{solution.rehandles}</p>
          <p className="mt-1 font-mono text-[11px] text-slate-400">
            rehandles · {rate.toFixed(1)}%
          </p>
        </div>
      </header>

      <div className="mt-4 overflow-x-auto pb-2">
        <div className="flex min-w-max items-end gap-2">
          {solution.stacks.map((stack, stackIndex) => (
            <div key={stackIndex} className="flex flex-col-reverse gap-1">
              {stack.map((box) => (
                <BoxCell key={box.id} box={box} total={total} />
              ))}
            </div>
          ))}
        </div>
      </div>

      <p className="mt-2 font-mono text-[11px] text-slate-500">
        {solution.stackCount} stacks · max height {solution.maxHeight} · {total} boxes
      </p>
    </section>
  );
}

export default function YardVisualizer({ naive, optimized }: Props) {
  const saved = naive.rehandles - optimized.rehandles;
  const savedPct = naive.rehandles > 0 ? (saved / naive.rehandles) * 100 : 0;
  const improved = saved > 0;

  return (
    <div className="w-full">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <YardPanel eyebrow="Baseline" title="FCFS baseline" solution={naive} />
        <YardPanel eyebrow="Optimized" title="AI-optimized stacking" solution={optimized} />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="section-label">Retrieval order</span>
        <div className="flex flex-wrap items-center gap-3">
          {LEGEND.map((entry) => (
            <span key={entry.label} className="flex items-center gap-1.5">
              <span className={`h-3 w-3 rounded-sm border ${entry.className}`} />
              <span className="font-mono text-[11px] text-slate-400">{entry.label}</span>
            </span>
          ))}
        </div>
        <span className="font-mono text-[11px] text-slate-500">hottest first</span>
      </div>

      {improved && (
        <div className="mt-4 flex items-start gap-3 rounded-lg border border-signal-600/40 bg-harbor-850 p-4">
          <TrendingDown className="mt-0.5 h-5 w-5 shrink-0 text-signal-400" aria-hidden="true" />
          <div>
            <p className="font-display text-base text-slate-100">
              −{saved} rehandles ({savedPct.toFixed(0)}% fewer unproductive moves)
            </p>
            <p className="mt-1 text-xs text-slate-400">
              {naive.rehandles} → {optimized.rehandles} rehandles across {boxCount(optimized)} boxes.
            </p>
          </div>
        </div>
      )}

      <p className="mt-4 text-xs leading-relaxed text-slate-500">
        A rehandle = lifting a box out of the way to reach the box below it. Optimized stacking places
        late-departing boxes at the bottom.
      </p>
    </div>
  );
}