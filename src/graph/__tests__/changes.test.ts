import { describe, expect, it } from "vitest";
import type { RawIssue, RawStatusCategoryKey } from "../../data/jiraTypes";
import { buildGraph } from "../buildGraph";
import { diffSnapshot, parseSnapshot, takeSnapshot } from "../changes";
import { computeInsights, type Insights } from "../insights";
import type { Graph } from "../types";
import { BLOCKS, data, issue, link, site } from "./helpers";

const A = site("a");

function graphOf(build: () => RawIssue[]): { g: Graph; insights: Insights } {
  const g = buildGraph({ sites: [A], data: [data("a", build())] });
  return { g, insights: computeInsights(g) };
}

const make = (key: string, cat: RawStatusCategoryKey = "new"): RawIssue => issue(key, cat);

describe("snapshot diff", () => {
  it("reports new, newly blocked, unblocked, done and moved issues, and new links", () => {
    // Before: X blocks Y (open); Z unblocked; D open.
    const before = graphOf(() => {
      const [x, y, z, d] = [make("X-1", "indeterminate"), make("Y-1"), make("Z-1"), make("D-1")];
      link("1", BLOCKS, x, y);
      return [x, y, z, d];
    });
    // After: X done (Y unblocked), new W blocks Z, D done, Q is new.
    const after = graphOf(() => {
      const [x, y, z, d, w, q] = [make("X-1", "done"), make("Y-1"), make("Z-1"), make("D-1", "done"), make("W-1"), make("Q-1")];
      link("1", BLOCKS, x, y);
      link("2", BLOCKS, w, z);
      return [x, y, z, d, w, q];
    });
    const snap = takeSnapshot(before.g, before.insights, false, new Date("2026-10-01T10:00:00Z"));
    const c = diffSnapshot(snap, after.g, after.insights, false);
    expect(Object.fromEntries(c.byIssue)).toEqual({
      "a:X-1": ["done"],
      "a:Y-1": ["unblocked"],
      "a:Z-1": ["blocked"],
      "a:D-1": ["done"],
      "a:W-1": ["new"],
      "a:Q-1": ["new"],
    });
    expect(c.counts).toMatchObject({ new: 2, done: 2, blocked: 1, unblocked: 1 });
    expect(c.newLinks).toBe(0); // W-1 is new, so its link isn't counted as a new link between known issues
    expect(c.since).toBe("2026-10-01T10:00:00.000Z");
  });

  it("counts a new link between issues that already existed, and issues that left scope", () => {
    const before = graphOf(() => [make("A-1"), make("B-1"), make("C-1")]);
    const after = graphOf(() => {
      const [a, b] = [make("A-1"), make("B-1")];
      link("1", BLOCKS, a, b);
      return [a, b];
    });
    const c = diffSnapshot(takeSnapshot(before.g, before.insights, false), after.g, after.insights, false);
    expect(c.newLinks).toBe(1);
    expect(c.leftScope).toBe(1);
  });

  it("an unchanged scope has no changes", () => {
    const g = graphOf(() => [make("A-1"), make("B-1", "done")]);
    const c = diffSnapshot(takeSnapshot(g.g, g.insights, true), g.g, g.insights, true);
    expect(c.byIssue.size).toBe(0);
  });

  it("round-trips through JSON and drops malformed entries", () => {
    const g = graphOf(() => [make("A-1")]);
    const snap = takeSnapshot(g.g, g.insights, true);
    const stored: unknown = JSON.parse(JSON.stringify({ ...snap, issues: { ...snap.issues, "a:BAD": { c: "weird", b: 1 } } }));
    expect(parseSnapshot(stored)).toEqual(snap);
    expect(parseSnapshot({ nope: true })).toBeUndefined();
  });
});
