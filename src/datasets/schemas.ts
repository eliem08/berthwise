import { z } from "zod";

/**
 * Real-world validation data schemas (Phase D.5).
 *
 * These zod schemas define the data a terminal operator / port authority
 * would need to provide before berthwise can be validated against reality.
 * They are VERSIONED (`SCHEMA_VERSION`) and carry explicit units on every
 * field.
 *
 * Plain statement of fact: NO real operational data exists. Nothing in
 * `fixtures/synthetic/` came from a terminal, a port authority, or a
 * shipping agent. The synthetic fixtures prove that the software reads the
 * format correctly and plans feasibly from it — software correctness only,
 * never real-world accuracy.
 *
 * Unit conventions (explicit on every field):
 * - lengths / drafts / depths: metres (m)
 * - times: ISO 8601 UTC strings (e.g. "2026-10-20T08:00:00Z")
 * - durations inside the planner: hours (converted by `toPlannerInputs`)
 * - weights: tonnes (t); money: USD
 */

/** Version of the real-world dataset schemas. Bump on any breaking change. */
export const SCHEMA_VERSION = "1.0.0";

const schemaVersionField = z.literal(SCHEMA_VERSION).default(SCHEMA_VERSION);

const vesselIdString = z.string().min(1).max(64);
const positiveMetres = (name: string, max: number) =>
  z.number().positive({ message: `${name} must be > 0 metres` }).max(max);

const isoUtcString = z
  .string()
  .datetime({ offset: true })
  .refine((s) => s.endsWith("Z"), { message: "timestamps must be UTC (end with Z)" });

function hoursBetween(aIso: string, bIso: string): number {
  return (Date.parse(bIso) - Date.parse(aIso)) / 3_600_000;
}

/* ------------------------------------------------------------------ */
/* Vessel calls                                                         */
/* ------------------------------------------------------------------ */

/**
 * One vessel's call at the port, as a terminal operator's TOS / the
 * shipping agent would report it.
 */
export const VesselCallRecordSchema = z
  .object({
    schemaVersion: schemaVersionField,
    /** Stable vessel identifier (maps 1:1 to the planner's vessel id). */
    vesselId: vesselIdString,
    /** Optional IMO number; when present it must be the 7-digit IMO format. */
    imo: z
      .string()
      .regex(/^\d{7}$/, { message: "imo must be a 7-digit IMO number" })
      .optional(),
    name: z.string().min(1).max(120),
    /** Length overall, metres. */
    loaM: positiveMetres("loaM", 500),
    /** Beam, metres. */
    beamM: positiveMetres("beamM", 100),
    /** Loaded draft on arrival, metres — drives tide-window and berth-depth gates. */
    draftM: positiveMetres("draftM", 30),
    /** Scheduled arrival, ISO UTC. */
    etaUtc: isoUtcString,
    /** Scheduled departure, ISO UTC; when present must be strictly after etaUtc. */
    etdUtc: isoUtcString.optional(),
    /** Cargo family the planner understands. REQUIRED: the model has no "other". */
    cargoType: z.enum(["container", "grain"]),
    /** TEU on board (container vessels). Optional — see toPlannerInputs assumptions. */
    teu: z.number().int().min(0).optional(),
    /** Last port of call. Optional. */
    origin: z.string().max(120).optional(),
    /**
     * Terminal-provided handling-time estimate, hours. Optional — when
     * absent the planner falls back to a documented estimate (see
     * toPlannerInputs); a pilot MUST measure this per terminal.
     */
    handlingHoursEstimate: z.number().positive().optional(),
  })
  .superRefine((r, ctx) => {
    if (r.etdUtc !== undefined && hoursBetween(r.etaUtc, r.etdUtc) <= 0) {
      ctx.addIssue({
        code: "custom",
        path: ["etdUtc"],
        message: "etdUtc must be strictly after etaUtc",
      });
    }
  });

export type VesselCallRecord = z.infer<typeof VesselCallRecordSchema>;

