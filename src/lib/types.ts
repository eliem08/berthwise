/** Shared domain types for berthwise. */

export type CargoType = "container" | "grain";

export interface Vessel {
  id: string;
  name: string;
  line: string;
  /** Scheduled arrival, hours from t0. */
  etaHours: number;
  lengthM: number;
  cargo: CargoType;
  /** Time the vessel occupies a berth, in hours. */
  handlingHours: number;
  /** TEU on board (0 for grain bulkers). */
  teu: number;
  origin: string;
}

export interface Berth {
  id: string;
  name: string;
  lengthM: number;
  grainCapable: boolean;
  cranes: number;
}

export interface Assignment {
  vesselId: string;
  berthId: string;
  startHours: number;
  endHours: number;
  /** startHours - etaHours, always >= 0 for feasible plans. */
  waitingHours: number;
}

export interface BerthPlan {
  assignments: Assignment[];
  /** Vessel ids that could not be placed on any berth. */
  unassigned: string[];
  totalWaitingHours: number;
  makespanHours: number;
  /** Busy hours per berth id. */
  berthBusyHours: Record<string, number>;
}

export interface PlanOptions {
  /** When true, grain vessels are sequenced before container vessels. */
  grainPriority?: boolean;
  /** Seed for deterministic optimisation. */
  seed?: number;
  /** Annealing time budget in ms. */
  timeLimitMs?: number;
}

/** A single container box in the yard. */
export interface Box {
  id: string;
  /** 1 = retrieved first. A permutation of 1..N. */
  retrievalRank: number;
  destination: string;
}

export interface YardSolution {
  /** stacks[i][0] is the bottom box of stack i. */
  stacks: Box[][];
  stackCount: number;
  maxHeight: number;
  /** Total blocking boxes encountered during retrieval simulation. */
  rehandles: number;
  totalBoxes: number;
}

export interface EtaPrediction {
  vesselId: string;
  scheduledHours: number;
  predictedHours: number;
  delayHours: number;
  distanceNm: number;
  speedKn: number;
}

export interface Kpis {
  avgWaitingHours: number;
  totalWaitingHours: number;
  /** Mean berth busy-time share of the makespan, in percent. */
  berthUtilizationPct: number;
  rehandles: number;
  /** Rehandles per 100 boxes. */
  rehandleRatePct: number;
  /** Vessels fully handled per 24h of makespan. */
  throughputPerDay: number;
  vesselCount: number;
  unassignedCount: number;
}
