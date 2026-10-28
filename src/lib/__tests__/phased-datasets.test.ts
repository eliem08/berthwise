import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  SCHEMA_VERSION,
  validatePortCallDataset,
  PortCallDatasetSchema,
  VesselCallRecordSchema,
  BerthGeometryRecordSchema,
  CraneAvailabilityRecordSchema,
  TideRestrictionRecordSchema,
  YardSnapshotRecordSchema,
  toPlannerInputs,
} from "../../datasets";
import { planNaive } from "../berth";
import { assertPlanningInputs } from "../validate";
import { assertPlanFullyFeasible } from "./verify-helpers";

const FIXTURE_URL = new URL("../../../fixtures/synthetic/port-call-dataset.json", import.meta.url);
const fixtureJson = JSON.parse(readFileSync(FIXTURE_URL, "utf-8")) as unknown;

/**
 * Phase D.5/D.6 — dataset schemas and synthetic fixtures.
 *
 * The schemas define what a terminal operator / port authority would need
 * to provide. The fixture is SYNTHETIC (see fixtures/synthetic/README.md):
 * these tests prove the software reads the format and plans feasibly from
 * it — software correctness only, never real-world accuracy.
 */
describe("phase D: dataset schemas", () => {
  it("pins the schema version", () => {
    expect(SCHEMA_VERSION).toBe("1.0.0");
  });

  it("the synthetic fixture validates end to end", () => {
    const result = validatePortCallDataset(fixtureJson);
    expect(result.ok, result.ok ? "" : JSON.stringify(result.issues, null, 2)).toBe(true);
    if (!result.ok) return;
    expect(result.dataset.schemaVersion).toBe(SCHEMA_VERSION);
    expect(result.dataset.datasetId).toBe("SYNTHETIC-001");
    expect(result.dataset.vesselCalls).toHaveLength(6);
    expect(result.dataset.berths).toHaveLength(4);
  });

  it("toPlannerInputs converts the fixture and a planner plans feasibly from it", () => {
    const result = validatePortCallDataset(fixtureJson);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { vessels, berths, assumptions } = toPlannerInputs(result.dataset);
    expect(() => assertPlanningInputs(vessels, berths)).not.toThrow();
    // Explicit assumptions are the honest boundary: the conversion must
    // SAY what it guessed (fallback handling rates, unconsumed windows).
    expect(assumptions.length).toBeGreaterThan(0);
    expect(assumptions.join("\n")).toMatch(/fallback/i);

    const plan = planNaive(vessels, berths, { tidesEnabled: true });
    assertPlanFullyFeasible(plan, vessels, berths, { tidesEnabled: true });
  });

  it("rejects vessel calls with impossible geometry or time order", () => {
    const base = {
      schemaVersion: "1.0.0",
      vesselId: "X",
      name: "X",
      loaM: 200,
      beamM: 30,
      draftM: 10,
      etaUtc: "2026-11-02T00:00:00Z",
      cargoType: "container",
    };
    expect(VesselCallRecordSchema.safeParse({ ...base, loaM: -5 }).success).toBe(false);
    expect(
      VesselCallRecordSchema.safeParse({
        ...base,
        etaUtc: "2026-11-03T00:00:00Z",
        etdUtc: "2026-11-02T00:00:00Z",
      }).success,
    ).toBe(false);
    expect(VesselCallRecordSchema.safeParse({ ...base, imo: "123" }).success).toBe(false);
    expect(VesselCallRecordSchema.safeParse({ ...base, cargoType: "tanker" }).success).toBe(false);
    expect(VesselCallRecordSchema.safeParse({ ...base, etaUtc: "2026-11-02 00:00" }).success).toBe(
      false,
    );
  });

  it("rejects berth, crane, tide and yard records that violate their invariants", () => {
    const berth = {
      schemaVersion: "1.0.0",
      berthId: "B",
      name: "B",
      lengthM: 300,
      depthM: 14,
      grainCapable: false,
      craneCount: 2,
    };
    expect(BerthGeometryRecordSchema.safeParse({ ...berth, craneCount: -1 }).success).toBe(false);

    const crane = {
      schemaVersion: "1.0.0",
      craneId: "C",
      availableFromUtc: "2026-11-02T00:00:00Z",
      availableToUtc: "2026-11-02T12:00:00Z",
      status: "available",
    };
    expect(
      CraneAvailabilityRecordSchema.safeParse({
        ...crane,
        availableToUtc: "2026-11-02T00:00:00Z",
      }).success,
    ).toBe(false);

    const tide = {
      schemaVersion: "1.0.0",
      date: "2026-11-02",
      highWaterUtc: ["2026-11-02T03:00:00Z"],
      depthThresholdM: 12,
      source: "test",
    };
    expect(TideRestrictionRecordSchema.safeParse({ ...tide, highWaterUtc: [] }).success).toBe(false);
    expect(TideRestrictionRecordSchema.safeParse({ ...tide, date: "02/11/2026" }).success).toBe(false);

    const yard = {
      schemaVersion: "1.0.0",
      snapshotUtc: "2026-11-02T00:00:00Z",
      maxHeight: 2,
      stacks: [
        { stackId: "S1", boxes: [{ boxId: "a", retrievalRank: 1 }, { boxId: "b", retrievalRank: 2 }] },
        { stackId: "S2", boxes: [{ boxId: "c", retrievalRank: 4 }] },
      ],
    };
    // Ranks must be a permutation of 1..N when provided (3 boxes, ranks 1,2,4).
    expect(YardSnapshotRecordSchema.safeParse(yard).success).toBe(false);
    // Stack above maxHeight is rejected.
    const tooTall = {
      ...yard,
      stacks: [
        {
          stackId: "S1",
          boxes: [
            { boxId: "a", retrievalRank: 1 },
            { boxId: "b", retrievalRank: 2 },
            { boxId: "c", retrievalRank: 3 },
          ],
        },
      ],
    };
    expect(YardSnapshotRecordSchema.safeParse(tooTall).success).toBe(false);
    // Ranks are optional: a snapshot without them is accepted (stacking only).
    const noRanks = {
      schemaVersion: "1.0.0",
      snapshotUtc: "2026-11-02T00:00:00Z",
      maxHeight: 3,
      stacks: [{ stackId: "S1", boxes: [{ boxId: "a" }, { boxId: "b" }] }],
    };
    expect(YardSnapshotRecordSchema.safeParse(noRanks).success).toBe(true);
  });

  it("rejects a dataset with no vessels or no berths", () => {
    const result = validatePortCallDataset(fixtureJson);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      PortCallDatasetSchema.safeParse({ ...result.dataset, vesselCalls: [] }).success,
    ).toBe(false);
    expect(PortCallDatasetSchema.safeParse({ ...result.dataset, berths: [] }).success).toBe(false);
  });

  it("validatePortCallDataset never throws on garbage", () => {
    for (const bad of [null, 42, "x", [], { vesselCalls: "nope" }]) {
      const r = validatePortCallDataset(bad);
      expect(r.ok).toBe(false);
    }
  });
});
