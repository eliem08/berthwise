import { describe, it, expect } from "vitest";
import { stackNaive, stackOptimized, countRehandles } from "../yard";
import { YARD_BOXES, YARD_CONFIG } from "../data";
import type { Box } from "../data";

const MAX_HEIGHT = YARD_CONFIG.maxHeight;
const NUM_STACKS = YARD_CONFIG.stackCount;

function flatten(stacks: Box[][]): Box[] {
  return stacks.reduce<Box[]>((acc, stack) => acc.concat(stack), []);
}

function sortedIds(boxes: Box[]): string[] {
  return boxes.map((box) => box.id).sort();
}

describe("countRehandles", () => {
  it("countRehandles on a perfect stack is 0", () => {
    // Index 0 is the bottom of the stack. The bottom box has the highest
    // retrieval rank (retrieved last) and the top box has rank 1 (retrieved
    // first), so nothing ever blocks anything else.
    const stacks: Box[][] = [
      [
        { id: "a", retrievalRank: 3, destination: "Test" },
        { id: "b", retrievalRank: 2, destination: "Test" },
        { id: "c", retrievalRank: 1, destination: "Test" },
      ],
    ];

    expect(countRehandles(stacks)).toBe(0);
  });

  it("countRehandles counts blocking boxes", () => {
    // The bottom box must be retrieved first, but "b" sits on top of it and
    // has to be moved out of the way: exactly one rehandle.
    const stacks: Box[][] = [
      [
        { id: "a", retrievalRank: 1, destination: "Test" },
        { id: "b", retrievalRank: 2, destination: "Test" },
      ],
    ];

    expect(countRehandles(stacks)).toBe(1);
  });
});

describe("stackOptimized", () => {
  it("optimized rehandles <= naive rehandles", () => {
    const naive = stackNaive(YARD_BOXES, 8, 5);
    const optimized = stackOptimized(YARD_BOXES, 8, 5);

    expect(optimized.rehandles).toBeLessThanOrEqual(naive.rehandles);
  });

  it("optimized is deterministic", () => {
    const first = stackOptimized(YARD_BOXES, 8, 5);
    const second = stackOptimized(YARD_BOXES, 8, 5);

    expect(JSON.stringify(first.stacks)).toBe(JSON.stringify(second.stacks));
    expect(first.rehandles).toBe(second.rehandles);
    expect(first.totalBoxes).toBe(second.totalBoxes);
  });

  it("all boxes placed exactly once", () => {
    const result = stackOptimized(YARD_BOXES, NUM_STACKS, MAX_HEIGHT);
    const placed = flatten(result.stacks);

    expect(sortedIds(placed)).toEqual(sortedIds(YARD_BOXES));
    expect(result.totalBoxes).toBe(40);
    expect(placed).toHaveLength(40);

    for (const stack of result.stacks) {
      expect(stack.length).toBeLessThanOrEqual(MAX_HEIGHT);
    }
  });
});

describe("validation", () => {
  it("overflow throws", () => {
    // 40 boxes cannot fit into 3 stacks of height 2 (capacity 6).
    expect(() => stackNaive(YARD_BOXES, 2, 3)).toThrow(/overflow/);
    expect(() => stackOptimized(YARD_BOXES, 2, 3)).toThrow(/overflow/);
  });

  it("invalid dimensions throw", () => {
    expect(() => stackNaive([], 0, 5)).toThrow();
    expect(() => stackOptimized([], 8, 0)).toThrow();
  });
});

describe("YARD_BOXES", () => {
  it("retrieval ranks are a permutation", () => {
    const ranks = YARD_BOXES.map((box) => box.retrievalRank).sort(
      (a, b) => a - b,
    );
    const expected = Array.from({ length: 40 }, (_, i) => i + 1);

    expect(ranks).toEqual(expected);
  });
});