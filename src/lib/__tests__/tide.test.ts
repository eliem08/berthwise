import { describe, it, expect } from "vitest";
import {
  generateTideWindows,
  isInTideWindow,
  nextTideWindowStart,
  needsTideWindow,
  TIDE_PERIOD_HOURS,
  TIDE_WINDOW_HALF_WIDTH_HOURS,
} from "../tide";
import { VESSELS } from "../data";

describe("tide windows", () => {
  it("generates semidiurnal windows with the right period and width", () => {
    const windows = generateTideWindows(100);
    expect(windows.length).toBeGreaterThan(5);
    for (const w of windows) {
      expect(w.endHours - w.startHours).toBeCloseTo(TIDE_WINDOW_HALF_WIDTH_HOURS * 2, 9);
    }
    for (let i = 1; i < windows.length; i++) {
      expect(windows[i].startHours - windows[i - 1].startHours).toBeCloseTo(TIDE_PERIOD_HOURS, 9);
    }
  });

  it("isInTideWindow respects half-open bounds", () => {
    const windows = generateTideWindows(100);
    const [first] = windows;
    expect(isInTideWindow(first.startHours, windows)).toBe(true);
    expect(isInTideWindow(first.endHours, windows)).toBe(false);
    expect(isInTideWindow(first.startHours - 0.01, windows)).toBe(false);
  });

  it("nextTideWindowStart keeps times already in a window", () => {
    const windows = generateTideWindows(100);
    expect(nextTideWindowStart(2.0, windows)).toBe(2.0);
    // 5.0 is the end of the first window [1, 5) -> jumps to the next start.
    expect(nextTideWindowStart(5.0, windows)).toBeCloseTo(13.42, 9);
    expect(nextTideWindowStart(6.0, windows)).toBeCloseTo(13.42, 9);
  });

  it("deep-draft classification uses the 12m threshold", () => {
    const deep = VESSELS.find((v) => v.id === "V1");
    const shallow = VESSELS.find((v) => v.id === "V6");
    expect(deep).toBeDefined();
    expect(shallow).toBeDefined();
    expect(needsTideWindow(deep!)).toBe(true);
    expect(needsTideWindow(shallow!)).toBe(false);
  });
});
