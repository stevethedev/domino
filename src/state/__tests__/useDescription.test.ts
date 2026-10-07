import { describe, expect, it } from "vitest";
import { remember } from "../useDescription";

describe("remember", () => {
  it("keeps the newest answers, dropping the least recently fetched", () => {
    let m: ReadonlyMap<string, number> = new Map();
    for (const k of ["a", "b", "c"]) m = remember(m, k, 1, 2);
    expect([...m.keys()]).toEqual(["b", "c"]);
    m = remember(m, "b", 2, 2); // fetched again: now the newest
    m = remember(m, "d", 1, 2);
    expect([...m.keys()]).toEqual(["b", "d"]);
    expect(m.get("b")).toBe(2);
  });
});
