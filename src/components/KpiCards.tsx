import { Anchor, Clock, Gauge, Layers, Ship } from "lucide-react";
import type { Kpis } from "@/lib/types";

type KpiCardsProps = {
  kpis: Kpis;
};

function formatNumber(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return "0";
  const factor = 10 ** digits;
  const rounded = Math.round(value * factor) / factor;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(digits);
}

export default function KpiCards({ kpis }: KpiCardsProps) {
  const placed = Math.max(kpis.vesselCount - kpis.unassignedCount, 0);

  const cards = [
    {
      id: "waiting",
      Icon: Clock,
      label: "Avg waiting time",
      value: `${formatNumber(kpis.avgWaitingHours)} h`,
      sub: "per vessel at anchorage",
    },
    {
      id: "utilization",
      Icon: Gauge,
      label: "Berth utilization",
      value: `${formatNumber(kpis.berthUtilizationPct)}%`,
      sub: "of available berth-hours",
    },
    {
      id: "rehandles",
      Icon: Layers,
      label: "Rehandles",
      value: `${kpis.rehandles} moves`,
      sub: `${formatNumber(kpis.rehandleRatePct)}% of boxes`,
    },
    {
      id: "throughput",
      Icon: Ship,
      label: "Throughput",
      value: `${formatNumber(kpis.throughputPerDay)}/day`,
      sub: "vessels handled",
    },
    {
      id: "vessels",
      Icon: Anchor,
      label: "Vessels planned",
      value: `${placed}/${kpis.vesselCount}`,
      sub:
        kpis.unassignedCount > 0
          ? `${kpis.unassignedCount} unassigned`
          : "all vessels placed",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      {cards.map(({ id, Icon, label, value, sub }) => (
        <div key={id} className="card p-4">
          <div className="flex items-center gap-2">
            <Icon className="h-5 w-5 shrink-0 text-signal-400" aria-hidden="true" />
            <p className="text-xs uppercase tracking-wider text-slate-400">{label}</p>
          </div>
          <p className="mt-3 font-display text-3xl font-bold text-white">{value}</p>
          <p className="mt-1 text-xs text-slate-500">{sub}</p>
        </div>
      ))}
    </div>
  );
}