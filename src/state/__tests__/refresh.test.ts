import { describe, expect, it } from "vitest";
import type { LoadResult } from "../../data/MultiSiteLoader";
import { issue } from "../../graph/__tests__/helpers";
import type { RawSiteData } from "../../data/jiraTypes";
import { ageText, failureText, freshnessOf, laggingText, mergeBySite, nextRefreshDelay, parseRefreshMinutes, updatedAgo } from "../refresh";

const ok = (keys: string[], errors: LoadResult["errors"] = []): LoadResult => ({
  kind: "ok",
  data: [{ siteId: "a", issues: keys.map((k) => issue(k)), remoteLinks: {}, linkTypes: [] }],
  errors,
});

const A1 = ok(["A-1"]);
const site = (siteId: string, keys: string[]): RawSiteData => ({
  siteId,
  issues: keys.map((k) => issue(k)),
  remoteLinks: {},
  linkTypes: [],
});
const two = (a: string[], b: string[], errors: LoadResult["errors"] = []): LoadResult => ({
  kind: "ok",
  data: [site("a", a), site("b", b)],
  errors,
});

describe("mergeBySite", () => {
  it("takes a fresh load as is when nothing was shown, every site fetched now", () => {
    expect(mergeBySite(null, A1, 500)).toEqual({ result: A1, ages: { a: 500 }, lagging: [] });
  });

  it("keeps the current object when nothing changed, so the graph isn't rebuilt, but dates the sites now", () => {
    const merged = mergeBySite({ result: A1, ages: { a: 100 } }, ok(["A-1"]), 500);
    expect(merged.result).toBe(A1);
    expect(merged.ages).toEqual({ a: 500 });
  });

  it("applies changed data", () => {
    const next = ok(["A-1", "A-2"]);
    expect(mergeBySite({ result: A1, ages: { a: 100 } }, next, 500)).toEqual({ result: next, ages: { a: 500 }, lagging: [] });
  });

  it("keeps a failing site's shown data and lists it as lagging, while the other site updates", () => {
    const current = two(["A-1"], ["B-1"]);
    const next: LoadResult = { kind: "ok", data: [site("a", ["A-1", "A-2"])], errors: [{ siteId: "b", message: "timeout" }] };
    const merged = mergeBySite({ result: current, ages: { a: 100, b: 200 } }, next, 500);
    expect(merged.result).toEqual({ kind: "ok", data: [site("a", ["A-1", "A-2"]), site("b", ["B-1"])], errors: [] });
    expect(merged.ages).toEqual({ a: 500, b: 200 });
    expect(merged.lagging).toEqual([{ siteId: "b", takenAt: 200, message: "timeout" }]);
  });

  it("prefers a failing site's complete shown data over the partial data its failed load returned", () => {
    const next = two(["A-1"], ["B-1"], [{ siteId: "b", message: "remote links failed" }]);
    const merged = mergeBySite({ result: two(["A-1"], ["B-1", "B-2"]), ages: { a: 1, b: 2 } }, next, 500);
    expect(merged.result.kind === "ok" && merged.result.data.find((d) => d.siteId === "b")).toEqual(site("b", ["B-1", "B-2"]));
  });

  it("reports a failing site with nothing shown for it as an error, keeping any partial data", () => {
    const errors = [{ siteId: "b", message: "401" }];
    const next = two(["A-1"], ["B-9"], errors);
    expect(mergeBySite({ result: A1, ages: { a: 100 } }, next, 500)).toEqual({ result: next, ages: { a: 500, b: 500 }, lagging: [] });
  });

  it("replaces everything with an over-cap result, since the scope really grew", () => {
    const next: LoadResult = { kind: "overCap", count: 300, errors: [] };
    expect(mergeBySite({ result: A1, ages: { a: 100 } }, next, 500)).toEqual({ result: next, ages: {}, lagging: [] });
  });
});

