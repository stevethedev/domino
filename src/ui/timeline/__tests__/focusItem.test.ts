import { describe, expect, it } from "vitest";
import { scrollIntoRange, scrollToShow } from "../focusItem";

// A range from 100 to 500 whose first 72 sit under something sticky (the axis, or the label column).
const range = { viewStart: 100, viewEnd: 500, padStart: 72, padEnd: 0 };

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

  // The open details drawer covers the view's right side (the timeline's scroll-padding-right).
  it("keeps an item clear of what covers the end too", () => {
    expect(scrollIntoRange({ start: 380, end: 420, ...range, padEnd: 120 })).toBe(40);
  });
});

describe("scrollToShow", () => {
  // A view 400 tall under a 72px axis, 1000 wide right of a 336px label column.
  const view = { top: 100, bottom: 500, padTop: 72, padBottom: 0, left: 0, right: 1000, padLeft: 336, padRight: 0 };

  // The whole row counts up and down (its key and title sit above its bar); its bar, across.
  it("shows the whole row up and down, and its bar across", () => {
    expect(scrollToShow({ top: 150, bottom: 190 }, { left: 1100, right: 1200 }, view)).toEqual({ top: -22, left: 200 });
  });

  it("only scrolls up or down for a lane header, which has no bar", () => {
    expect(scrollToShow({ top: 480, bottom: 510 }, undefined, view)).toEqual({ top: 10, left: 0 });
  });

  it("leaves a bar that's already in view, and brings one out from under the label column", () => {
    expect(scrollToShow({ top: 200, bottom: 240 }, { left: 400, right: 500 }, view).left).toBe(0);
    expect(scrollToShow({ top: 200, bottom: 240 }, { left: 300, right: 360 }, view).left).toBe(-36);
  });

  it("keeps a bar clear of the open details drawer", () => {
    expect(scrollToShow({ top: 200, bottom: 240 }, { left: 700, right: 800 }, { ...view, padRight: 360 }).left).toBe(160);
  });
});
