import { describe, expect, it } from "vitest";
import type { GraphNode } from "../../graph/types";
import { findIssues, findStatus, matchIssues } from "../QuickFind";

const node = (uid: string, summary: string, ghost = false): GraphNode => {
  const [siteId, key] = uid.split(":");
  return { uid, siteId, siteLabel: siteId, key, summary, issueType: "Story", statusName: "To Do", statusCategory: "todo", url: "", ghost };
};

describe("findIssues", () => {
  const nodes = [
    node("a:CORE-11", "Persist cards"),
    node("a:CORE-1", "Checkout v2"),
    node("b:PAY-3", "Token exchange for core"),
    node("a:CORE-12", "Audit", true),
  ];

  it("ranks exact key, then key prefix, then summary matches", () => {
    expect(findIssues(nodes, "core-1").map((n) => n.uid)).toEqual(["a:CORE-1", "a:CORE-11", "a:CORE-12"]);
    expect(
      findIssues(nodes, "core")
        .map((n) => n.uid)
        .at(-1),
    ).toBe("b:PAY-3"); // summary match ranks after key matches
  });

  it("is case-insensitive and empty for a blank query", () => {
    expect(findIssues(nodes, "TOKEN").map((n) => n.uid)).toEqual(["b:PAY-3"]);
    expect(findIssues(nodes, "  ")).toEqual([]);
  });
});

describe("matchIssues", () => {
  it("counts every match, where findIssues lists the first 8", () => {
    const many = Array.from({ length: 10 }, (_, i) => node(`a:CORE-${i + 100}`, "Checkout"));
    expect(matchIssues(many, "checkout")).toHaveLength(10);
    expect(findIssues(many, "checkout")).toHaveLength(8);
  });
});

describe("findStatus", () => {
  it("says nothing for a blank query", () => {
    expect(findStatus("  ", 0, 0)).toBe("");
  });

  it("says when nothing matches, quoting the query", () => {
    expect(findStatus(" pay-9 ", 0, 0)).toBe('No tickets match "pay-9"');
  });

  it("counts the matches, and says when only some are listed", () => {
    expect(findStatus("core", 1, 1)).toBe("1 ticket matches");
    expect(findStatus("core", 3, 3)).toBe("3 tickets match");
    expect(findStatus("core", 12, 8)).toBe("12 tickets match, showing the first 8");
  });
});
