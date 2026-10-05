import { describe, expect, it } from "vitest";
import type { DominoConfig } from "../../config/types";
import type { PutEntry } from "../../data/TicketCache";
import { MockTicketCache, pruneEntries, type MockCacheStore, type StoredEntry } from "../mockTicketCache";

const DAY = 24 * 60 * 60 * 1000;
const config: DominoConfig = {
  sites: [
    {
      id: "a",
      label: "A",
      baseUrl: "https://a.atlassian.net",
      auth: { type: "apiToken", email: "x@a.io", secretRef: "TOKEN_A" },
      color: "#111111",
      enabled: true,
    },
    { id: "b", label: "B", baseUrl: "https://b.atlassian.net", auth: { type: "oauth3lo" }, color: "#222222", enabled: true },
  ],
  defaultSiteIds: [],
  backend: "mock",
};
const entry = (scopeKey: string, takenAt = 1000): PutEntry => ({
  scopeKey,
  backend: config.backend,
  sites: config.sites.map((s) => ({ siteId: s.id, takenAt, data: { siteId: s.id }, baseUrl: s.baseUrl, auth: s.auth })),
  errors: [],
});

function memoryCache(version = "1.0.0"): { cache: MockTicketCache; store: () => MockCacheStore } {
  let store: MockCacheStore = {};
  const cache = new MockTicketCache(
    version,
    () => store,
    (next) => {
      store = next;
    },
  );
  return { cache, store: () => store };
}

describe("MockTicketCache", () => {
  it("returns what was put, while the sites are configured the same way", () => {
    const { cache } = memoryCache();
    cache.put(entry("s"), config, 1000);
    expect(cache.get("s", config, 2000)?.sites.map((s) => s.siteId)).toEqual(["a", "b"]);
    const moved = { ...config, sites: config.sites.map((x) => (x.id === "a" ? { ...x, baseUrl: "https://moved.atlassian.net" } : x)) };
    expect(cache.get("s", moved, 2000)?.sites.map((s) => s.siteId)).toEqual(["b"]);
  });

  it("misses entries from another app version, or older than 30 days", () => {
    const old = memoryCache("0.1.0");
    old.cache.put(entry("s"), config, 1000);
    const { cache, store } = memoryCache("0.2.0");
    expect(new MockTicketCache("0.2.0", old.store, () => undefined).get("s", config, 2000)).toBeNull();
    cache.put(entry("s", 0), config, 0);
    expect(cache.get("s", config, 31 * DAY)).toBeNull();
    expect(store()).toEqual({});
  });

  it("forgets sites whose account may have changed, and invalidates reconfigured sites on save", () => {
    const { cache } = memoryCache();
    cache.put(entry("s"), config, 1000);
    cache.forgetSites((id) => id === "a", 1500);
    expect(cache.get("s", config, 2000)?.sites.map((s) => s.siteId)).toEqual(["b"]);
    cache.invalidateChanged(config, { ...config, backend: "jira" }, 2000);
    expect(cache.get("s", config, 2000)).toBeNull();
  });
});

describe("MockTicketCache invalidation", () => {
  it("stores nothing fetched before the last clear or purge, like the Rust cache", () => {
    const { cache } = memoryCache();
    cache.put(entry("s", 1000), config, 1000);
    cache.clear(2000);
    cache.put(entry("s", 1500), config, 2500); // fetched before the clear, written after it
    expect(cache.get("s", config, 3000)).toBeNull();
    cache.put(entry("s", 2600), config, 2600); // fetched after it
    expect(cache.get("s", config, 3000)).not.toBeNull();

    cache.forgetSites((id) => id === "a", 4000);
    cache.put(entry("t", 3500), config, 4500);
    expect(cache.get("t", config, 5000)).toBeNull();
  });
});

describe("pruneEntries", () => {
  const e = (viewedAt: number): StoredEntry => ({ appVersion: "1", scopeKey: String(viewedAt), viewedAt, sites: [], errors: [] });

  it("keeps the most recently viewed, and nothing older than 30 days", () => {
    const store = Object.fromEntries([1, 2, 3, 4].map((d) => [String(d), e(d * DAY)]));
    expect(Object.keys(pruneEntries(store, 4 * DAY, 2)).sort()).toEqual(["3", "4"]);
    expect(Object.keys(pruneEntries(store, 33 * DAY)).sort()).toEqual(["3", "4"]);
  });
});
