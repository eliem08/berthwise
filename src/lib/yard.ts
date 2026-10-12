import type { Box, YardSolution } from "./types";

/* -------------------------------------------------------------------------- */
/* Validation                                                                  */
/* -------------------------------------------------------------------------- */

function assertYardDimensions(stackCount: number, maxHeight: number): void {
  if (!Number.isFinite(stackCount) || stackCount < 1) {
    throw new Error(
      `invalid yard: stackCount must be >= 1 (received ${String(stackCount)})`,
    );
  }
  if (!Number.isFinite(maxHeight) || maxHeight < 1) {
    throw new Error(
      `invalid yard: maxHeight must be >= 1 (received ${String(maxHeight)})`,
    );
  }
}

function overflowError(box: Box, stackCount: number, maxHeight: number): Error {
  return new Error(
    `yard overflow: cannot place box ${box.id} — ${stackCount} stack(s) x maxHeight ${maxHeight} are full`,
  );
}

/* -------------------------------------------------------------------------- */
/* Rehandle simulation                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Simulates the retrieval of every box in rank order (1 = first out) and counts
 * the unproductive moves: every box sitting above the target at retrieval time
 * has to be lifted aside (one rehandle each) before the target can be picked.
 *
 * Pure: the input yard is deep-copied, never mutated.
 */
export function countRehandles(stacks: Box[][]): number {
  // Deep copy — the simulation mutates the yard, the caller's data must not change.
  const yard: Box[][] = stacks.map((stack) => stack.map((box) => ({ ...box })));

  let total = 0;
  for (const stack of yard) total += stack.length;

  let rehandles = 0;

  for (let rank = 1; rank <= total; rank++) {
    let located = false;

    for (let i = 0; i < yard.length && !located; i++) {
      const stack = yard[i];

      for (let j = 0; j < stack.length; j++) {
        if (stack[j].retrievalRank !== rank) continue;

        // Every box above the target must be moved out of the way first.
        rehandles += stack.length - 1 - j;

        // The blocking boxes are moved aside (they leave the yard) and the
        // target box is retrieved: everything from index j upwards disappears.
        stack.splice(j);

        located = true;
        break;
      }
    }
  }

  return rehandles;
}

/* -------------------------------------------------------------------------- */
/* Solution assembly                                                           */
/* -------------------------------------------------------------------------- */

function buildSolution(
  stacks: Box[][],
  stackCount: number,
  maxHeight: number,
  totalBoxes: number,
): YardSolution {
  return {
    stacks,
    stackCount,
    maxHeight,
    rehandles: countRehandles(stacks),
    totalBoxes,
  };
}

/* -------------------------------------------------------------------------- */
/* Baseline: first-fit in input order                                          */
/* -------------------------------------------------------------------------- */

/**
 * Naive baseline: boxes are placed in the order they are given, each one going
 * into the lowest-indexed stack that still has room.
 */
export function stackNaive(
  boxes: Box[],
  stackCount: number,
  maxHeight: number,
): YardSolution {
  assertYardDimensions(stackCount, maxHeight);

  const stacks: Box[][] = Array.from({ length: stackCount }, () => []);

  for (const box of boxes) {
    let placed = false;

    for (let i = 0; i < stackCount; i++) {
      if (stacks[i].length < maxHeight) {
        stacks[i].push(box);
        placed = true;
        break;
      }
    }

    if (!placed) throw overflowError(box, stackCount, maxHeight);
  }

  return buildSolution(stacks, stackCount, maxHeight, boxes.length);
}

/* -------------------------------------------------------------------------- */
/* Optimized: best-fit by departure time                                       */
/* -------------------------------------------------------------------------- */

/**
 * Best-fit by departure time.
 *
 * Boxes are placed latest-retrieval-first, so a box always ends up on top of
 * boxes that leave the yard after it does — the classic "deepest departure at
 * the bottom" rule. For each box we pick, among the stacks that still have
 * room:
 *
 *   1. the stack whose top box has the smallest retrievalRank strictly greater
 *      than the box's rank (the closest later departure — placing here never
 *      buries anything);
 *   2. otherwise an empty stack;
 *   3. otherwise the stack whose top box has the largest retrievalRank (the
 *      least damaging burial).
 *
 * Ties are always broken by the lowest stack index, so the result is fully
 * deterministic.
 */
export function stackOptimized(
  boxes: Box[],
  stackCount: number,
  maxHeight: number,
): YardSolution {
  assertYardDimensions(stackCount, maxHeight);

  const stacks: Box[][] = Array.from({ length: stackCount }, () => []);

  // Latest retrieval first => earliest retrieval ends up on top.
  // Array.prototype.sort is stable, so equal ranks keep their input order.
  const ordered = boxes
    .slice()
    .sort((a, b) => b.retrievalRank - a.retrievalRank);

  for (const box of ordered) {
    let target = -1;

    // 1. Closest later departure on top (smallest top rank > box rank).
    let bestTopRank = Number.POSITIVE_INFINITY;
    for (let i = 0; i < stackCount; i++) {
      const stack = stacks[i];
      if (stack.length === 0 || stack.length >= maxHeight) continue;

      const topRank = stack[stack.length - 1].retrievalRank;
      if (topRank > box.retrievalRank && topRank < bestTopRank) {
        bestTopRank = topRank;
        target = i;
      }
    }

    // 2. Otherwise, the lowest-indexed empty stack.
    if (target === -1) {
      for (let i = 0; i < stackCount; i++) {
        if (stacks[i].length === 0) {
          target = i;
          break;
        }
      }
    }

    // 3. Otherwise, the stack whose top box departs the latest.
    if (target === -1) {
      let worstTopRank = Number.NEGATIVE_INFINITY;
      for (let i = 0; i < stackCount; i++) {
        const stack = stacks[i];
        if (stack.length >= maxHeight) continue;

        const topRank = stack[stack.length - 1].retrievalRank;
        if (topRank > worstTopRank) {
          worstTopRank = topRank;
          target = i;
        }
      }
    }

    if (target === -1) throw overflowError(box, stackCount, maxHeight);

    stacks[target].push(box);
  }

  return buildSolution(stacks, stackCount, maxHeight, boxes.length);
}

/* -------------------------------------------------------------------------- */
/* Metrics                                                                     */
/* -------------------------------------------------------------------------- */

/** Rehandles as a percentage of the total number of boxes (0 when empty). */
export function rehandleRate(sol: YardSolution): number {
  if (sol.totalBoxes === 0) return 0;
  return (sol.rehandles / sol.totalBoxes) * 100;
}