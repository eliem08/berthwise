import { describe, it, expect } from "vitest";
import { simulateRelocations, stackByExpectedRelocations, stackingComparison } from "../relocation";
import { countRehandles } from "../yard";
import { YARD_BOXES, YARD_CONFIG } from "../data";
import type { Box } from "../types";

function box(id: string, retrievalRank: number): Box {
  return { id, retrievalRank, destination: "Test" };
}

describe("relocation simulation (RSP)", () => {
  it("counts zero when nothing is ever buried", () => {
    // Bottom -> top: the earliest retrieval sits on top of each stack,
    // so no box ever blocks another.
    const stacks: Box[][] = [[box("B", 2), box("A", 1)], [box("C", 3)]];
    const result = simulateRelocations(stacks, 5);
    expect(result.rehandles).toBe(0);
    expect(result.moves).toEqual([]);
  });

  it("counts re-relocations the blocking count misses", () => {
    // Stacks: [1,6] [2,3] [4,5] (bottom -> top), maxHeight 3.
    // Blocking count: retrieve 1 (1 blocking), retrieve 2 (1 blocking: 6
    // already vanished), retrieve 4 (1 blocking) = 3.
    // Relocation sim: 6 is relocated at retrieve 1, then relocated AGAIN
    // at retrieve 2 (it lands above 3), and 5 is relocated at retrieve 4
    // = 4 moves; box 6 is moved twice.
    const stacks: Box[][] = [
      [box("B1", 1), box("B6", 6)],
      [box("B2", 2), box("B3", 3)],
      [box("B4", 4), box("B5", 5)],
    ];
    const blocking = countRehandles(stacks);
    expect(blocking).toBe(3);
    const relocation = simulateRelocations(stacks, 3);
    expect(relocation.rehandles).toBe(4);
    expect(relocation.boxesRelocatedTwice).toBe(1);
    expect(relocation.maxRelocationsPerBox).toBe(2);
    const sixMoves = relocation.moves.filter((m) => m.boxId === "B6");
    expect(sixMoves).toHaveLength(2);
  });

  it("throws on a completely full yard (no free slot for relocation)", () => {
    const stacks: Box[][] = [
      [box("B1", 1), box("B2", 2)],
      [box("B3", 3), box("B4", 4)],
    ];
    expect(() => simulateRelocations(stacks, 2)).toThrow(/deadlock|completely full/);
  });

  it("never mutates the input yard", () => {
    const stacks: Box[][] = [
      [box("B1", 1), box("B6", 6)],
      [box("B2", 2), box("B3", 3)],
      [box("B4", 4), box("B5", 5)],
    ];
    const snapshot = JSON.stringify(stacks);
    simulateRelocations(stacks, 3);
    expect(JSON.stringify(stacks)).toEqual(snapshot);
  });
});

describe("expected-relocation stacking", () => {
  it("never scores worse than arrival-order stacking on the demo yard", () => {
    const rows = stackingComparison(YARD_BOXES, YARD_CONFIG.stackCount, YARD_CONFIG.maxHeight);
    expect(rows).toHaveLength(3);
    const naive = rows.find((r) => r.method.startsWith("Arrival"))!;
    const expected = rows.find((r) => r.method.startsWith("Expected"))!;
    expect(expected.relocationRehandles).toBeLessThanOrEqual(naive.relocationRehandles);
    // Relocation count is always >= blocking count (re-relocation adds moves).
    for (const row of rows) {
      expect(row.relocationRehandles).toBeGreaterThanOrEqual(row.blockingRehandles);
      expect(row.truckDelayHours).toBeCloseTo((row.relocationRehandles * 3) / 60, 9);
    }
  });

  it("is deterministic and respects stack height", () => {
    const a = stackByExpectedRelocations(YARD_BOXES, 8, 5);
    const b = stackByExpectedRelocations(YARD_BOXES, 8, 5);
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
    for (const stack of a.stacks) {
      expect(stack.length).toBeLessThanOrEqual(5);
    }
    expect(a.totalBoxes).toBe(YARD_BOXES.length);
  });
});
