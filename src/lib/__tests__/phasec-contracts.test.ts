import { describe, it, expect } from "vitest";
import {
  BERTH_PLAN_CONTRACT_VERSION,
  BerthPlanSchema,
  RECOMMENDATION_CONTRACT_VERSION,
  OptimizationRecommendationSchema,
  RESOURCE_CONTRACT_VERSION,
  ResourceAvailabilitySchema,
  VESSEL_CONTRACT_VERSION,
  VesselScheduleSchema,
} from "../../contracts";

const T0 = "2026-10-18T06:00:00Z";
const T1 = "2026-10-18T16:00:00Z";

function schedule(overrides: Record<string, unknown> = {}) {
  return {
    vesselId: "V1",
    name: "TEST VESSEL",
    loaM: 200,
    beamM: 32,
    draftM: 10,
    etaUtc: T0,
    etdUtc: T1,
    ...overrides,
  };
}

function berthResource(overrides: Record<string, unknown> = {}) {
  return {
    resourceId: "B1",
    resourceType: "berth",
    capacityUnit: "vessels",
    quantity: 1,
    availableFromUtc: T0,
    availableToUtc: "2026-10-20T06:00:00Z",
    berthLengthM: 350,
    maxDraftM: 14,
    ...overrides,
  };
}

describe("phase C: versioned contracts", () => {
  it("pins contract versions", () => {
    expect(VESSEL_CONTRACT_VERSION).toBe("1.0.0");
    expect(BERTH_PLAN_CONTRACT_VERSION).toBe("1.0.0");
    expect(RESOURCE_CONTRACT_VERSION).toBe("1.0.0");
    expect(RECOMMENDATION_CONTRACT_VERSION).toBe("1.0.0");
  });

  it("VesselSchedule accepts a valid schedule and stamps the version", () => {
    const s = VesselScheduleSchema.parse(schedule({ imo: "1234567", cargoType: "grain", teu: 0 }));
    expect(s.contractVersion).toBe("1.0.0");
    expect(s.imo).toBe("1234567");
  });

  it("VesselSchedule rejects etdUtc <= etaUtc (time ordering)", () => {
    expect(() => VesselScheduleSchema.parse(schedule({ etdUtc: T0 }))).toThrow(/after etaUtc/);
    expect(() => VesselScheduleSchema.parse(schedule({ etdUtc: "2026-10-18T05:00:00Z" }))).toThrow(
      /after etaUtc/,
    );
  });

  it("VesselSchedule rejects non-UTC and malformed timestamps", () => {
    expect(() => VesselScheduleSchema.parse(schedule({ etaUtc: "2026-10-18T06:00:00" }))).toThrow(/UTC/);
    expect(() => VesselScheduleSchema.parse(schedule({ etaUtc: "2026-10-18T06:00:00+02:00" }))).toThrow(/UTC/);
    expect(() => VesselScheduleSchema.parse(schedule({ etaUtc: "not-a-date" }))).toThrow(/UTC/);
  });

  it("VesselSchedule rejects bad IMO format and non-positive dimensions", () => {
    expect(() => VesselScheduleSchema.parse(schedule({ imo: "12345" }))).toThrow(/imo/);
    expect(() => VesselScheduleSchema.parse(schedule({ imo: "ABCDEFG" }))).toThrow(/imo/);
    expect(() => VesselScheduleSchema.parse(schedule({ loaM: 0 }))).toThrow(/loaM/);
    expect(() => VesselScheduleSchema.parse(schedule({ loaM: -50 }))).toThrow(/loaM/);
    expect(() => VesselScheduleSchema.parse(schedule({ draftM: 0 }))).toThrow(/draftM/);
    expect(() => VesselScheduleSchema.parse(schedule({ draftM: NaN }))).toThrow(/draftM/);
  });

  it("BerthPlan rejects zero/negative windows and empty crane lists", () => {
    const base = {
      planId: "plan_1",
      version: 1,
      vesselId: "V1",
      berthId: "B1",
      berthStartUtc: T0,
      berthEndUtc: T1,
      assignedCranes: ["pool-crane-01"],
      status: "proposed",
      createdAtUtc: T0,
    };
    expect(BerthPlanSchema.parse(base).contractVersion).toBe("1.0.0");
    expect(() => BerthPlanSchema.parse({ ...base, berthEndUtc: T0 })).toThrow(/after berthStartUtc/);
    expect(() => BerthPlanSchema.parse({ ...base, assignedCranes: [] })).toThrow();
    expect(() => BerthPlanSchema.parse({ ...base, status: "sailing" })).toThrow();
  });

  it("ResourceAvailability rejects inverted windows and berth records without depth/length", () => {
    expect(() =>
      ResourceAvailabilitySchema.parse(
        berthResource({ availableFromUtc: T1, availableToUtc: T0 }),
      ),
    ).toThrow(/after availableFromUtc/);
    // Draft-vs-depth gate needs a declared depth: missing maxDraftM is rejected.
    expect(() => ResourceAvailabilitySchema.parse(berthResource({ maxDraftM: undefined }))).toThrow(
      /maxDraftM/,
    );
    expect(() => ResourceAvailabilitySchema.parse(berthResource({ berthLengthM: undefined }))).toThrow(
      /berthLengthM/,
    );
    // Crane resources do not need berth dimensions.
    const crane = ResourceAvailabilitySchema.parse({
      resourceId: "pool",
      resourceType: "crane",
      capacityUnit: "cranes",
      quantity: 8,
      availableFromUtc: T0,
      availableToUtc: "2026-10-20T06:00:00Z",
    });
    expect(crane.contractVersion).toBe("1.0.0");
  });

  it("OptimizationRecommendation enforces the approval invariant", () => {
    const base = {
      id: "rec_1",
      type: "re-sequence",
      payload: { vesselId: "V1", berthId: "B2" },
      rationale: "Cuts waiting by 3h.",
      createdAtUtc: T0,
      status: "proposed",
    };
    expect(OptimizationRecommendationSchema.parse(base).contractVersion).toBe("1.0.0");
    // Approved without approver/timestamp is rejected.
    expect(() => OptimizationRecommendationSchema.parse({ ...base, status: "approved" })).toThrow(
      /approvedAtUtc/,
    );
    expect(() =>
      OptimizationRecommendationSchema.parse({ ...base, status: "approved", approvedAtUtc: T1 }),
    ).toThrow(/approvedBy/);
    // A complete approval parses.
    const approved = OptimizationRecommendationSchema.parse({
      ...base,
      status: "approved",
      approvedBy: "demo-approver",
      approvedAtUtc: T1,
    });
    expect(approved.status).toBe("approved");
  });
});
