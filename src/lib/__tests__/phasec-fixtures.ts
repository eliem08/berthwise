import { randomUUID } from "node:crypto";
import { InMemoryIdempotencyStore } from "../idempotency";
import { AuditLog } from "../audit";
import type { GeneratePlanResponse, PlanServiceDeps } from "../plan-service";

/** Shared fixtures for the Phase C test suites (not a test file itself). */

export const H0 = "2026-10-18T06:00:00Z";

export function isoPlusHours(h: number): string {
  return new Date(Date.parse(H0) + h * 3_600_000).toISOString();
}

export function scheduleVessel(
  id: string,
  etaH: number,
  durationH: number,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    vesselId: id,
    name: `VESSEL ${id}`,
    loaM: 200,
    beamM: 32,
    draftM: 10,
    etaUtc: isoPlusHours(etaH),
    etdUtc: isoPlusHours(etaH + durationH),
    cargoType: "container",
    teu: 2400,
    ...overrides,
  };
}

export function berthResource(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    resourceId: id,
    resourceType: "berth",
    capacityUnit: "vessels",
    quantity: 1,
    availableFromUtc: H0,
    availableToUtc: isoPlusHours(96),
    berthLengthM: 350,
    maxDraftM: 14,
    grainCapable: false,
    cranes: 3,
    ...overrides,
  };
}

export function craneResource(quantity: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    resourceId: "crane-pool",
    resourceType: "crane",
    capacityUnit: "cranes",
    quantity,
    availableFromUtc: H0,
    availableToUtc: isoPlusHours(96),
    ...overrides,
  };
}

/** A small feasible scenario: 2 vessels, 2 berths, 8 cranes declared. */
export function baseRequest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    idempotencyKey: `key_${randomUUID()}`,
    horizonStartUtc: H0,
    tidesEnabled: false,
    schedules: [
      scheduleVessel("V1", 0, 10),
      scheduleVessel("V2", 2, 8, { teu: undefined, draftM: 9, loaM: 180 }),
    ],
    resources: [berthResource("B1"), berthResource("B2"), craneResource(8)],
    ...overrides,
  };
}

/** Isolated service deps per test (no shared module state). */
export function freshDeps(): PlanServiceDeps & {
  idempotency: InMemoryIdempotencyStore<GeneratePlanResponse>;
  audit: AuditLog;
} {
  return {
    idempotency: new InMemoryIdempotencyStore<GeneratePlanResponse>(),
    audit: new AuditLog(),
  };
}
