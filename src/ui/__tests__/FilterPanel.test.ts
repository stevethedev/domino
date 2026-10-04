import { describe, expect, it } from "vitest";
import type { GraphNode, Priority } from "../../graph/types";
import { byPriority } from "../FilterPanel";

const node = (key: string, priority?: Priority): GraphNode => ({
  uid: `a:${key}`,
  siteId: "a",
  siteLabel: "a",
  key,
  summary: key,
  issueType: "Story",
  statusName: "To Do",
  statusCategory: "todo",
  url: "",
  ghost: false,
  priority,
});

describe("byPriority", () => {
  it("lists priorities in the site's order, then unranked ones by count, then no priority", () => {
    const issues = [
      node("A-1"),
      node("A-2", { name: "Custom" }),
      node("A-3", { name: "Low", rank: 3 }),
      node("A-4", { name: "Odd" }),
      node("A-5", { name: "Odd" }),
      node("A-6", { name: "Highest", rank: 0 }),
    ];
    expect(byPriority(issues)).toEqual([
      ["Highest", 1],
      ["Low", 1],
      ["Odd", 2],
      ["Custom", 1],
      ["", 1],
    ]);
  });

  it("ranks a name shared by sites with different orders by its most severe place", () => {
    const issues = [
      node("A-1", { name: "Major", rank: 4 }),
      node("B-1", { name: "Major", rank: 1 }),
      node("A-2", { name: "High", rank: 2 }),
    ];
    expect(byPriority(issues).map(([name]) => name)).toEqual(["Major", "High"]);
  });
});
