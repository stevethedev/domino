import { describe, expect, it } from "vitest";
import { defined, getOrThrow, isOneOf } from "../guards";

describe("guards", () => {
  it("isOneOf narrows to the listed literals", () => {
    const isAb = isOneOf(["a", "b"] as const);
    expect([isAb("a"), isAb("c"), isAb(1)]).toEqual([true, false, false]);
  });

  it("defined passes values through (including falsy ones) and throws on null/undefined", () => {
    expect(defined(0, "zero")).toBe(0);
    expect(defined("", "empty")).toBe("");
    expect(() => {
      defined(undefined, "the row");
    }).toThrow("Expected the row to be defined");
    expect(() => {
      defined(null, "the row");
    }).toThrow("Expected the row to be defined");
  });

  it("getOrThrow returns present entries and throws on missing keys", () => {
    const m = new Map([["a", 1]]);
    expect(getOrThrow(m, "a")).toBe(1);
    expect(() => {
      getOrThrow(m, "b");
    }).toThrow("map entry b");
  });
});
