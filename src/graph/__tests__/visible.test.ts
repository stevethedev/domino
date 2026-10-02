import { describe, expect, it } from "vitest";
import type { RawIssue } from "../../data/jiraTypes";
import { buildGraph } from "../buildGraph";
import { NO_ISSUE_FILTERS, passesIssueFilters, UNASSIGNED, visibleSubgraph, type ViewFilters } from "../visible";
import { BLOCKS, data, issue, link, site } from "./helpers";

const LINKS = { blocks: true, relates: true, duplicates: true, crossSite: true, hideImplied: false };
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

describe("implied links (transitive reduction of drawn blocking links)", () => {
  // A→B→C plus the implied shortcut A→C; C→D plus the implied A→D (through B and C).
  const [a, b, c, d] = ["A-1", "A-2", "A-3", "A-4"].map((k) => issue(k));
  link("1", BLOCKS, a, b);
  link("2", BLOCKS, b, c);
  link("3", BLOCKS, a, c);
  link("4", BLOCKS, c, d);
  link("5", BLOCKS, a, d);
  const g = buildGraph({ sites: [site("a")], data: [data("a", [a, b, c, d])] });
  const pairs = (f: Partial<ViewFilters>): string[] =>
    visibleSubgraph(g, { ...LINKS, issues: NO_ISSUE_FILTERS, ...f })
      .edges.map((e) => `${e.source.slice(2)}>${e.target.slice(2)}`)
      .sort();

  it("keeps every link when not simplifying", () => {
    expect(pairs({})).toEqual(["A-1>A-2", "A-1>A-3", "A-1>A-4", "A-2>A-3", "A-3>A-4"]);
  });

  it("drops links a longer drawn chain implies, and counts them", () => {
    expect(pairs({ hideImplied: true })).toEqual(["A-1>A-2", "A-2>A-3", "A-3>A-4"]);
    expect(visibleSubgraph(g, { ...LINKS, issues: NO_ISSUE_FILTERS, hideImplied: true }).implied).toBe(2);
  });

  it("keeps the shortcut when the issue in between is hidden", () => {
    // Hiding A-2 breaks A→A-2→A-3, so A→A-3 is no longer implied (and A→A-4 is now implied via A-3).
    const hideB = { hiddenCategories: [], hiddenTypes: [], hiddenAssignees: [] as string[] };
    const v = visibleSubgraph(
      buildGraph({
        sites: [site("a")],
        data: [
          data(
            "a",
            [a, b, c, d].map((i) => (i.key === "A-2" ? { ...i, fields: { ...i.fields, assignee: { displayName: "Hidden" } } } : i)),
          ),
        ],
      }),
      { ...LINKS, issues: { ...hideB, hiddenAssignees: ["Hidden"] }, hideImplied: true },
    );
    expect(v.edges.map((e) => `${e.source.slice(2)}>${e.target.slice(2)}`).sort()).toEqual(["A-1>A-3", "A-3>A-4"]);
  });

  it("never drops links in a blocking cycle", () => {
    // X→Y→Z→X is a cycle; X→Z is also implied by X→Y→Z, but it's part of the cycle, so it stays.
    const [x, y, z] = ["X-1", "X-2", "X-3"].map((k) => issue(k));
    link("6", BLOCKS, x, y);
    link("7", BLOCKS, y, z);
    link("8", BLOCKS, z, x);
    link("9", BLOCKS, x, z);
    const cyc = buildGraph({ sites: [site("a")], data: [data("a", [x, y, z])] });
    const v = visibleSubgraph(cyc, { ...LINKS, issues: NO_ISSUE_FILTERS, hideImplied: true });
    expect(v.implied).toBe(0);
    expect(v.edges).toHaveLength(cyc.edges.length);
  });
});
