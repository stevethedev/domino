import { describe, expect, it } from "vitest";
import { fitKeyOf, fitsLayout } from "../fitKey";

describe("fitKeyOf", () => {
  const base = fitKeyOf("scope-a", "none");

  it("is the same for the same scope and grouping, whatever the data", () => {
    expect(fitKeyOf("scope-a", "none")).toBe(base);
  });

  it("changes with the scope or the grouping, which rearrange the whole graph", () => {
    for (const key of [fitKeyOf("scope-b", "none"), fitKeyOf(null, "none"), fitKeyOf("scope-a", "epic")]) expect(key).not.toBe(base);
  });

  // Filters, folds and the sort aren't part of it: changing them keeps the user's pan and zoom.
});

describe("fitsLayout", () => {
  const layout = { nothingDrawn: false, keyChanged: false, wasEmpty: false, fitWaiting: false };

  it("fits a new scope or grouping, and cards coming back after filters hid them all", () => {
    expect(fitsLayout({ ...layout, keyChanged: true })).toBe(true);
    expect(fitsLayout({ ...layout, wasEmpty: true })).toBe(true);
  });

  it("keeps the user's view for other layouts, and never fits nothing", () => {
    expect(fitsLayout(layout)).toBe(false);
    expect(fitsLayout({ ...layout, keyChanged: true, nothingDrawn: true })).toBe(false);
  });

  it("fits a layout that lands before the last one's fit has run, in its place", () => {
    expect(fitsLayout({ ...layout, fitWaiting: true })).toBe(true);
  });
});
