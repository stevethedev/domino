import { describe, expect, it } from "vitest";
import { fitKeyOf } from "../fitKey";

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
