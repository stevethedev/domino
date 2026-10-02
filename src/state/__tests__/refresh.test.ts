import { describe, expect, it } from "vitest";
import type { LoadResult } from "../../data/MultiSiteLoader";
import { issue } from "../../graph/__tests__/helpers";
import { adoptRefresh, nextRefreshDelay, parseRefreshMinutes, updatedAgo } from "../refresh";

const ok = (keys: string[], errors: LoadResult["errors"] = []): LoadResult => ({
  kind: "ok",
  data: [{ siteId: "a", issues: keys.map((k) => issue(k)), remoteLinks: {}, linkTypes: [] }],
  errors,
});

describe("adoptRefresh", () => {
  it("keeps the current object when nothing changed, so the graph isn't rebuilt", () => {
    const current = ok(["A-1"]);
    const outcome = adoptRefresh(current, ok(["A-1"]));
    expect(outcome.kind === "apply" && outcome.result).toBe(current);
  });

  it("applies changed data", () => {
    const next = ok(["A-1", "A-2"]);
    expect(adoptRefresh(ok(["A-1"]), next)).toEqual({ kind: "apply", result: next });
  });

  it("keeps what's on screen when a site that loaded before fails now", () => {
    const outcome = adoptRefresh(ok(["A-1"]), ok([], [{ siteId: "a", message: "timeout" }]));
    expect(outcome).toEqual({ kind: "keep", failedSiteIds: ["a"] });
  });

  it("applies a result whose failures were already failing (nothing more to lose)", () => {
    const errors = [{ siteId: "b", message: "401" }];
    const next = ok(["A-1", "A-2"], errors);
    expect(adoptRefresh(ok(["A-1"], errors), next)).toEqual({ kind: "apply", result: next });
  });

  it("applies an over-cap result, since the scope really grew", () => {
    const next: LoadResult = { kind: "overCap", count: 300, errors: [] };
    expect(adoptRefresh(ok(["A-1"]), next)).toEqual({ kind: "apply", result: next });
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
