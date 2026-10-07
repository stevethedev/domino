import { describe, expect, it } from "vitest";
import type { GraphNode } from "../types";
import { newlyUnblocked, unblockedMessage } from "../unblocked";

const node = (uid: string, over: Partial<GraphNode> = {}): GraphNode => ({
  uid,
  siteId: "a",
  siteLabel: "A",
  key: uid,
  summary: `Summary ${uid}`,
  issueType: "Story",
  statusName: "To Do",
  statusCategory: "todo",
  url: "",
  ghost: false,
  ...over,
});

describe("newlyUnblocked", () => {
  const nodes = [node("A"), node("B"), node("C", { statusCategory: "done" }), node("D", { ghost: true }), node("E")];
  const mine = new Set(["A", "B", "C", "D"]);

  it("reports my open issues that were blocked and no longer are", () => {
    const was = new Set(["A", "B", "C", "D", "E"]);
    const now = new Set(["B"]);
    // B is still blocked, C is done, D is a ghost, E isn't mine.
    expect(newlyUnblocked(was, now, nodes, mine).map((n) => n.uid)).toEqual(["A"]);
  });

  it("reports nothing when nothing was blocked before", () => {
    expect(newlyUnblocked(new Set(), new Set(), nodes, mine)).toEqual([]);
  });
});

describe("unblockedMessage", () => {
  it("names a single issue and says what to do", () => {
    expect(unblockedMessage([node("CORE-21")])).toEqual({
      title: "Unblocked: CORE-21",
      body: "Summary CORE-21\nNothing is blocking it any more; you can start it.",
    });
  });

  it("lists several issues, abbreviating long lists", () => {
    expect(unblockedMessage(["A", "B"].map((k) => node(k))).title).toBe("2 of your tickets are unblocked");
    expect(unblockedMessage(["A", "B", "C", "D", "E", "F"].map((k) => node(k))).body).toBe("A, B, C, D and 2 more");
  });
});
