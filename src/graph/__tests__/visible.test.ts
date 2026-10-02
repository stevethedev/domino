import { describe, expect, it } from "vitest";
import type { RawIssue } from "../../data/jiraTypes";
import { buildGraph } from "../buildGraph";
import { NO_ISSUE_FILTERS, passesIssueFilters, UNASSIGNED, visibleSubgraph, type ViewFilters } from "../visible";
import { BLOCKS, data, issue, link, site } from "./helpers";

const LINKS = { blocks: true, relates: true, duplicates: true, crossSite: true };
const assigned = (i: RawIssue, name: string | null): RawIssue => ({
  ...i,
  fields: { ...i.fields, assignee: name ? { accountId: name, displayName: name } : null },
});

// A-1 (done, Ana) blocks A-2 (open, Bo) blocks A-3 (open, unassigned); A-3 blocks X-9, which isn't loaded (a ghost).
const a1 = assigned(issue("A-1", "done"), "Ana");
const a2 = assigned(issue("A-2", "indeterminate"), "Bo");
const a3 = assigned(issue("A-3"), null);
const x9 = issue("X-9");
link("1", BLOCKS, a1, a2);
link("2", BLOCKS, a2, a3);
link("3", BLOCKS, a3, x9, { out: true, in: false });
const graph = buildGraph({ sites: [site("a")], data: [data("a", [a1, a2, a3])] });
const keys = (f: Partial<ViewFilters["issues"]>): string[] =>
  visibleSubgraph(graph, { ...LINKS, issues: { ...NO_ISSUE_FILTERS, ...f } })
    .nodes.map((n) => n.key)
    .sort();

describe("visibleSubgraph with issue filters", () => {
  it("shows everything with no filters", () => {
    expect(keys({})).toEqual(["A-1", "A-2", "A-3", "X-9"]);
  });

  it("hides a status category, and the links to it", () => {
    const v = visibleSubgraph(graph, { ...LINKS, issues: { ...NO_ISSUE_FILTERS, hiddenCategories: ["done"] } });
    expect(v.nodes.map((n) => n.key).sort()).toEqual(["A-2", "A-3", "X-9"]);
    expect(v.edges.every((e) => !e.source.endsWith("A-1") && !e.target.endsWith("A-1"))).toBe(true);
  });

  it("hides by assignee, with unassigned as its own entry", () => {
    expect(keys({ hiddenAssignees: ["Bo"] })).toEqual(["A-1", "A-3", "X-9"]);
    // Hiding the only issue linked to the ghost drops the ghost too: nothing is left floating.
    expect(keys({ hiddenAssignees: [UNASSIGNED] })).toEqual(["A-1", "A-2"]);
  });

  it("hides by issue type", () => {
    expect(keys({ hiddenTypes: ["Story"] })).toEqual([]);
  });

  it("applies assignee filters only to loaded issues (ghosts have no known assignee)", () => {
    const ghost = graph.nodes.find((n) => n.ghost);
    expect(ghost && passesIssueFilters(ghost, { ...NO_ISSUE_FILTERS, hiddenAssignees: [UNASSIGNED] })).toBe(true);
  });
});
