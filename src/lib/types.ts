/** Shared domain types for berthwise. */

export type CargoType = "container" | "grain";

export interface Vessel {
  id: string;
  name: string;
  line: string;
  /** Scheduled arrival, hours from t0. */
  etaHours: number;
  lengthM: number;
  /** Loaded draft in metres — drives the tide-window constraint. */
  draftM: number;
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
  /** Annealing / tabu time budget in ms. */
  timeLimitMs?: number;
  /** Multi-objective weights. Defaults to waiting-only (legacy behaviour). */
  weights?: ObjectiveWeights;
  /** When true, deep-draft vessels may only start inside a tide window. */
  tidesEnabled?: boolean;
}

/** One high-water entry window: [startHours, endHours). */
export interface TideWindow {
  startHours: number;
  endHours: number;
}

/**
 * Multi-objective weights. The UI presents these as 0–100 sliders; they are
 * normalised to sum to 1 before use. All three zero means waiting-only.
 */
export interface ObjectiveWeights {
  waiting: number;
  fuel: number;
  crane: number;
}

/** Per-vessel crane allocation inside a schedule. */
export interface CraneAssignment {
  vesselId: string;
  berthId: string;
  cranes: number;
  craneHours: number;
  startHours: number;
  endHours: number;
}

/** One sample of port-wide crane usage. */
export interface CraneUsagePoint {
  hour: number;
  cranesInUse: number;
}

/** Result of crane scheduling a berth plan against a shared crane pool. */
export interface CraneSchedule {
  assignments: CraneAssignment[];
  /** Highest simultaneous crane usage. */
  peakUsage: number;
  /** Pool size this schedule was built against. */
  poolLimit: number;
  /** Mean crane utilisation over the makespan, in percent. */
  avgUtilizationPct: number;
  totalCraneHours: number;
  /** Hourly midpoint samples of cranes in use. */
  usageSeries: CraneUsagePoint[];
}

/** Cost / fuel roll-up for one plan, used by the weighted objective. */
export interface PlanEconomics {
  /** Total anchorage waiting hours. */
  waitingHours: number;
  /** Fuel burned while waiting at anchor, tonnes (planning proxy). */
  fuelTonnes: number;
  /** Total crane-hours consumed. */
  craneHours: number;
  /** Crane cost in USD (crane-hours × rate). */
  craneCostUsd: number;
  makespanHours: number;
  /** Weighted objective value (lower is better). */
  objective: number;
}

export type AlgorithmId = "greedy" | "annealing" | "tabu";

export interface AlgorithmResult {
  id: AlgorithmId;
  label: string;
  plan: BerthPlan;
  craneSchedule: CraneSchedule;
  economics: PlanEconomics;
}

export interface ComparisonResult {
  results: AlgorithmResult[];
  winner: AlgorithmId;
}

/** Outcome of validating a drag-and-drop move on the Gantt. */
export interface DragValidation {
  valid: boolean;
  /** Human-readable reason when invalid. */
  reason?: string;
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