/* ------------------------------------------------------------------ */
/* Berth geometry                                                       */
/* ------------------------------------------------------------------ */

/**
 * Physical berth data, as the port authority / terminal operator would
 * provide it from the harbour master plan.
 */
export const BerthGeometryRecordSchema = z.object({
  schemaVersion: schemaVersionField,
  berthId: z.string().min(1).max(64),
  name: z.string().min(1).max(120),
  /** Usable quay length, metres. */
  lengthM: positiveMetres("lengthM", 2000),
  /** Maintained depth alongside, metres below chart datum. */
  depthM: positiveMetres("depthM", 30),
  /** Whether grain (food-grade) operations are certified on this berth. */
  grainCapable: z.boolean(),
  /** Number of ship-to-shore cranes physically installed. */
  craneCount: z.number().int().min(0),
  /**
   * Position of the berth start along the quay, metres from an agreed datum
   * point. Optional — reserved for a future continuous-quay model; the
   * current planner treats berths as discrete.
   */
  quayPositionM: z.number().min(0).optional(),
});

export type BerthGeometryRecord = z.infer<typeof BerthGeometryRecordSchema>;

/* ------------------------------------------------------------------ */
/* Crane availability                                                   */
/* ------------------------------------------------------------------ */

/**
 * Crane availability windows, as the terminal's equipment planner would
 * provide them. The current planner models cranes as a single shared pool
 * per planning run; per-crane windows are recorded for a future
 * crane-constrained scheduler.
 */
export const CraneAvailabilityRecordSchema = z
  .object({
    schemaVersion: schemaVersionField,
    craneId: z.string().min(1).max(64),
    /** Home berth; absent for mobile harbour cranes. */
    berthId: z.string().min(1).max(64).optional(),
    /** Window start, ISO UTC. */
    availableFromUtc: isoUtcString,
    /** Window end, ISO UTC; must be strictly after availableFromUtc. */
    availableToUtc: isoUtcString,
    status: z.enum(["available", "maintenance", "assigned-elsewhere"]),
    /** Rated lift, tonnes. Optional. */
    capacityT: z.number().positive().optional(),
  })
  .superRefine((r, ctx) => {
    if (hoursBetween(r.availableFromUtc, r.availableToUtc) <= 0) {
      ctx.addIssue({
        code: "custom",
        path: ["availableToUtc"],
        message: "availableToUtc must be strictly after availableFromUtc",
      });
    }
  });

export type CraneAvailabilityRecord = z.infer<typeof CraneAvailabilityRecordSchema>;

/* ------------------------------------------------------------------ */
/* Tide restrictions                                                    */
/* ------------------------------------------------------------------ */

/**
 * Real tide data for the entry constraint. The planner's built-in
 * semidiurnal model (tide.ts) is a STYLISED stand-in; a supervised pilot
 * must replace it with the harbour's published tide tables, which is what
 * this schema carries.
 */
export const TideRestrictionRecordSchema = z.object({
  schemaVersion: schemaVersionField,
  /** Calendar date the record applies to, YYYY-MM-DD. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: "date must be YYYY-MM-DD" }),
  /**
   * Predicted high-water instants, ISO UTC, non-empty. Deep-draft vessels
   * may only start inside a usable window around these (window half-width
   * is a pilot calibration parameter, not part of this schema).
   */
  highWaterUtc: z.array(isoUtcString).min(1),
  /**
   * Vessels drawing at or above this (metres) need a high-water window to
   * enter. Provided by the harbour master; the planner default is 12.0 m.
   */
  depthThresholdM: positiveMetres("depthThresholdM", 30),
  /** Source of the predictions, e.g. "SHOM tide tables", "port tide gauge". */
  source: z.string().min(1).max(200),
  notes: z.string().max(500).optional(),
});

export type TideRestrictionRecord = z.infer<typeof TideRestrictionRecordSchema>;

/* ------------------------------------------------------------------ */
/* Yard snapshot                                                        */
/* ------------------------------------------------------------------ */

