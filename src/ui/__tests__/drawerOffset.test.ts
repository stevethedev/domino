import { describe, expect, it } from "vitest";
import { visibleCentreShift } from "../drawerOffset";

describe("visibleCentreShift", () => {
  it("is none without a drawer over the pane", () => {
    expect(visibleCentreShift(1000, 1000, 1)).toBe(0);
  });

  it("moves the target by half the covered width, in flow units at that zoom", () => {
    // 360px covered: centre the card 180px left of the pane's centre, i.e. aim 180px right of it.
    expect(visibleCentreShift(1000, 640, 1)).toBe(180);
    expect(visibleCentreShift(1000, 640, 2)).toBe(90);
  });

  it("doesn't shift when too little is left visible to hold a card", () => {
    // A narrow pane fully under the drawer: centre in the pane as usual.
    expect(visibleCentreShift(400, 0, 1, 0, 320)).toBe(0);
    expect(visibleCentreShift(1000, 640, 1, 0, 320)).toBe(180);
  });
});
