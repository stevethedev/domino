import { describe, expect, it } from "vitest";
import type { RawIssue } from "../../data/jiraTypes";
import { buildGraph } from "../buildGraph";
import { collapseEpics, summaryUid } from "../collapse";
import { computeInsights } from "../insights";
import { BLOCKS, data, issue, link, site } from "./helpers";

const A = site("a");

function inEpic(key: string, epic: RawIssue | null, cat: "new" | "indeterminate" | "done" = "new"): RawIssue {
  const i = issue(key, cat);
  if (epic) i.fields.parent = { id: epic.id, key: epic.key, fields: { summary: epic.fields.summary, status: epic.fields.status, issuetype: { name: "Epic", hierarchyLevel: 1 } } };
  return i;
}

/** Epic E1 {a1 (done), a2} blocks epic E2 {b1}; a1 -> a2 inside E1; loose L-1 blocks b1. */
function sample() {
  const [e1, e2] = [issue("E-1"), issue("E-2")];
  e1.fields.issuetype = { name: "Epic", hierarchyLevel: 1 };
  e2.fields.issuetype = { name: "Epic", hierarchyLevel: 1 };
  const [a1, a2, b1, loose] = [inEpic("A-1", e1, "done"), inEpic("A-2", e1), inEpic("B-1", e2), inEpic("L-1", null)];
  link("1", BLOCKS, a1, a2); // inside E1
  link("2", BLOCKS, a1, b1); // E1 -> E2, closed (A-1 done)
  link("3", BLOCKS, a2, b1); // E1 -> E2, open
  link("4", BLOCKS, loose, b1); // loose -> E2
  const g = buildGraph({ sites: [A], data: [data("a", [e1, e2, a1, a2, b1, loose])] });
  return { g, insights: computeInsights(g) };
}

describe("collapseEpics", () => {
  it("replaces each epic and its issues with one summary node, keeping loose issues", () => {
    const { g, insights } = sample();
    const c = collapseEpics(g, insights, new Set());
    expect(c.graph.nodes.map((n) => n.uid).sort()).toEqual(["a:L-1", summaryUid("a:E-1"), summaryUid("a:E-2")].sort());
    const e1 = c.graph.nodes.find((n) => n.uid === summaryUid("a:E-1"))!;
    expect(e1.rollup).toMatchObject({ members: ["a:A-1", "a:A-2"], done: 1, blocked: 0 });
    expect(e1.statusCategory).toBe("inprogress");
    expect(c.shownAs.get("a:A-2")).toBe(summaryUid("a:E-1"));
  });

  it("combines links between epics with total and open counts, and drops links inside an epic", () => {
    const { g, insights } = sample();
    const c = collapseEpics(g, insights, new Set());
    const e1e2 = c.graph.edges.find((e) => e.source === summaryUid("a:E-1") && e.target === summaryUid("a:E-2"))!;
    expect(e1e2.aggregate).toEqual({ links: 2, open: 1 });
    expect(c.graph.edges.find((e) => e.source === "a:L-1")!.aggregate).toEqual({ links: 1, open: 1 });
    expect(c.graph.edges).toHaveLength(2);
  });

  it("shows an expanded epic's issues individually again", () => {
    const { g, insights } = sample();
    const c = collapseEpics(g, insights, new Set(["a:E-1"]));
    expect(c.graph.nodes.map((n) => n.uid)).toEqual(expect.arrayContaining(["a:A-1", "a:A-2", "a:E-1", summaryUid("a:E-2")]));
    expect(c.graph.edges.some((e) => e.id === "a:link:1")).toBe(true); // original edge, untouched
  });

  it("detects cycles between epics", () => {
    const [e1, e2] = [issue("E-1"), issue("E-2")];
    e1.fields.issuetype = { name: "Epic", hierarchyLevel: 1 };
    e2.fields.issuetype = { name: "Epic", hierarchyLevel: 1 };
    const [x, y] = [inEpic("X-1", e1), inEpic("Y-1", e2)];
    link("1", BLOCKS, x, y);
    link("2", BLOCKS, y, x);
    const g = buildGraph({ sites: [A], data: [data("a", [e1, e2, x, y])] });
    expect(collapseEpics(g, computeInsights(g), new Set()).graph.cycles).toHaveLength(1);
  });
});

describe("collapseEpics edge cases", () => {
  it("handles an epic that is only loaded as a ghost (linked but not in scope)", () => {
    const epic = issue("E-1");
    epic.fields.issuetype = { name: "Epic", hierarchyLevel: 1 };
    const child = inEpic("A-1", epic);
    const other = issue("X-1");
    link("1", BLOCKS, other, epic, { out: true, in: false }); // E-1 appears only as a ghost of X-1's link
    const g = buildGraph({ sites: [A], data: [data("a", [child, other])] });
    expect(g.nodes.find((n) => n.uid === "a:E-1")?.ghost).toBe(true);
    const c = collapseEpics(g, computeInsights(g), new Set());
    const summary = c.graph.nodes.find((n) => n.uid === summaryUid("a:E-1"))!;
    expect(summary).toMatchObject({ key: "E-1", ghost: false });
    expect(c.graph.nodes.some((n) => n.uid === "a:E-1")).toBe(false); // the ghost folds into its summary
    expect(c.graph.edges.find((e) => e.source === "a:X-1")!.target).toBe(summaryUid("a:E-1"));
  });

  it("an epic with no loaded children keeps the epic's own status", () => {
    const epic = issue("E-1", "done");
    epic.fields.issuetype = { name: "Epic", hierarchyLevel: 1 };
    const g = buildGraph({ sites: [A], data: [data("a", [epic])] });
    const summary = collapseEpics(g, computeInsights(g), new Set()).graph.nodes[0];
    expect(summary).toMatchObject({ statusCategory: "done", statusName: "Done" });
  });
});
