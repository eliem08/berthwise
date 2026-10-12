import Link from "next/link";
import {
  ArrowRight,
  Github,
  Ship,
  Container,
  Layers,
  Truck,
  Warehouse,
  CalendarClock,
  Radar,
  Gauge,
  Timer,
  Banknote,
  ChevronRight,
} from "lucide-react";

type Tone = "amber" | "sky";

const TONE_CLASS: Record<Tone, string> = {
  amber: "bg-signal-500",
  sky: "bg-tide-500",
};

const BERTH_ROWS: {
  id: string;
  quay: string;
  cargo: string;
  blocks: { left: number; width: number; tone: Tone }[];
}[] = [
  {
    id: "B1",
    quay: "Quay A",
    cargo: "Container",
    blocks: [
      { left: 0, width: 26, tone: "amber" },
      { left: 30, width: 22, tone: "sky" },
      { left: 56, width: 18, tone: "amber" },
    ],
  },
  {
    id: "B2",
    quay: "Quay B",
    cargo: "Container",
    blocks: [
      { left: 8, width: 34, tone: "sky" },
      { left: 46, width: 26, tone: "amber" },
      { left: 76, width: 20, tone: "sky" },
    ],
  },
  {
    id: "B3",
    quay: "Quay C",
    cargo: "Grain",
    blocks: [
      { left: 0, width: 44, tone: "amber" },
      { left: 48, width: 30, tone: "sky" },
      { left: 82, width: 16, tone: "amber" },
    ],
  },
];

const CRISIS_STATS = [
  {
    value: "2,800 → 800",
    unit: "containers / day",
    label: "Throughput collapse",
    note: "Daily box moves fell by more than two thirds at the peak of the crisis.",
  },
  {
    value: "12 h",
    unit: "typical wait",
    label: "Trucks and vessels",
    note: "Anchorage and gate queues stretched past half a day at peak hours.",
  },
  {
    value: "70%",
    unit: "throughput lost",
    label: "Congestion drag",
    note: "Effective capacity lost to waiting, rehandling and idle cranes.",
  },
];

const PROBLEMS = [
  {
    icon: Ship,
    title: "Vessels queue at anchorage",
    body: "No shared schedule, so ships drift for days waiting for a free quay.",
  },
  {
    icon: Container,
    title: "Record grain imports compete with boxes",
    body: "Bulk grain and container traffic fight for the same berths and cranes.",
  },
  {
    icon: Layers,
    title: "Yards bury urgent containers",
    body: "Stacking ignores departure order, so the next box out is often the deepest.",
  },
  {
    icon: Truck,
    title: "No truck appointment system",
    body: "Gates open first-come, first-served; queues spill onto the port road.",
  },
  {
    icon: Warehouse,
    title: "Customs & gates bottleneck",
    body: "Paperwork and inspections stall cargo long after the vessel has sailed.",
  },
];

const ENGINES = [
  {
    icon: CalendarClock,
    title: "Berth allocation",
    body: "Simulated annealing assigns every vessel to a berth and time slot, minimizing anchorage waiting. Grain-priority mode for harvest season.",
  },
  {
    icon: Layers,
    title: "Yard stacking",
    body: "Best-fit by departure time: late-leaving boxes at the bottom, so retrievals never dig.",
  },
  {
    icon: Radar,
    title: "ETA prediction",
    body: "AIS-style constant-velocity model plus a congestion delay factor feeds realistic arrival times into the planner.",
  },
  {
    icon: Gauge,
    title: "Command KPIs",
    body: "Waiting time, berth utilization, rehandle rate and throughput — before vs after, on every run.",
  },
];

