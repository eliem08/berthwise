# Real-world dataset schemas (Phase D.5)

Versioned zod contracts (`src/datasets/`, `SCHEMA_VERSION = "1.0.0"`) for
the data a terminal operator / port authority would need to provide before
berthwise can be validated against reality.

**Plain fact: no real data exists.** These schemas define the shape of the
ask. The only data that has ever flowed through them is synthetic
(`fixtures/synthetic/`).

## Unit conventions

Every field documents its unit explicitly. Globally:

- lengths, drafts, depths: **metres (m)**
- timestamps: **ISO 8601 UTC** (must end in `Z`)
- durations inside the planner: **hours** (converted by `toPlannerInputs`)
- weights: **tonnes (t)**; money: **USD**

## Schemas

### VesselCallRecord — one vessel's call

| Field | Unit | Required | Notes |
| --- | --- | --- | --- |
| vesselId | — | yes | Stable id, maps 1:1 to planner vessel id |
| imo | — | no | 7-digit IMO format when present |
| name | — | yes | |
| loaM | m | yes | Length overall |
| beamM | m | yes | |
| draftM | m | yes | Loaded draft on arrival — drives tide/depth gates |
| etaUtc | UTC | yes | Scheduled arrival |
| etdUtc | UTC | no | Must be strictly after etaUtc when present |
| cargoType | — | yes | `container` \| `grain` only (see L8) |
| teu | TEU | no | 0 assumed for economics when absent (flagged) |
| origin | — | no | Last port of call |
| handlingHoursEstimate | h | no | Terminal-provided; fallback estimate flagged when absent |

### BerthGeometryRecord — physical berth data

| Field | Unit | Required | Notes |
| --- | --- | --- | --- |
| berthId | — | yes | |
| name | — | yes | |
| lengthM | m | yes | Usable quay length |
| depthM | m | yes | Maintained depth below chart datum (recorded; planner does not yet consume — see L1) |
| grainCapable | bool | yes | Food-grade certification |
| craneCount | count | yes | Ship-to-shore cranes installed |
| quayPositionM | m | no | Reserved for a future continuous-quay model (see L9) |

### CraneAvailabilityRecord — equipment windows

| Field | Unit | Required | Notes |
| --- | --- | --- | --- |
| craneId | — | yes | |
| berthId | — | no | Absent for mobile harbour cranes |
| availableFromUtc / availableToUtc | UTC | yes | Window; end strictly after start |
| status | — | yes | `available` \| `maintenance` \| `assigned-elsewhere` |
| capacityT | t | no | Rated lift |

Recorded for a future crane-constrained scheduler; the current planner uses
a shared pool (see L5).

### TideRestrictionRecord — real tide data

| Field | Unit | Required | Notes |
| --- | --- | --- | --- |
| date | — | yes | `YYYY-MM-DD` |
| highWaterUtc | UTC | yes | Non-empty list of predicted high waters |
| depthThresholdM | m | yes | Vessels drawing ≥ this need a high-water window |
| source | — | yes | e.g. "SHOM tide tables", "port tide gauge" |
| notes | — | no | |

Replaces the stylised `tide.ts` model in a pilot (see L4).

### YardSnapshotRecord — yard state

| Field | Unit | Required | Notes |
| --- | --- | --- | --- |
| snapshotUtc | UTC | yes | |
| stacks[].stackId | — | yes | |
| stacks[].boxes[].boxId | — | yes | Bottom of stack first |
| stacks[].boxes[].retrievalRank | rank | no | 1 = retrieved first; when present must be a permutation of 1..N |
| maxHeight | boxes | yes | Terminal stacking policy |

Retrieval ranks are optional because real terminals rarely know the exact
retrieval order in advance; without them only stacking (not rehandle
counting) is possible.

### PortCallDataset — the whole handover

`schemaVersion`, `datasetId`, `collectedUtc`, `portName`, `providedBy`,
plus `vesselCalls[]` (≥1), `berths[]` (≥1), `cranes[]`, `tideRestrictions[]`,
`yardSnapshots[]`, and free-text `provenanceNotes`. Validated by
`validatePortCallDataset` (never throws on bad data).

## Conversion to planner input

`toPlannerInputs(dataset, horizonStartUtc?)` maps the dataset to the
planner's `(Vessel[], Berth[])` and returns an `assumptions` list — every
conversion choice not present in the source data, in plain language
(fallback handling rates, unconsumed crane/tide windows, …). The planner's
own `assertPlanningInputs` is the last gate: malformed conversions fail
there, never silently.

## Who provides what

| Data | Provider |
| --- | --- |
| Vessel calls (ETA, draft, TEU, handling estimates) | Terminal operator (TOS) / shipping agents |
| Berth geometry | Port authority (harbour master plan) |
| Crane availability | Terminal equipment planner |
| Tide tables / depth thresholds | Harbour master / hydrographic office |
| Yard snapshots | Terminal TOS export |
