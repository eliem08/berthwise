# Known limitations registry

A frank list of what is unproven, approximate, or missing — each with the
evidence that would resolve it. New limitations go here, not in commit
messages.

## L1 — Planner is depth-unaware

**What:** Berth assignment checks length and grain certification, but not
maintained depth vs vessel draft. A depth-violating output is *refused*
(validation rejects it), never emitted — but the planner will not propose
the depth-feasible alternative on its own either.

**Resolving evidence:** real berth depth data (`BerthGeometryRecord.depthM`
already exists in the dataset schema) + a depth gate in `berthFeasible` +
brute-force re-verification with depth constraints.

## L2 — Exact-solver ceiling at 8 vessels

**What:** `solveExact` throws above 8 vessels (`EXACT_MAX_VESSELS`). The
branch-and-bound is exponential; this is the price of proof.

**Resolving evidence:** none needed for correctness — the ceiling is
enforced, not silent. For larger instances, quality grading above the
ceiling would need a stronger lower bound or a MILP cross-check (not
implemented).

## L3 — ALNS scales superlinearly

**What:** Measured per-vessel cost grows ~15× from 20→50 vessels for a 2.5×
size increase; 100 vessels takes minutes. The 400 fixed destroy/repair
iterations each re-sweep the plan.

**Resolving evidence:** re-benchmark after any of: iteration count scaled
to instance size, incremental (delta) evaluation, or a wall-clock
time-boxed ALNS variant. Until then ALNS is excluded from interactive
paths at 100+ vessels (enforced by the perf suite's exclusion + this note).

## L4 — Stylised tide model

**What:** `tide.ts` models a semidiurnal tide (12.42 h period, first high
water at t+3 h, ±2 h usable window). This is a stand-in, not a harmonic
tide-table prediction for any real port.

**Resolving evidence:** wire real high-water tables through
`TideRestrictionRecord` (schema exists) into the tide-window gate, then
re-run the tide verification suites against the real tables.

## L5 — Cranes modelled as a shared pool

**What:** `scheduleCranes` schedules against one pool limit
(`CRANE_POOL_LIMIT`); per-crane availability windows are recorded in the
dataset schema but not consumed by any scheduler.

**Resolving evidence:** a crane-constrained scheduler consuming
`CraneAvailabilityRecord` windows + property tests proving per-crane
non-overlap.

## L6 — No real-world validation of any kind

**What:** Every test instance is seeded-PRNG synthetic or hand-built. The
software is proven correct against its own specification; nothing is proven
about the Port of Casablanca or any real terminal.

**Resolving evidence:** a supervised pilot supplying B1–B7 from
`docs/ACCEPTANCE.md`.

## L7 — Handling-time estimates are placeholders

**What:** Without a terminal-provided estimate, `toPlannerInputs` assumes
175 TEU/h (min 2 h). Real terminals differ by crane count, shift patterns,
and cargo mix.

**Resolving evidence:** measured productivity per terminal/berth, recorded
in `VesselCallRecord.handlingHoursEstimate`.

## L8 — Cargo types limited to container and grain

**What:** The planner understands two cargo families. Tankers, RoRo,
passenger, and other traffics are rejected by the dataset schema
(`cargoType` enum) rather than planned badly.

**Resolving evidence:** extend the cargo model deliberately, per new cargo
family, with its berth-compatibility rules and verification.

## L9 — Discrete berths only (no continuous quay)

**What:** Berths are indivisible slots. Real quays allow vessels to moor at
arbitrary positions along a continuous quay wall.

**Resolving evidence:** a continuous-quay model (`quayPositionM` is already
reserved in the schema) + a new verification campaign; the current
discrete model stays as the fallback.

## L10 — ETA uncertainty not calibrated

**What:** The robustness module (`robust.ts`) stress-tests plans against a
synthetic ±hours ETA band (`UNCERTAINTY_HALF_WIDTH_HOURS`), not against
measured ETA forecast-error distributions.

**Resolving evidence:** real ETA error data from an agent feed → calibrate
the band → re-run the robustness tradeoff analysis.
