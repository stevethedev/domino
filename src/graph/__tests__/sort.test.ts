import { describe, expect, it } from "vitest";
import type { TimelineEntry } from "../schedule";
import {
  naturalCompare,
  NATURAL_SORT,
  orderText,
  parseSortBy,
  SORT_INFO,
  SORT_KEYS,
  ticketComparator,
  type SortBy,
  type SortContext,
} from "../sort";
import type { GraphNode, Release } from "../types";

const node = (key: string, extra: Partial<GraphNode> = {}): GraphNode => ({
  uid: `a:${key}`,
  siteId: "a",
  siteLabel: "A",
  key,
  summary: key,
  issueType: "Story",
  statusName: "To Do",
  statusCategory: "todo",
  url: "",
  ghost: false,
  ...extra,
});

const entry = (end: string): TimelineEntry =>
  ({
    projected: { start: "2026-10-01", end },
    progress: { state: "planned", forecast: { start: "2026-10-01", end } },
    varianceDays: 0,
  }) as unknown as TimelineEntry;

const ctx = (over: Partial<SortContext> = {}): SortContext => ({
  openBlockers: new Map(),
  downstream: new Map(),
  forecast: new Map(),
  ...over,
});

const order = (sort: SortBy, nodes: GraphNode[], c: SortContext = ctx()): string[] => {
  const compare = ticketComparator(sort, c);
  if (!compare) throw new Error("expected a comparator");
  return [...nodes].sort(compare).map((n) => n.key);
};

describe("ticketComparator", () => {
  it("is null for the natural order, which each view keeps", () => {
    expect(ticketComparator(NATURAL_SORT, ctx())).toBeNull();
  });

  it("sorts by priority rank, then named-but-unranked, then none; reversed keeps the missing last", () => {
    const nodes = [
      node("N-1"),
      node("N-2", { priority: { name: "Low", rank: 3 } }),
      node("N-3", { priority: { name: "Custom" } }),
      node("N-4", { priority: { name: "Highest", rank: 0 } }),
    ];
    expect(order({ key: "priority", reversed: false }, nodes)).toEqual(["N-4", "N-2", "N-3", "N-1"]);
    expect(order({ key: "priority", reversed: true }, nodes)).toEqual(["N-2", "N-4", "N-3", "N-1"]);
  });

  it("orders keys naturally and breaks ties by key", () => {
    const nodes = [node("CORE-10"), node("CORE-9"), node("CORE-100")];
    expect(order({ key: "key", reversed: false }, nodes)).toEqual(["CORE-9", "CORE-10", "CORE-100"]);
    expect(order({ key: "status", reversed: false }, nodes)).toEqual(["CORE-9", "CORE-10", "CORE-100"]);
    expect(naturalCompare("CORE-9", "CORE-10")).toBeLessThan(0);
  });

  it("puts out-of-scope tickets last in either direction", () => {
    const nodes = [node("G-1", { ghost: true, statusCategory: "todo" }), node("A-1", { statusCategory: "done" })];
    expect(order({ key: "status", reversed: false }, nodes)).toEqual(["A-1", "G-1"]);
    expect(order({ key: "status", reversed: true }, nodes)).toEqual(["A-1", "G-1"]);
  });

  it("sorts status, assignee and points in their natural directions", () => {
    const s = [node("S-1", { statusCategory: "done" }), node("S-2", { statusCategory: "inprogress" }), node("S-3")];
    expect(order({ key: "status", reversed: false }, s)).toEqual(["S-3", "S-2", "S-1"]);
    const a = [node("A-1", { assigneeName: "Zoe" }), node("A-2"), node("A-3", { assigneeName: "ann" })];
    expect(order({ key: "assignee", reversed: false }, a)).toEqual(["A-3", "A-1", "A-2"]);
    const p = [node("P-1", { storyPoints: 1 }), node("P-2", { storyPoints: 8 }), node("P-3")];
    expect(order({ key: "points", reversed: false }, p)).toEqual(["P-2", "P-1", "P-3"]);
  });

  it("sorts by due date and forecast finish, soonest first, undated last", () => {
    const d = [node("D-1", { dates: { due: "2026-11-02" } }), node("D-2"), node("D-3", { dates: { due: "2026-10-09" } })];
    expect(order({ key: "due", reversed: false }, d)).toEqual(["D-3", "D-1", "D-2"]);
    expect(order({ key: "due", reversed: true }, d)).toEqual(["D-1", "D-3", "D-2"]);
    const f = [node("F-1"), node("F-2")];
    const forecast = new Map([
      ["a:F-1", entry("2026-12-01")],
      ["a:F-2", entry("2026-10-15")],
    ]);
    expect(order({ key: "finish", reversed: false }, f, ctx({ forecast }))).toEqual(["F-2", "F-1"]);
  });

  it("sorts by impact, most first", () => {
    const nodes = [node("I-1"), node("I-2"), node("I-3")];
    const downstream = new Map([
      ["a:I-2", new Set(["x", "y"])],
      ["a:I-3", new Set(["x"])],
    ]);
    expect(order({ key: "unblocks", reversed: false }, nodes, ctx({ downstream }))).toEqual(["I-2", "I-3", "I-1"]);
    const openBlockers = new Map([["a:I-3", 4]]);
    expect(order({ key: "blockers", reversed: false }, nodes, ctx({ openBlockers }))).toEqual(["I-3", "I-1", "I-2"]);
  });

  it("sorts by the soonest unreleased fix version, undated after dated, none last", () => {
    const rel = (name: string, date?: string, released = false): Release => ({ uid: name, siteId: "a", name, date, released });
    const nodes = [
      node("R-1", { releases: [rel("v3", "2026-12-01"), rel("v2", "2026-11-01")] }),
      node("R-2", { releases: [rel("next")] }),
      node("R-3", { releases: [rel("old", "2026-01-01", true)] }),
      node("R-4", { releases: [rel("v1", "2026-10-20")] }),
    ];
    expect(order({ key: "release", reversed: false }, nodes)).toEqual(["R-4", "R-1", "R-2", "R-3"]);
  });
});

