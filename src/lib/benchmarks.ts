import type { BenchmarkInstance, Berth, Vessel } from "./types";
import { mulberry32 } from "./rng";

/**
 * Cordeau-style benchmark instances.
 *
 * Provenance — read this before citing numbers from this file:
 * Cordeau, Laporte, Legato & Moccia (2005) generated two instance sets
 * from traffic data of the port of Gioia Tauro (I2: 25 ships with 5/7/10
 * berths and 35 ships with 7/10 berths; I3: 60 ships with 13 berths) and
 * reported tabu-search results against CPLEX optima. The original instance
 * files are hosted on a Google Site that requires sign-in, and
 * per-instance published optimal values could not be retrieved from any
 * openly accessible source at build time. We therefore do NOT claim these
 * three instances reproduce Cordeau's files or values.
 *
 * What these ARE: instances generated with the same documented structure —
 * discrete berths, dynamic (nonzero) arrival times, handling times that
 * vary per vessel, mixed vessel sizes — at three scales, two of them
 * small enough for our exact solver to prove the optimum. Ground truth
 * for every instance below is the exact branch-and-bound solver in
 * exact.ts, not a published table. If you hold the original Cordeau files,
 * the same solver + heuristics run unchanged on them: drop them in as
 * BenchmarkInstance objects.
 */

function makeBerths(count: number, grainBerths: number): Berth[] {
  const out: Berth[] = [];
  for (let i = 0; i < count; i++) {
    out.push({
      id: `CB-B${i + 1}`,
      name: `Benchmark berth ${i + 1}`,
      lengthM: i < grainBerths ? 300 : 350,
      grainCapable: i < grainBerths,
      cranes: 3,
    });
  }
  return out;
}

function makeVessels(
  count: number,
  seed: number,
  horizonHours: number,
  grainShare: number,
): Vessel[] {
  const rand = mulberry32(seed);
  const vessels: Vessel[] = [];
  for (let i = 0; i < count; i++) {
    const grain = rand() < grainShare;
    const lengthM = grain
      ? 170 + Math.floor(rand() * 70)
      : 200 + Math.floor(rand() * 140);
    vessels.push({
      id: `CB-V${i + 1}`,
      name: `Benchmark vessel ${i + 1}`,
      line: "Benchmark",
      etaHours: Math.round(rand() * horizonHours * 10) / 10,
      lengthM,
      draftM: grain ? 9 + rand() * 2 : 10 + rand() * 4,
      cargo: grain ? "grain" : "container",
      handlingHours: 8 + Math.floor(rand() * 25),
      teu: grain ? 0 : 800 + Math.floor(rand() * 3600),
      origin: "Gioia Tauro (style)",
    });
  }
  return vessels;
}

const CB1_BERTHS = makeBerths(2, 1);
const CB2_BERTHS = makeBerths(3, 1);
const CB3_BERTHS = makeBerths(5, 2);

export const BENCHMARK_INSTANCES: BenchmarkInstance[] = [
  {
    id: "CB-1",
    name: "CB-1 · Small (6 vessels, 2 berths)",
    description:
      "Small enough for the exact solver to prove optimality. Use it to grade all five heuristics.",
    vessels: makeVessels(6, 101, 48, 0.33),
    berths: CB1_BERTHS,
    groundTruth: "Exact branch-and-bound (proven optimal).",
  },
  {
    id: "CB-2",
    name: "CB-2 · Medium (12 vessels, 3 berths)",
    description:
      "Exact solving is not attempted (beyond the 8-vessel exact limit); the best heuristic objective is the reference.",
    vessels: makeVessels(12, 202, 96, 0.33),
    berths: CB2_BERTHS,
    groundTruth: "Best heuristic objective (exact solver not run — 12 vessels).",
  },
  {
    id: "CB-3",
    name: "CB-3 · Large, I2-scale (25 vessels, 5 berths)",
    description:
      "Matches the Cordeau I2 size class (25 ships, 5 berths). Heuristics only — this is where metaheuristics earn their keep.",
    vessels: makeVessels(25, 303, 168, 0.3),
    berths: CB3_BERTHS,
    groundTruth: "Best heuristic objective (exact solver not run — 25 vessels).",
  },
];

export function benchmarkById(id: string): BenchmarkInstance | undefined {
  return BENCHMARK_INSTANCES.find((b) => b.id === id);
}
