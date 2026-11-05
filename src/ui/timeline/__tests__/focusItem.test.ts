import { describe, expect, it } from "vitest";
import { scrollIntoRange, scrollToShow } from "../focusItem";

// A range from 100 to 500 whose first 72 sit under something sticky (the axis, or the label column).
const range = { viewStart: 100, viewEnd: 500, padStart: 72 };

describe("scrollIntoRange", () => {
  it("leaves an item that's already in view", () => {
    expect(scrollIntoRange({ start: 200, end: 230, ...range })).toBe(0);
  });

  it("scrolls back just enough to bring an item out from under the sticky part", () => {
    expect(scrollIntoRange({ start: 150, end: 180, ...range })).toBe(-22);
    expect(scrollIntoRange({ start: -40, end: -10, ...range })).toBe(-212);
  });

  it("scrolls on just enough to bring an item in from past the end", () => {
    expect(scrollIntoRange({ start: 490, end: 520, ...range })).toBe(20);
  });
});

describe("scrollToShow", () => {
  // A view 400 tall under a 72px axis, 1000 wide right of a 336px label column.
  const view = { top: 100, bottom: 500, padTop: 72, left: 0, right: 1000, padLeft: 336 };

  // The whole row counts up and down (its key and title sit above its bar); its bar, across.
  it("shows the whole row up and down, and its bar across", () => {
    expect(scrollToShow({ top: 150, bottom: 190 }, { left: 1100, right: 1200 }, view)).toEqual({ top: -22, left: 200 });
  });

  it("only scrolls up or down for a lane header, which has no bar", () => {
    expect(scrollToShow({ top: 480, bottom: 510 }, undefined, view)).toEqual({ top: 10, left: 0 });
  });
});
