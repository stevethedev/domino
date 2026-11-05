import { describe, expect, it } from "vitest";
import { verticalScroll } from "../focusItem";

// A view from y=100 to y=500 whose top 72px sit under the sticky axis.
const view = { viewTop: 100, viewBottom: 500, padTop: 72 };

describe("verticalScroll", () => {
  it("leaves an item that's already in view below the axis", () => {
    expect(verticalScroll({ top: 200, bottom: 230, ...view })).toBe(0);
  });

  it("scrolls up just enough to bring an item out from under the axis", () => {
    expect(verticalScroll({ top: 150, bottom: 180, ...view })).toBe(-22);
    expect(verticalScroll({ top: -40, bottom: -10, ...view })).toBe(-212);
  });

  it("scrolls down just enough to bring an item up from below the view", () => {
    expect(verticalScroll({ top: 490, bottom: 520, ...view })).toBe(20);
  });
});
