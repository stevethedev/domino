import { describe, expect, it } from "vitest";
import { isInCycle } from "../cycles";
import type { GraphNode } from "../types";

const card = (uid: string, members?: string[]): Pick<GraphNode, "uid" | "rollup"> => ({
  uid,
  rollup: members && { epicUid: uid, members, done: 0, blocked: 0, aging: 0 },
});

describe("isInCycle", () => {
  it("is true for a card in a drawn cycle", () => {
    expect(isInCycle(card("a"), new Set(["a"]), new Set())).toBe(true);
    expect(isInCycle(card("b"), new Set(["a"]), new Set())).toBe(false);
  });

  it("is true for a folded epic whose tickets are in a cycle, even one folding hides", () => {
    // The cycle runs between two of its own tickets, so the folded graph has none.
    expect(isInCycle(card("summary:E", ["x", "y"]), new Set(), new Set(["x", "y"]))).toBe(true);
    expect(isInCycle(card("summary:E", ["x", "y"]), new Set(), new Set(["z"]))).toBe(false);
  });
});
