import type { EtaPrediction, Vessel } from "@/lib/types";
import { Clock } from "lucide-react";

interface EtaTableProps {
  predictions: EtaPrediction[];
  vessels: Vessel[];
}

function cargoPillClass(cargo: Vessel["cargo"]): string {
  return cargo === "container"
    ? "bg-tide-500/15 text-tide-300 border-tide-500/30"
    : "bg-signal-400/15 text-signal-300 border-signal-500/30";
}

function delayPillClass(delayHours: number): string {
  if (delayHours < 2) {
    return "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
  }
  if (delayHours < 8) {
    return "bg-signal-400/15 text-signal-300 border-signal-500/30";
  }
  return "bg-red-500/15 text-red-300 border-red-500/30";
}

function formatHours(hours: number): string {
  return `h+${hours.toFixed(1)}`;
}

export default function EtaTable({ predictions, vessels }: EtaTableProps) {
  const vesselById = new Map<string, Vessel>(vessels.map((v) => [v.id, v]));

  return (
    <section className="card p-0 overflow-hidden">
      <div className="flex items-start gap-3 border-b border-harbor-800 px-4 py-4 sm:px-6">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-harbor-700 bg-harbor-850 text-signal-400">
          <Clock className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 className="font-display text-base font-semibold text-white sm:text-lg">
            Vessel ETA predictions
          </h2>
          <p className="mt-0.5 text-xs text-slate-400 sm:text-sm">
            Congestion-delay model: predicted = scheduled + max(0, congestion × 16h +
            deterministic per-vessel jitter). Predicted ETAs feed the berth planner.
          </p>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-harbor-700 text-xs uppercase tracking-wider text-slate-500">
              <th scope="col" className="px-4 py-3 font-medium sm:px-6">
                Vessel
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Origin
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Cargo
              </th>
              <th scope="col" className="px-4 py-3 text-right font-medium">
                Scheduled
              </th>
              <th scope="col" className="px-4 py-3 text-right font-medium">
                Predicted
              </th>
              <th scope="col" className="px-4 py-3 text-right font-medium sm:pr-6">
                Delay
              </th>
            </tr>
          </thead>
          <tbody>
            {predictions.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-500 sm:px-6">
                  No ETA predictions available.
                </td>
              </tr>
            ) : (
              predictions.map((prediction) => {
                const vessel = vesselById.get(prediction.vesselId);
                const name = vessel?.name ?? prediction.vesselId;
                const line = vessel?.line ?? "Unknown line";
                const origin = vessel?.origin ?? "—";
                const cargo = vessel?.cargo;

                return (
                  <tr
                    key={prediction.vesselId}
                    className="border-b border-harbor-800 transition-colors last:border-0 hover:bg-harbor-850"
                  >
                    <td className="px-4 py-3 sm:px-6">
                      <div className="font-semibold text-white">{name}</div>
                      <div className="text-xs text-slate-500">{line}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-300">{origin}</td>
                    <td className="px-4 py-3">
                      {cargo ? (
                        <span
                          className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize ${cargoPillClass(
                            cargo,
                          )}`}
                        >
                          {cargo}
                        </span>
                      ) : (
                        <span className="text-slate-500">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-slate-400">
                      {formatHours(prediction.scheduledHours)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-medium text-white">
                      {formatHours(prediction.predictedHours)}
                    </td>
                    <td className="px-4 py-3 text-right sm:pr-6">
                      <span
                        className={`inline-flex items-center rounded-full border px-2.5 py-0.5 font-mono text-xs font-medium ${delayPillClass(
                          prediction.delayHours,
                        )}`}
                      >
                        +{prediction.delayHours.toFixed(1)}h
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}