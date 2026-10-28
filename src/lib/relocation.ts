import type { Box, RelocationResult, StackingMethodRow, YardSolution } from "./types";
import { countRehandles, stackNaive, stackOptimized } from "./yard";
import { assertRankPermutation } from "./validate";

/**
 * The container relocation problem (RSP), a.k.a. blocks relocation problem
 * (BRP; Caserta, Schwarze & Voß 2012).
 *
 * The legacy blocking count in yard.ts (countRehandles) removes blocking
 * boxes from the yard when they are lifted aside — those boxes can never
 * block anything again, so it UNDERCOUNTS real yard work. This module
 * simulates what actually happens: a blocking box is relocated to another
 * stack, stays in the yard, and may have to be moved again later.
 *
 * Relocation policy (deterministic): a blocking box goes to the stack
 * that minimises the number of boxes already there that depart before it
 * (those are the boxes it would block next), then the lowest stack height,
 * then the lowest stack index. Relocations need a free slot somewhere, so
 * the simulation runs with one buffer stack (real terminals keep an empty
 * row for exactly this reason).
 *
 * Expected-relocation stacking: when a box arrives, place it on the stack
 * minimising the number of boxes already there that depart BEFORE it —
 * each such box will force one relocation of the new box when it leaves.
 * This is the online analogue of the relocation policy, in the spirit of
 * Kim (1997)'s expected-rehandle analysis.
 */

/** One free slot somewhere is required: relocations need somewhere to go. */
export const RELOCATION_BUFFER_STACKS = 1;

/** Truck delay charged per relocation move (planning proxy). */
export const MINUTES_PER_REHANDLE = 3;

/**
 * Simulate retrieval in rank order with true relocations. Blocking boxes
 * are moved to other stacks (never deleted) and may be relocated again.
 * `maxHeight` is the uniform stack height limit; a relocation may not push
 * a stack past it. Throws on deadlock (no free slot anywhere).
 */
export function simulateRelocations(stacks: Box[][], maxHeight: number): RelocationResult {
  assertRankPermutation(stacks.flat());
  if (!Number.isFinite(maxHeight) || maxHeight < 1) {
    throw new Error(`invalid yard: maxHeight must be >= 1 (received ${String(maxHeight)})`);
  }
  const yard: Box[][] = stacks.map((stack) => stack.map((box) => ({ ...box })));
  const total = yard.reduce((s, stack) => s + stack.length, 0);
  const moves: RelocationResult["moves"] = [];
  const relocationsPerBox = new Map<string, number>();

  for (let rank = 1; rank <= total; rank++) {
    // Locate the target.
    let targetStack = -1;
    let targetIdx = -1;
    for (let s = 0; s < yard.length; s++) {
      const idx = yard[s].findIndex((b) => b.retrievalRank === rank);
      if (idx >= 0) {
        targetStack = s;
        targetIdx = idx;
        break;
      }
    }
    if (targetStack === -1) continue; // rank absent from input (defensive)

    // Relocate every box above the target, top-down.
    while (yard[targetStack].length - 1 > targetIdx) {
      const blocking = yard[targetStack][yard[targetStack].length - 1];
      yard[targetStack].pop();

      // Choose destination: min boxes departing before it, then min height, then lowest index.
      // Stacks already at maxHeight cannot receive another box.
      let bestStack = -1;
      let bestScore = Infinity;
      let bestHeight = Infinity;
      for (let s = 0; s < yard.length; s++) {
        if (s === targetStack) continue;
        const stack = yard[s];
        if (stack.length >= maxHeight) continue;
        const blockers = stack.filter((b) => b.retrievalRank < blocking.retrievalRank).length;
        if (
          blockers < bestScore ||
          (blockers === bestScore && stack.length < bestHeight)
        ) {
          bestScore = blockers;
          bestHeight = stack.length;
          bestStack = s;
        }
      }
      if (bestStack === -1) {
        throw new Error(
          `relocation deadlock: no destination stack for box ${blocking.id} — the yard is completely full`,
        );
      }
      yard[bestStack].push(blocking);
      moves.push({
        boxId: blocking.id,
        fromStack: targetStack,
        toStack: bestStack,
        servingRank: rank,
      });
      relocationsPerBox.set(blocking.id, (relocationsPerBox.get(blocking.id) ?? 0) + 1);
    }

    // Retrieve the target.
    yard[targetStack].splice(targetIdx, 1);
  }

  let maxRelocationsPerBox = 0;
  let boxesRelocatedTwice = 0;
  for (const count of relocationsPerBox.values()) {
    if (count > maxRelocationsPerBox) maxRelocationsPerBox = count;
    if (count >= 2) boxesRelocatedTwice++;
  }

  return {
    rehandles: moves.length,
    moves,
    maxRelocationsPerBox,
    boxesRelocatedTwice,
  };
}

