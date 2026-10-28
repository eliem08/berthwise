# Synthetic fixtures — NOT real data

Everything in this directory is **synthetic**: invented values for software
testing. Nothing here came from a terminal operator, a port authority, a
terminal operating system, a shipping agent, or a tide table, and nothing
here may be presented as operational data.

## Files

- `port-call-dataset.json` — one `PortCallDataset` (schema version 1.0.0):
  6 synthetic vessel calls, 4 synthetic berths, 2 crane-availability records,
  2 synthetic tide-restriction days, 1 yard snapshot. Validates against
  `src/datasets/schemas.ts` (`PortCallDatasetSchema`).

## What these fixtures prove

- The dataset schemas parse real-shaped data (field presence, units,
  ISO-UTC timestamps, cross-field invariants like etdUtc > etaUtc).
- `toPlannerInputs` converts a schema-valid dataset into the planner's
  internal representation, surfacing every non-data assumption explicitly.
- The planners produce fully feasible plans from schema-shaped input.

## What they do NOT prove

- Real-world accuracy. Synthetic ETAs, drafts, berth lengths and tide
  records say nothing about how the planner would perform on the Port of
  Casablanca (or any real port).
- That the required data is obtainable in this shape, at this quality, or
  at all.

## The gap: real data needed

| Data | From whom | Why it is missing |
| --- | --- | --- |
| Vessel ETAs, drafts, TEU, handling-time estimates | Terminal operator (TOS) / shipping agents | No operator relationship exists |
| Berth geometry (length, maintained depth, grain certification) | Port authority (harbour master plan) | No authority relationship exists |
| Crane availability windows | Terminal equipment planner | No operator relationship exists |
| Real tide tables / depth thresholds | Harbour master / hydrographic office | No data feed exists |
| Yard snapshots with retrieval order | Terminal TOS export | No TOS access exists |

Until a supervised pilot provides these, every "validation" claim is about
software correctness only. See `docs/ACCEPTANCE.md` for the per-criterion
status and `docs/LIMITATIONS.md` for the known-limitations registry.