describe("ageText", () => {
  it("reads naturally at each scale", () => {
    const min = 60_000;
    expect([0, 12, 125, 24 * 60 + 5, 3 * 24 * 60].map((m) => ageText(0, m * min))).toEqual([
      "just now",
      "12m ago",
      "2h ago",
      "yesterday",
      "3 days ago",
    ]);
  });
});

describe("laggingText", () => {
  const labelOf = (id: string): string => id.toUpperCase();
  it("names the site and its age", () => {
    expect(laggingText([{ siteId: "b", takenAt: 0, message: "timeout" }], labelOf, 2 * 3_600_000)).toBe(
      "Couldn't update B; showing its tickets from 2h ago.",
    );
  });

  it("names every lagging site and the oldest age", () => {
    const lagging = [
      { siteId: "a", takenAt: 50 * 60_000, message: "timeout" },
      { siteId: "b", takenAt: 0, message: "timeout" },
    ];
    expect(laggingText(lagging, labelOf, 60 * 60_000)).toBe("Couldn't update A, B; showing their tickets from 1h ago.");
  });
});

describe("nextRefreshDelay", () => {
  it("waits out the rest of the interval, and is 0 once overdue", () => {
    expect(nextRefreshDelay(1_000, 61_000, 300_000)).toBe(240_000);
    expect(nextRefreshDelay(1_000, 999_000, 300_000)).toBe(0);
  });
});

describe("parseRefreshMinutes", () => {
  it("accepts only the offered intervals", () => {
    expect([0, 5, 30].map(parseRefreshMinutes)).toEqual([0, 5, 30]);
    expect([1, "5", null].map(parseRefreshMinutes)).toEqual([undefined, undefined, undefined]);
  });
});

describe("updatedAgo", () => {
  it("reads naturally at each scale", () => {
    expect(updatedAgo(0, 59_000)).toBe("just now");
    expect(updatedAgo(0, 12 * 60_000 + 5)).toBe("12m ago");
    expect(updatedAgo(0, 2 * 3_600_000)).toMatch(/^at \d/);
  });
});

describe("freshnessOf", () => {
  const MIN = 60_000;
  const base = { lastUpdated: null, refreshing: false, error: null, lagging: [], updating: false, shownAt: null } as const;
  const labelOf = (id: string): string => id.toUpperCase();
  const text = (f: Partial<Parameters<typeof freshnessOf>[0]>, now = 0): string | undefined =>
    freshnessOf({ ...base, ...f }, labelOf, now)?.text;

  it("says how old the tickets are while they update, once they're more than a moment old", () => {
    expect(text({ updating: true, shownAt: 0 }, 2 * 60 * MIN)).toBe("from 2h ago, updating…");
    expect(text({ updating: true, shownAt: 0 }, 30_000)).toBe("updating…");
    expect(text({ updating: true })).toBe("updating…");
  });

  it("warns about refresh errors and lagging sites", () => {
    expect(freshnessOf({ ...base, error: "Refresh failed: 500" }, labelOf, 0)).toEqual({ text: "Refresh failed: 500", warn: true });
    expect(freshnessOf({ ...base, lagging: [{ siteId: "b", takenAt: 0, message: "timeout" }] }, labelOf, 5 * MIN)).toEqual({
      text: "Couldn't update B; showing its tickets from 5m ago.",
      warn: true,
    });
  });

  it("dates confirmed data by its last update, and cached data by when it was fetched", () => {
    expect(text({ lastUpdated: 0 }, 12 * MIN)).toBe("updated 12m ago");
    expect(text({ shownAt: 0 }, 3 * 60 * MIN)).toBe("from 3h ago");
    expect(text({})).toBeUndefined();
  });

  it("says refreshing during a background refresh", () => {
    expect(text({ refreshing: true, lastUpdated: 0 })).toBe("refreshing…");
  });
});

describe("failureText", () => {
  it("names the error and how old the tickets kept on screen are", () => {
    expect(failureText("timeout", 0, 2 * 3_600_000)).toBe("Couldn't update (timeout); showing tickets from 2h ago.");
  });
});