/**
 * Online stacking by expected relocations: each arriving box goes to the
 * stack minimising the number of boxes already there that depart before
 * it (each such box will force one relocation of the new arrival).
 * Ties: lowest stack height, then lowest index. Fully deterministic.
 */
export function stackByExpectedRelocations(
  boxes: Box[],
  stackCount: number,
  maxHeight: number,
): YardSolution {
  if (!Number.isFinite(stackCount) || stackCount < 1) {
    throw new Error(`invalid yard: stackCount must be >= 1 (received ${String(stackCount)})`);
  }
  if (!Number.isFinite(maxHeight) || maxHeight < 1) {
    throw new Error(`invalid yard: maxHeight must be >= 1 (received ${String(maxHeight)})`);
  }
  assertRankPermutation(boxes);
  const stacks: Box[][] = Array.from({ length: stackCount }, () => []);
  for (const box of boxes) {
    let target = -1;
    let bestScore = Infinity;
    let bestHeight = Infinity;
    for (let i = 0; i < stackCount; i++) {
      const stack = stacks[i];
      if (stack.length >= maxHeight) continue;
      const score = stack.filter((b) => b.retrievalRank < box.retrievalRank).length;
      if (score < bestScore || (score === bestScore && stack.length < bestHeight)) {
        bestScore = score;
        bestHeight = stack.length;
        target = i;
      }
    }
    if (target === -1) {
      throw new Error(
        `yard overflow: cannot place box ${box.id} — ${stackCount} stack(s) x maxHeight ${maxHeight} are full`,
      );
    }
    stacks[target].push(box);
  }
  return {
    stacks,
    stackCount,
    maxHeight,
    rehandles: countRehandles(stacks),
    totalBoxes: boxes.length,
  };
}

/**
 * Compare the three stacking methods on the same boxes, under BOTH
 * counters: the legacy blocking count and the full relocation simulation
 * (run with one buffer stack appended, since relocations need a free slot).
 * Truck delay = relocations × 3 min, the yard's contribution to truck
 * turnaround.
 */
export function stackingComparison(
  boxes: Box[],
  stackCount: number,
  maxHeight: number,
): StackingMethodRow[] {
  const methods: Array<{ method: string; solution: YardSolution }> = [
    { method: "Arrival order (first-fit)", solution: stackNaive(boxes, stackCount, maxHeight) },
    { method: "Best-fit by departure", solution: stackOptimized(boxes, stackCount, maxHeight) },
    {
      method: "Expected relocations",
      solution: stackByExpectedRelocations(boxes, stackCount, maxHeight),
    },
  ];

  return methods.map(({ method, solution }) => {
    const withBuffer: Box[][] = [
      ...solution.stacks.map((stack) => stack.map((b) => ({ ...b }))),
      [],
    ];
    const relocation = simulateRelocations(withBuffer, maxHeight);
    return {
      method,
      blockingRehandles: solution.rehandles,
      relocationRehandles: relocation.rehandles,
      truckDelayHours: (relocation.rehandles * MINUTES_PER_REHANDLE) / 60,
    };
  });
}
