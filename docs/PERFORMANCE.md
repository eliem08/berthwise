# BerthWise performance (Phase D.4)

Measured by `src/lib/__tests__/phased-performance.test.ts` on
2026-10-17 — machine: 2× AMD EPYC 9D25 126-Core Processor,
7.7 GB RAM, linux/x64,
Node v24.20.0. Wall-clock, inside vitest; treat numbers as
indicative of scaling behaviour on this machine, not as production
benchmarks. Instances are SYNTHETIC (seeded PRNG); real terminal data will
differ (see `docs/ACCEPTANCE.md`).

## Exact solver at the 8-vessel ceiling

| case | vessels | berths | median wall | notes |
| --- | --- | --- | --- | --- |
| exact 8v/2b tides-off | 8 | 2 | 6 ms | nodes explored (median): 1,349; proven optimal on all 3 seeds |
| exact 8v/3b tides-on | 8 | 3 | 34 ms | nodes explored (median): 8,686; proven optimal on all 2 seeds |
| exact 6v/2b tides-on | 6 | 2 | 1 ms | nodes explored (median): 301; proven optimal on all 2 seeds |

The exact solver is exponential: the node counts above are the honest cost
of proof. Practical rule (from these measurements): keep exact solves at
≤ 8 vessels and treat the solver as the grader of the heuristics, not the
production planner. The 8-vessel ceiling is enforced by the solver
(`EXACT_MAX_VESSELS`); 9+ vessels throw instead of silently degrading.

## Heuristics at scale-up sizes

| case | vessels | berths | median wall | notes |
| --- | --- | --- | --- | --- |
| greedy 20v/5b | 20 | 5 | 0 ms | ≈ 0.0 ms/vessel |
| annealing 20v/5b | 20 | 5 | 813 ms | ≈ 40.7 ms/vessel |
| tabu 20v/5b | 20 | 5 | 6003 ms | ≈ 300.2 ms/vessel |
| ga 20v/5b | 20 | 5 | 48 ms | ≈ 2.4 ms/vessel |
| alns 20v/5b | 20 | 5 | 1243 ms | ≈ 62.2 ms/vessel |
| greedy 50v/8b | 50 | 8 | 0 ms | ≈ 0.0 ms/vessel |
| annealing 50v/8b | 50 | 8 | 1570 ms | ≈ 31.4 ms/vessel |
| tabu 50v/8b | 50 | 8 | 11420 ms | ≈ 228.4 ms/vessel |
| ga 50v/8b | 50 | 8 | 68 ms | ≈ 1.4 ms/vessel |
| alns 50v/8b | 50 | 8 | 36101 ms | ≈ 722.0 ms/vessel |
| greedy 100v/10b | 100 | 10 | 0 ms | ≈ 0.0 ms/vessel |
| annealing 100v/10b | 100 | 10 | 2734 ms | ≈ 27.3 ms/vessel |
| tabu 100v/10b | 100 | 10 | 22083 ms | ≈ 220.8 ms/vessel |
| ga 100v/10b | 100 | 10 | 133 ms | ≈ 1.3 ms/vessel |

Annealing/tabu take an iteration budget derived from `timeLimitMs`
(200 iterations/ms, i.e. 100k iterations at the 500 ms setting used here),
not a wall-clock budget — per-iteration cost grows with instance size, so
their wall time still scales with n. ALNS at 100 vessels is deliberately
excluded from the routine suite: see below.

### Scaling assessment

- **annealing**: 40.7 @20 → 31.4 @50 → 27.3 @100 ms/vessel — roughly linear or better in this range
- **tabu**: 300.2 @20 → 228.4 @50 → 220.8 @100 ms/vessel — roughly linear or better in this range
- **ga**: 2.4 @20 → 1.4 @50 → 1.3 @100 ms/vessel — roughly linear or better in this range
- **greedy**: 0.0 @20 → 0.0 @50 → 0.0 @100 ms/vessel — roughly linear or better in this range
- **alns**: 62.2 @20 → 722.0 @50 ms/vessel — **SUPERLINEAR** — per-vessel cost grows faster than instance size

**ALNS is superlinear and is the scaling risk in this codebase.**
Measured separately (single run, same machine, same instance family):
~2.0 s at 20 vessels, ~28.9 s at 50 vessels, **~535 s (8.9 min) at 100
vessels** — per-vessel cost grows 98 → 578 → 5,345 ms/vessel, i.e. a 273×
slowdown for a 5× size increase. ALNS's 400 fixed destroy/repair iterations
each re-sweep the plan, so its cost grows much faster than n² in practice.
Do not run the current ALNS at 100+ vessels in any interactive path; it is
fine at ≤ 50 vessels. Fixing this (fewer iterations at scale, incremental
evaluation, or a time-boxed variant) is recorded in
`docs/LIMITATIONS.md`.

## What these numbers do and do not prove

- DO prove: the software completes on the tested sizes in the measured
  times; no hidden blowup except the documented ALNS case.
- DO NOT prove: real-world performance (real ETAs, real berth geometry and
  real tide tables will have different structure), or solution quality at
  scale — quality above the 8-vessel ceiling has no exact reference to be
  graded against (see `docs/LIMITATIONS.md`).