/**
 * A yard state snapshot, as a terminal's TOS would export it. Retrieval
 * ranks are OPTIONAL because real terminals rarely know the exact retrieval
 * order in advance; without them only stacking (not rehandle counting) is
 * possible — the validator accepts both, and the limitation is documented.
 */
export const YardBoxSchema = z.object({
  boxId: z.string().min(1).max(64),
  /** 1 = retrieved first. Optional (see above). */
  retrievalRank: z.number().int().positive().optional(),
});

export const YardSnapshotRecordSchema = z
  .object({
    schemaVersion: schemaVersionField,
    /** When the snapshot was taken, ISO UTC. */
    snapshotUtc: isoUtcString,
    stacks: z
      .array(
        z.object({
          stackId: z.string().min(1).max(64),
          /** Bottom of stack first. */
          boxes: z.array(YardBoxSchema),
        }),
      )
      .min(1),
    /** Maximum allowed stack height (terminal policy), boxes. */
    maxHeight: z.number().int().min(1),
  })
  .superRefine((r, ctx) => {
    for (const stack of r.stacks) {
      if (stack.boxes.length > r.maxHeight) {
        ctx.addIssue({
          code: "custom",
          path: ["stacks"],
          message: `stack ${stack.stackId} holds ${stack.boxes.length} boxes above maxHeight ${r.maxHeight}`,
        });
      }
    }
    const ranks = r.stacks.flatMap((s) =>
      s.boxes.flatMap((b) => (b.retrievalRank === undefined ? [] : [b.retrievalRank])),
    );
    if (ranks.length > 0) {
      const total = r.stacks.reduce((s, st) => s + st.boxes.length, 0);
      const sorted = [...ranks].sort((a, b) => a - b);
      const expected = Array.from({ length: total }, (_, k) => k + 1);
      if (sorted.length !== expected.length || !sorted.every((v, k) => v === expected[k])) {
        ctx.addIssue({
          code: "custom",
          path: ["stacks"],
          message:
            "when retrievalRank is provided it must be a permutation of 1..N over all boxes",
        });
      }
    }
  });

export type YardSnapshotRecord = z.infer<typeof YardSnapshotRecordSchema>;

/* ------------------------------------------------------------------ */
/* Whole dataset                                                        */
/* ------------------------------------------------------------------ */

/**
 * One validation dataset: everything a supervised pilot would need to hand
 * over for a single planning horizon. All arrays may be empty except
 * vesselCalls and berths (a dataset without vessels or berths is rejected).
 */
export const PortCallDatasetSchema = z.object({
  schemaVersion: schemaVersionField,
  datasetId: z.string().min(1).max(64),
  /** When the data was collected/exported, ISO UTC. */
  collectedUtc: isoUtcString,
  /** Which port the data describes. */
  portName: z.string().min(1).max(120),
  /** Who provided the data (organisation name). */
  providedBy: z.string().min(1).max(200),
  vesselCalls: z.array(VesselCallRecordSchema).min(1),
  berths: z.array(BerthGeometryRecordSchema).min(1),
  cranes: z.array(CraneAvailabilityRecordSchema),
  tideRestrictions: z.array(TideRestrictionRecordSchema),
  yardSnapshots: z.array(YardSnapshotRecordSchema),
  /** Free-text provenance: systems the data came from, known gaps. */
  provenanceNotes: z.string().max(2000).optional(),
});

export type PortCallDataset = z.infer<typeof PortCallDatasetSchema>;

/**
 * Validate a whole dataset. Returns the parsed dataset on success, or the
 * zod issues on failure — never throws on bad data.
 */
export function validatePortCallDataset(data: unknown):
  | { ok: true; dataset: PortCallDataset }
  | { ok: false; issues: z.ZodIssue[] } {
  const parsed = PortCallDatasetSchema.safeParse(data);
  if (parsed.success) return { ok: true, dataset: parsed.data };
  return { ok: false, issues: parsed.error.issues };
}
