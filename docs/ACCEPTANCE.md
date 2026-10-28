# Acceptance criteria — readiness for a supervised pilot

Each criterion is **MET**, **NOT MET**, or **BLOCKED-ON-REAL-DATA**, with the
evidence that justifies the status. "Supervised pilot" means: a terminal
operator hands over real data for one planning horizon, berthwise produces
a plan, and a human harbour master reviews it before anything is executed.

## Software correctness (can be settled without real data)

| # | Criterion | Status | Evidence |
| --- | --- | --- | --- |
| A1 | Exact solver matches an independent exhaustive enumerator on every vessel count 2–8, tight/loose berths, tides on/off, draft- and grain-heavy mixes | **MET** | `phased-wider-verification.test.ts`: 10 shapes × multiple seeds/weights, all `provenOptimal` and objective-equal to brute force; Phase B's original 16 seeded instances still green |
| A2 | Every planner (greedy, annealing, tabu, GA, ALNS, exact) yields a fully feasible plan on random instances, tides on and off | **MET** | `phased-properties.test.ts`: 25 random instances × 6 planners, independent feasibility checker (no berth overlap, dimensions fit, ETA/draft/tide respected, totals consistent) |
| A3 | Algorithm comparisons are fair: identical instances, objectives and budgets, no input mutation | **MET** | `compareAlgorithms` enforces per-runner input fingerprints + mutation checks and throws on mismatch; `phased-fairness.test.ts` proves mixed-instance comparisons are refused |
| A4 | Crane pool is never exceeded by scheduled plans | **MET** | Independent sweep-line re-verification over `scheduleCranes` output on random instances and verified-optimal plans, including tight pools (2–3 cranes) |
| A5 | Yard relocation replays are semantically valid (moved box on top, destination has room, served boxes retrievable, yard ends empty) | **MET** | `phased-properties.test.ts`: full replay of every relocation move on 40 random yards |
| A6 | Same-seed runs are bit-identical (reproducibility) | **MET** | Reproducibility suite: seeded planners, `compareAlgorithms`, yard and relocation functions |
| A7 | Performance characterised at scale; no hidden superlinear blowup except documented cases | **MET** (with caveat) | `docs/PERFORMANCE.md`: exact at ceiling with node counts; heuristics at 20/50/100 vessels; ALNS superlinearity documented and excluded from interactive paths |
| A8 | Real-world data contract exists: versioned schemas, explicit units, required vs optional, exported validator | **MET** | `src/datasets/` (`SCHEMA_VERSION = "1.0.0"`), `docs/DATASETS.md`, `phased-datasets.test.ts` (accept/reject cases) |
| A9 | Synthetic fixtures validate the data path end to end (schema → conversion → feasible plan) | **MET** | `fixtures/synthetic/port-call-dataset.json` + `phased-datasets.test.ts`; every conversion assumption surfaced explicitly by `toPlannerInputs` |

## Real-world accuracy (cannot be settled without real data)

| # | Criterion | Status | Evidence / blocker |
| --- | --- | --- | --- |
| B1 | Vessel ETAs, drafts, TEU from a real TOS / agent feed | **BLOCKED-ON-REAL-DATA** | No operator relationship; no feed exists. Schema ready (`VesselCallRecord`) |
| B2 | Real berth geometry (length, maintained depth, grain certification) | **BLOCKED-ON-REAL-DATA** | No port-authority relationship. Schema ready (`BerthGeometryRecord`) |
| B3 | Real tide tables wired into the tide-window gate | **BLOCKED-ON-REAL-DATA** | Planner uses a stylised semidiurnal model; real high-water tables not consumed (documented in `toPlannerInputs` assumptions) |
| B4 | Real crane availability windows | **BLOCKED-ON-REAL-DATA** | Planner schedules against a shared pool; per-crane windows recorded but not consumed |
| B5 | Measured handling-time productivity per terminal | **BLOCKED-ON-REAL-DATA** | Fallback rate (175 TEU/h) is a placeholder, flagged in every conversion |
| B6 | ETA uncertainty calibrated to real forecast-error distributions | **BLOCKED-ON-REAL-DATA** | Robustness module exists but runs on a synthetic ±hours band, not measured ETA errors |
| B7 | Plan quality graded against real historical outcomes (e.g. waiting hours actually achieved) | **BLOCKED-ON-REAL-DATA** | No historical dataset exists |

## Known gaps in the software itself (real data will not fix these)

| # | Criterion | Status | Evidence |
| --- | --- | --- | --- |
| C1 | Solution quality graded above the 8-vessel ceiling | **NOT MET** | No exact reference exists past 8 vessels; heuristics are compared to each other only. See `docs/LIMITATIONS.md` |
| C2 | Depth-aware berth assignment (berth depth vs vessel draft) | **NOT MET** | Depth-violating output is refused, not emitted; the planner does not consume berth depth. See `docs/LIMITATIONS.md` |
| C3 | ALNS usable at 100+ vessels | **NOT MET** | Superlinear scaling measured (`docs/PERFORMANCE.md`); excluded from interactive paths until fixed |

## Reading the table

A supervised pilot may proceed when a data provider is found: A1–A9 are
MET, so the software side is ready to be *tested against reality*. B1–B7
are the data the pilot must supply. C1–C3 are engineering work that should
be scheduled alongside or before the pilot, in that priority order.