const ROI = [
  {
    icon: Timer,
    title: "−32% average waiting",
    body: "In the demo scenario, optimized berth plans cut average anchorage waiting from 1.7h to 1.15h per vessel. Every waiting hour burns fuel and demurrage.",
  },
  {
    icon: Layers,
    title: "Zero rehandles",
    body: "Departure-aware stacking eliminates unproductive crane moves in the demo yard (24 → 0 vs arrival-order stacking), freeing crane-hours for real work.",
  },
  {
    icon: Banknote,
    title: "Faster turnaround",
    body: "Higher berth utilization and throughput per day: more vessels served with the same concrete.",
  },
];

const FLOW = [
  { icon: Radar, step: "1", title: "ETA predictor" },
  { icon: CalendarClock, step: "2", title: "Berth optimizer" },
  { icon: Layers, step: "3", title: "Yard optimizer" },
  { icon: Gauge, step: "4", title: "KPI dashboard" },
];

export default function Page() {
  return (
    <main className="min-h-screen bg-harbor-950 font-sans text-slate-200 antialiased">
      {/* ───────────────────────── HERO ───────────────────────── */}
      <section className="relative overflow-hidden bg-harbor-950">
        <div className="pointer-events-none absolute inset-0 bg-grid-faint" aria-hidden="true" />
        <div className="relative mx-auto max-w-7xl px-6 pb-16 pt-20 sm:pt-24 lg:pb-24 lg:pt-28">
          <div className="grid items-center gap-14 lg:grid-cols-2 lg:gap-16">
            {/* Left: copy */}
            <div>
              <span className="section-label inline-flex items-center gap-2 rounded-full border border-harbor-700 bg-harbor-900 px-3 py-1">
                <span className="h-1.5 w-1.5 rounded-full bg-signal-400" aria-hidden="true" />
                PORT OF CASABLANCA · CONGESTION RESPONSE
              </span>

              <h1 className="mt-6 font-display text-5xl font-bold leading-[1.05] tracking-tight text-white sm:text-6xl lg:text-7xl">
                Turn berth chaos into a plan.
              </h1>

              <p className="mt-6 max-w-xl text-lg leading-relaxed text-slate-300/85">
                BerthWise optimizes berth allocation and yard stacking for congested ports — cutting
                vessel waiting time, killing unproductive rehandles, and synchronizing berths,
                cranes and trucks around one plan.
              </p>

              <div className="mt-9 flex flex-wrap items-center gap-3">
                <Link href="/demo" className="btn-primary inline-flex items-center gap-2">
                  Launch the live demo
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
                <a
                  href="https://github.com/eliem08/berthwise"
                  target="_blank"
                  rel="noreferrer noopener"
                  className="btn-ghost inline-flex items-center gap-2"
                >
                  <Github className="h-4 w-4" aria-hidden="true" />
                  View on GitHub
                </a>
              </div>
            </div>

            {/* Right: harbor card visual */}
            <div className="lg:pl-4">
              <div className="card overflow-hidden p-5 sm:p-6">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-2">
                    <CalendarClock className="h-4 w-4 text-signal-400" aria-hidden="true" />
                    <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-slate-400">
                      Berth schedule · live
                    </span>
                  </div>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-tide-500/30 bg-tide-500/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-tide-300">
                    <span className="h-1.5 w-1.5 rounded-full bg-tide-400" aria-hidden="true" />
                    Optimized
                  </span>
                </div>

                <div className="mt-5 space-y-3">
                  {BERTH_ROWS.map((row) => (
                    <div key={row.id} className="flex items-center gap-3">
                      <div className="w-16 shrink-0">
                        <div className="font-mono text-xs font-semibold text-slate-200">
                          {row.id}
                        </div>
                        <div className="truncate font-mono text-[10px] uppercase tracking-wider text-slate-500">
                          {row.quay}
                        </div>
                      </div>
                      <div className="relative h-8 flex-1 overflow-hidden rounded-md border border-harbor-700 bg-harbor-850">
                        {row.blocks.map((block, i) => (
                          <div
                            key={`${row.id}-${i}`}
                            className={`absolute inset-y-1 rounded-sm ${TONE_CLASS[block.tone]}`}
                            style={{ left: `${block.left}%`, width: `${block.width}%` }}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-3 flex items-center gap-3">
                  <div className="w-16 shrink-0" />
                  <div className="flex flex-1 justify-between font-mono text-[10px] text-slate-500">
                    <span>0h</span>
                    <span>6h</span>
                    <span>12h</span>
                    <span>18h</span>
                    <span>24h</span>
                  </div>
                </div>

                <div className="mt-5 flex flex-wrap items-center gap-4 border-t border-harbor-700 pt-4">
                  <span className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-slate-400">
                    <span className="h-2 w-2 rounded-sm bg-signal-500" aria-hidden="true" />
                    Container
                  </span>
                  <span className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-slate-400">
                    <span className="h-2 w-2 rounded-sm bg-tide-500" aria-hidden="true" />
                    Grain
                  </span>
                </div>

                <p className="mt-4 rounded-md border border-harbor-700 bg-harbor-900 px-3 py-2 font-mono text-[11px] leading-relaxed text-signal-300">
                  B3 · Quay C — Grain · ATLANTIC HARVEST · wait 0.0h
                </p>
              </div>
            </div>
          </div>

          {/* Crisis stats */}
          <div className="mt-16 grid gap-4 sm:grid-cols-3 lg:mt-20">
            {CRISIS_STATS.map((stat) => (
              <div key={stat.label} className="card p-5">
                <div className="stat-num font-display text-3xl font-bold text-white sm:text-4xl">
                  {stat.value}
                </div>
                <div className="mt-1 font-mono text-[11px] uppercase tracking-[0.16em] text-signal-400">
                  {stat.unit}
                </div>
                <div className="mt-3 text-sm font-semibold text-slate-200">{stat.label}</div>
                <p className="mt-1 text-sm leading-relaxed text-slate-400">{stat.note}</p>
              </div>
            ))}
          </div>

          <p className="mt-4 font-mono text-[11px] leading-relaxed text-slate-500">
            Publicly reported figures from the 2026 Casablanca port congestion crisis.
          </p>
        </div>
      </section>

      {/* ───────────────────────── PROBLEM ───────────────────────── */}
      <section className="border-t border-harbor-800 bg-harbor-900">
        <div className="mx-auto max-w-7xl px-6 py-20 sm:py-24">
          <span className="section-label">THE PROBLEM</span>
          <h2 className="mt-3 max-w-2xl font-display text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Five disconnected fiefdoms.
          </h2>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-slate-400">
            Each link in the chain optimizes for itself. The vessel waits for the berth, the berth
            waits for the crane, the crane waits for the yard, and the yard waits for the gate.
          </p>

          <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {PROBLEMS.map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.title} className="card p-6">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-signal-500/30 bg-signal-500/10">
                    <Icon className="h-5 w-5 text-signal-400" aria-hidden="true" />
                  </div>
                  <h3 className="mt-4 font-display text-lg font-semibold text-white">
                    {item.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-400">{item.body}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ───────────────────────── ENGINES ───────────────────────── */}
      <section className="border-t border-harbor-800 bg-harbor-950">
        <div className="mx-auto max-w-7xl px-6 py-20 sm:py-24">
          <span className="section-label">THE PLATFORM</span>
          <h2 className="mt-3 max-w-2xl font-display text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Four optimization engines, one plan.
          </h2>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-slate-400">
            Every engine is a pure TypeScript module with a deterministic seed — same input, same
            plan, every time.
          </p>

          <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {ENGINES.map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.title} className="card flex flex-col p-6">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-signal-500/30 bg-signal-500/10">
                    <Icon className="h-5 w-5 text-signal-400" aria-hidden="true" />
                  </div>
                  <h3 className="mt-4 font-display text-lg font-semibold text-white">
                    {item.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-400">{item.body}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ───────────────────────── ROI ───────────────────────── */}
      <section className="border-t border-harbor-800 bg-harbor-900">
        <div className="mx-auto max-w-7xl px-6 py-20 sm:py-24">
          <span className="section-label">THE BUSINESS CASE</span>
          <h2 className="mt-3 max-w-2xl font-display text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Waiting time is money.
          </h2>

          <div className="mt-12 grid gap-4 md:grid-cols-3">
            {ROI.map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.title} className="card p-6">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-tide-500/30 bg-tide-500/10">
                    <Icon className="h-5 w-5 text-tide-300" aria-hidden="true" />
                  </div>
                  <h3 className="mt-4 font-display text-xl font-semibold text-white">
                    {item.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-400">{item.body}</p>
                </div>
              );
            })}
          </div>

          <p className="mt-6 max-w-3xl font-mono text-[11px] leading-relaxed text-slate-500">
            Figures from the built-in demo scenario (10 vessels, 4 berths, 40 boxes). Your
            terminal&apos;s numbers come from your data.
          </p>
        </div>
      </section>

      {/* ───────────────────────── ARCHITECTURE ───────────────────────── */}
      <section className="border-t border-harbor-800 bg-harbor-950">
        <div className="mx-auto max-w-7xl px-6 py-20 sm:py-24">
          <span className="section-label">HOW IT FITS</span>
          <h2 className="mt-3 max-w-2xl font-display text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Plays well with your TOS.
          </h2>

          <div className="mt-12 flex flex-col items-stretch gap-3 md:flex-row md:items-center">
            {FLOW.map((item, index) => {
              const Icon = item.icon;
              return (
                <div key={item.title} className="flex flex-col items-stretch gap-3 md:flex-1 md:flex-row md:items-center">
                  <div className="card flex flex-1 items-center gap-3 p-5">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-signal-500/30 bg-signal-500/10">
                      <Icon className="h-5 w-5 text-signal-400" aria-hidden="true" />
                    </div>
                    <div className="min-w-0">
                      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">
                        Step {item.step}
                      </div>
                      <div className="truncate font-display text-base font-semibold text-white">
                        {item.title}
                      </div>
                    </div>
                  </div>
                  {index < FLOW.length - 1 ? (
                    <ChevronRight
                      className="mx-auto h-5 w-5 shrink-0 rotate-90 text-harbor-600 md:mx-0 md:rotate-0"
                      aria-hidden="true"
                    />
                  ) : null}
                </div>
              );
            })}
          </div>

          <p className="mt-6 max-w-3xl text-sm leading-relaxed text-slate-400">
            Stateless TypeScript optimizers — embed them in any terminal operating system via a
            simple API, or run the dashboard standalone.
          </p>
        </div>
      </section>

      {/* ───────────────────────── CTA BAND ───────────────────────── */}
      <section className="border-t border-harbor-800 bg-harbor-900">
        <div className="mx-auto max-w-7xl px-6 py-20 sm:py-24">
          <div className="card border-signal-500/40 p-8 sm:p-10">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
              <div className="max-w-2xl">
                <h3 className="font-display text-2xl font-bold tracking-tight text-white sm:text-3xl">
                  See it on Casablanca data.
                </h3>
                <p className="mt-3 text-base leading-relaxed text-slate-300/85">
                  Ten vessels, four berths, forty boxes — the full optimization loop in your
                  browser.
                </p>
              </div>
              <div className="shrink-0">
                <Link href="/demo" className="btn-primary inline-flex items-center gap-2">
                  Open the live demo
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ───────────────────────── FOOTER ───────────────────────── */}
      <footer className="border-t border-harbor-800 bg-harbor-950">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-6 py-8 sm:flex-row sm:items-center sm:justify-between">
          <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-slate-500">
            BerthWise · Berth &amp; yard optimization for congested ports
          </span>
          <a
            href="https://github.com/eliem08/berthwise"
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.18em] text-slate-400 transition-colors hover:text-signal-400"
          >
            <Github className="h-3.5 w-3.5" aria-hidden="true" />
            eliem08/berthwise
          </a>
        </div>
      </footer>
    </main>
  );
}