import { describe, expect, it } from "vitest";
import type { SiteConfig } from "../../config/types";
import type { Shown } from "../cacheState";
import { loadViewOf, pendingProgress, progressParts, scopeLabel, withSiteDone, type LoadState } from "../loadView";

const shown = (scopeKey: string): Shown => ({
  result: { kind: "ok", data: [], errors: [] },
  scopeKey,
  origin: "cache",
  ages: {},
  fingerprints: {},
});
const site = (id: string): SiteConfig => ({
  id,
  label: id.toUpperCase(),
  baseUrl: "",
  auth: { type: "oauth3lo" },
  color: "",
  enabled: true,
});
const progress = pendingProgress([site("a"), site("b")]);

describe("loadViewOf", () => {
  const cases: [string, LoadState, Partial<ReturnType<typeof loadViewOf>>][] = [
    ["idle", { status: "idle" }, { mode: "empty", stale: false, busy: false, failure: null }],
    ["first load", { status: "loading", scopeKey: "s", shown: null, progress }, { mode: "empty", busy: true, progress }],
    ["cached scope updating", { status: "loading", scopeKey: "s", shown: shown("s"), progress }, { mode: "current", busy: true }],
    [
      "previous scope while loading",
      { status: "loading", scopeKey: "s", shown: shown("old"), progress },
      { mode: "other", stale: true, busy: true },
    ],
    [
      "previous scope after a failed load",
      { status: "failed", scopeKey: "s", message: "boom", shown: shown("old") },
      { mode: "other", stale: true },
    ],
    // Asked for a new scope, its load not started yet: not faded (it may come from memory at once).
    ["previous scope before its load starts", { status: "done", ...shown("old") }, { mode: "other", stale: false, busy: false }],
    ["done", { status: "done", ...shown("s") }, { mode: "current", stale: false, busy: false, progress: null }],
    [
      "failed with tickets kept",
      { status: "failed", scopeKey: "s", message: "boom", shown: shown("s") },
      { mode: "current", failure: "boom" },
    ],
    ["failed with nothing", { status: "failed", scopeKey: "s", message: "boom", shown: null }, { mode: "empty", failure: null }],
  ];
  it.each(cases)("%s", (_name, load, expected) => {
    expect(loadViewOf(load, "s")).toMatchObject(expected);
  });
});

describe("site progress", () => {
  it("records each site once it's done, ignoring sites outside the load", () => {
    const next = withSiteDone(withSiteDone(progress, "b", "failed"), "z", "loaded");
    expect(next).toEqual({ a: "pending", b: "failed" });
    expect(progressParts([site("a"), site("b"), site("c")], next)).toEqual([
      { label: "A", state: "pending" },
      { label: "B", state: "failed" },
    ]);
  });
});

describe("scopeLabel", () => {
  it("names each kind of scope briefly", () => {
    expect(scopeLabel({ mode: "jql", jql: "  project =  X " })).toBe("“project = X”");
    expect(scopeLabel({ mode: "jql", jql: "x".repeat(60) })).toBe(`“${"x".repeat(39)}…”`);
    expect(scopeLabel({ mode: "jql", jql: "" })).toBe("the default query");
    expect(scopeLabel({ mode: "epic", siteId: "a", key: "A-1" })).toBe("epic A-1");
    expect(scopeLabel({ mode: "seed", siteId: "a", key: "A-1", depth: 2 })).toBe("A-1 and its links (depth 2)");
  });
});
