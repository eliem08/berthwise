import type { Berth, BerthPlan, PlanOptions, RobustPoint, RobustResult, Vessel } from "./types";
import { mulberry32 } from "./rng";
import { planOptimized, planToSequences, sequencesToPlan } from "./berth";
import { planEconomics } from "./economics";

/**
 * Robust berth planning under ETA uncertainty (Bertsimas & Sim 2004,
 * "the price of robustness").
 *
 * Uncertainty set: each vessel's realised ETA lies in
 * [max(0, ETA − 6h), ETA + 6h] — a box (interval) uncertainty set with
 * half-width 6h. No distribution is assumed.
 *
 * Robust plan with buffer β: plan against inflated ETAs (ETA + β), so the
 * optimiser builds slack into the schedule. The plan itself is just
 * berth assignments + sequences; it is evaluated by re-sweeping those
 * sequences under realised ETAs.
 *
 * Stress test: sample N scenarios from the uncertainty set (seeded
 * uniform draws). A plan is feasible in a scenario iff no vessel's
 * realised start slips more than `grace` hours past its planned start
 * AND the makespan stays within grace of the planned makespan. The
 * tradeoff curve (β = 0…8h) shows the price of robustness: nominal cost
 * vs feasibility rate.
 */

export const UNCERTAINTY_HALF_WIDTH_HOURS = 6;
export const DEFAULT_GRACE_HOURS = 2;
export const DEFAULT_SAMPLES = 200;
export const ROBUST_BUFFERS = [0, 2, 4, 6, 8];

/** One sampled ETA scenario: realised ETA per vessel. */
function sampleScenario(
  vessels: Vessel[],
  rand: () => number,
  halfWidth: number,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const vessel of vessels) {
    const realised = vessel.etaHours + (rand() * 2 - 1) * halfWidth;
    out.set(vessel.id, Math.max(0, realised));
  }
  return out;
}

/**
 * Re-sweep fixed sequences under realised ETAs. Returns realised starts
 * and makespan. The plan's berth assignment + order are fixed; only the
 * timing moves — exactly what happens when ETAs slip and the port keeps
 * the published berth order.
 */
export function evaluateUnderScenario(
  seqs: Map<string, string[]>,
  vessels: Vessel[],
  realisedEtas: Map<string, number>,
  opts: PlanOptions,
): { starts: Map<string, number>; makespanHours: number } {
  const perturbed = vessels.map((v) => ({
    ...v,
    etaHours: realisedEtas.get(v.id) ?? v.etaHours,
  }));
  const plan = sequencesToPlan(seqs, perturbed, {
    tidesEnabled: opts.tidesEnabled ?? false,
  });
  const starts = new Map(plan.assignments.map((a) => [a.vesselId, a.startHours]));
  return { starts, makespanHours: plan.makespanHours };
}

/** Feasibility of one plan in one scenario: max start slip within grace. */
export function stressTestPlan(
  plan: BerthPlan,
  vessels: Vessel[],
  berths: Berth[],
  opts: PlanOptions,
  samples: number,
  seed: number,
  graceHours: number,
  halfWidth: number,
): { feasibilityRate: number; meanSlipHours: number; worstSlipHours: number } {
  void berths; // sequences + sweep are berth-agnostic once the plan exists
  const seqs = planToSequences(plan);
  const plannedStarts = new Map(plan.assignments.map((a) => [a.vesselId, a.startHours]));
  const rand = mulberry32(seed);

  let feasible = 0;
  let slipSum = 0;
  let worstSlip = 0;
  let counted = 0;

  for (let s = 0; s < samples; s++) {
    const scenario = sampleScenario(vessels, rand, halfWidth);
    const { starts, makespanHours } = evaluateUnderScenario(seqs, vessels, scenario, opts);
    let maxSlip = Number.NEGATIVE_INFINITY;
    for (const [vesselId, realisedStart] of starts) {
      const planned = plannedStarts.get(vesselId) ?? realisedStart;
      maxSlip = Math.max(maxSlip, realisedStart - planned);
    }
    const makespanSlip = makespanHours - plan.makespanHours;
    const scenarioSlip = Math.max(maxSlip, makespanSlip);
    slipSum += Math.max(0, scenarioSlip);
    worstSlip = Math.max(worstSlip, scenarioSlip);
    counted++;
    if (scenarioSlip <= graceHours + 1e-9) feasible++;
  }

  return {
    feasibilityRate: counted === 0 ? 1 : feasible / counted,
    meanSlipHours: counted === 0 ? 0 : slipSum / counted,
    worstSlipHours: worstSlip,
  };
}

/** Plan against ETAs inflated by `bufferHours` (the robust counterpart). */
export function robustPlan(
  vessels: Vessel[],
  berths: Berth[],
  opts: PlanOptions,
  bufferHours: number,
): BerthPlan {
  if (bufferHours === 0) return planOptimized(vessels, berths, opts);
  const buffered = vessels.map((v) => ({ ...v, etaHours: v.etaHours + bufferHours }));
  return planOptimized(buffered, berths, opts);
}

/**
 * Full tradeoff curve: for each buffer, build the robust plan, price it on
 * nominal ETAs (cost of robustness), and stress-test it on sampled
 * scenarios (feasibility rate). The nominal (β = 0) plan is the baseline.
 */
export function robustnessTradeoff(
  vessels: Vessel[],
  berths: Berth[],
  opts: PlanOptions,
  buffers: number[] = ROBUST_BUFFERS,
  samples: number = DEFAULT_SAMPLES,
  seed: number = 7,
  graceHours: number = DEFAULT_GRACE_HOURS,
): RobustResult {
  // Baseline: nominal plan (buffer 0, same solver as the robust plans)
  // priced on nominal ETAs.
  const nominalPlan = robustPlan(vessels, berths, opts, 0);
  const nominalObjective = planEconomics(nominalPlan, vessels, berths, opts.weights).objective;

  const points: RobustPoint[] = [];
  for (const buffer of buffers) {
    const plan = robustPlan(vessels, berths, opts, buffer);
    // Price the robust plan's sequences on NOMINAL ETAs.
    const seqs = planToSequences(plan);
    const nominalPriced = sequencesToPlan(seqs, vessels, {
      tidesEnabled: opts.tidesEnabled ?? false,
    });
    const objective = planEconomics(nominalPriced, vessels, berths, opts.weights).objective;
    const stress = stressTestPlan(plan, vessels, berths, opts, samples, seed, graceHours, UNCERTAINTY_HALF_WIDTH_HOURS);
    points.push({
      bufferHours: buffer,
      nominalObjective: objective,
      costOfRobustnessPct:
        nominalObjective > 0 ? ((objective - nominalObjective) / nominalObjective) * 100 : 0,
      feasibilityRate: stress.feasibilityRate,
      meanSlipHours: stress.meanSlipHours,
      worstSlipHours: stress.worstSlipHours,
    });
  }

  return {
    points,
    samples,
    graceHours,
    uncertaintyHalfWidthHours: UNCERTAINTY_HALF_WIDTH_HOURS,
  };
}