describe("ticketComparator, leaving ties", () => {
  it("returns 0 for equal values (out-of-scope and missing still last), so a view can break ties its own way", () => {
    const compare = ticketComparator({ key: "status", reversed: false }, ctx(), { ties: "leave" });
    if (!compare) throw new Error("expected a comparator");
    expect(compare(node("A-1"), node("A-2"))).toBe(0);
    expect(compare(node("A-1"), node("G-1", { ghost: true }))).toBeLessThan(0);
    expect(compare(node("A-1", { statusCategory: "done" }), node("A-2"))).toBeGreaterThan(0);
  });
});

describe("ticketComparator, reversed", () => {
  const rel = (name: string, date?: string): Release => ({ uid: name, siteId: "a", name, date, released: false });

  it("keeps known-but-unordered values after real ones and before missing ones, in either direction", () => {
    const status = [node("S-1", { statusCategory: "unknown" }), node("S-2", { statusCategory: "done" }), node("S-3")];
    expect(order({ key: "status", reversed: true }, status)).toEqual(["S-2", "S-3", "S-1"]);

    const releases = [
      node("R-1", { releases: [rel("next")] }),
      node("R-2", { releases: [rel("v1", "2026-10-20")] }),
      node("R-3"),
      node("R-4", { releases: [rel("v2", "2026-12-01")] }),
    ];
    expect(order({ key: "release", reversed: true }, releases)).toEqual(["R-4", "R-2", "R-1", "R-3"]);

    const priorities = [
      node("P-1", { priority: { name: "Custom" } }),
      node("P-2", { priority: { name: "Low", rank: 3 } }),
      node("P-3"),
      node("P-4", { priority: { name: "Highest", rank: 0 } }),
    ];
    expect(order({ key: "priority", reversed: true }, priorities)).toEqual(["P-2", "P-4", "P-1", "P-3"]);
  });
});

describe("parseSortBy and orderText", () => {
  it("accepts stored sorts and falls back to the natural order", () => {
    expect(parseSortBy({ key: "priority", reversed: true })).toEqual({ key: "priority", reversed: true });
    expect(parseSortBy({ key: "due" })).toEqual({ key: "due", reversed: false });
    for (const bad of [null, "priority", { key: "type" }, { reversed: true }]) expect(parseSortBy(bad)).toEqual(NATURAL_SORT);
  });

  it("describes each key's order in words, both ways", () => {
    expect(orderText({ key: "priority", reversed: false })).toBe("Most severe first");
    expect(orderText({ key: "priority", reversed: true })).toBe("Least severe first");
    expect(orderText(NATURAL_SORT)).toBe("");
    for (const key of SORT_KEYS) if (key !== "natural") expect(SORT_INFO[key].order[0]).not.toBe(SORT_INFO[key].order[1]);
  });
});
