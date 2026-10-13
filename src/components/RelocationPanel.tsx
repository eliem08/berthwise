"use client";

import { useMemo } from "react";
import { Boxes } from "lucide-react";
import { stackingComparison } from "@/lib/relocation";
import type { Box } from "@/lib/types";

export default function RelocationPanel({
  boxes,
  stackCount,
  maxHeight,
}: {
  boxes: Box[];
  stackCount: number;
  maxHeight: number;
}) {
  const rows = useMemo(
    () => stackingComparison(boxes, stackCount, maxHeight),
    [boxes, stackCount, maxHeight],
  );

  const bestRelocation = Math.min(...rows.map((r) => r.relocationRehandles));

  return (
    <section className="card p-5">
      <h3 className="flex items-center gap-2 font-display text-lg font-semibold text-white">
        <Boxes className="h-5 w-5 text-signal-400" />
        The relocation problem: what digging really costs
      </h3>
      <p className="mt-1 max-w-3xl text-sm leading-relaxed text-slate-400">
        The classic blocking count removes a blocking box from the yard when
        it is lifted aside — so a box can never block twice. In a real yard
        it is <em>relocated</em> to another stack, stays in the yard, and
        may have to move again. This is the container relocation problem
        (blocks relocation problem; Caserta, Schwarze &amp; Voß 2012). The
        table below runs the same three stacking methods under both
        counters. Relocation simulation uses one buffer stack — real
        terminals keep an empty row for exactly this reason — and charges
        3 minutes of crane time per move.
      </p>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead>
            <tr className="border-b border-harbor-700 text-xs uppercase tracking-wider text-slate-500">
              <th className="px-3 py-2 font-semibold">Stacking method</th>
              <th className="px-3 py-2 font-semibold">Blocking count</th>
              <th className="px-3 py-2 font-semibold">True relocations</th>
              <th className="px-3 py-2 font-semibold">Truck delay</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.method}
                className={`border-b border-harbor-800 last:border-0 ${
                  r.relocationRehandles === bestRelocation ? "bg-signal-400/5" : ""
                }`}
              >
                <td className="px-3 py-2 font-semibold text-white">{r.method}</td>
                <td className="px-3 py-2 font-mono text-slate-300">
                  {r.blockingRehandles}
                </td>
                <td className="px-3 py-2 font-mono font-semibold text-white">
                  {r.relocationRehandles}
                </td>
                <td className="px-3 py-2 font-mono text-slate-300">
                  {r.truckDelayHours.toFixed(1)}h
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs leading-relaxed text-slate-500">
        Expected-relocation stacking places each arriving box where it
        minimises the number of boxes already there that depart before it
        — each such box will force one relocation of the new arrival when
        it leaves (Kim 1997). Truck delay is the yard&apos;s contribution
        to truck turnaround: every relocation is crane time a truck waits
        for.
      </p>
    </section>
  );
}
