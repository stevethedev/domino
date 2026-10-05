import { describe, expect, it } from "vitest";
import type { DominoConfig } from "../../config/types";
import type { RawSiteData } from "../../data/jiraTypes";
import { issue } from "../../graph/__tests__/helpers";
import { fingerprintsOf, pruneShown, rememberScope, type Shown } from "../cacheState";

const config: DominoConfig = {
  sites: [
    { id: "a", label: "A", baseUrl: "https://a.atlassian.net", auth: { type: "oauth3lo" }, color: "#111111", enabled: true },
    { id: "b", label: "B", baseUrl: "https://b.atlassian.net", auth: { type: "oauth3lo" }, color: "#222222", enabled: true },
  ],
  defaultSiteIds: [],
  backend: "jira",
};
const siteData = (siteId: string): RawSiteData => ({
  siteId,
  issues: [issue(`${siteId.toUpperCase()}-1`)],
  remoteLinks: {},
  linkTypes: [],
});
const shown = (scopeKey = "s"): Shown => ({
  result: { kind: "ok", data: [siteData("a"), siteData("b")], errors: [{ siteId: "b", message: "partial" }] },
  scopeKey,
  origin: "network",
  ages: { a: 1, b: 2 },
  fingerprints: fingerprintsOf(config, ["a", "b"]),
});

describe("pruneShown", () => {
  it("keeps what's still configured the same way, as the same object", () => {
    const s = shown();
    expect(pruneShown(s, config)).toBe(s);
  });

  it("drops sites removed, moved, or switched to another account or backend", () => {
    const moved = { ...config, sites: config.sites.map((x) => (x.id === "b" ? { ...x, baseUrl: "https://moved.atlassian.net" } : x)) };
    const pruned = pruneShown(shown(), moved);
    expect(pruned?.result.kind === "ok" && pruned.result.data.map((d) => d.siteId)).toEqual(["a"]);
    expect(pruned?.result.errors).toEqual([]);
    expect(pruned?.ages).toEqual({ a: 1 });
    expect(pruneShown(shown(), { ...config, sites: [] })).toBeNull();
    expect(pruneShown(shown(), { ...config, backend: "mock" })).toBeNull();
  });

  it("has nothing to show for an over-cap result or nothing at all", () => {
    expect(pruneShown({ ...shown(), result: { kind: "overCap", count: 301, errors: [] } }, config)).toBeNull();
    expect(pruneShown(null, config)).toBeNull();
  });
});

describe("rememberScope", () => {
  it("keeps the most recently used scopes, latest last", () => {
    let lru: ReadonlyMap<string, Shown> = new Map();
    for (const k of ["s1", "s2", "s3"]) lru = rememberScope(lru, shown(k), 2);
    expect([...lru.keys()]).toEqual(["s2", "s3"]);
    lru = rememberScope(lru, shown("s2"), 2);
    expect([...lru.keys()]).toEqual(["s3", "s2"]);
  });
});
