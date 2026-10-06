// The browser preview's stand-in for the Rust ticket cache (src-tauri/src/cache.rs), with the
// same rules: per-site fingerprints of backend, address and account; other app versions miss;
// the 12 most recently viewed scopes; nothing older than 30 days. It holds mock data only, so it
// isn't encrypted.
import type { BackendKind, DominoConfig, SiteAuth } from "../config/types";
import type { PutEntry, WireScope } from "../data/TicketCache";

const MAX_SCOPES = 12;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

type StoredSite = Readonly<{ siteId: string; fingerprint: string; takenAt: number; data: unknown }>;
export type StoredEntry = Readonly<{
  appVersion: string;
  scopeKey: string;
  viewedAt: number;
  sites: readonly StoredSite[];
  errors: unknown;
}>;
export type MockCacheStore = Readonly<Record<string, StoredEntry>>;

const fingerprint = (backend: BackendKind, baseUrl: string, auth: SiteAuth): string => JSON.stringify([backend, baseUrl, auth]);

const currentFingerprint = (config: DominoConfig, siteId: string): string | undefined => {
  const site = config.sites.find((s) => s.id === siteId);
  return site && fingerprint(config.backend, site.baseUrl, site.auth);
};

/** Drops scopes not viewed for 30 days, then all but the `max` most recently viewed. */
export function pruneEntries(store: MockCacheStore, now: number, max = MAX_SCOPES): MockCacheStore {
  const kept = Object.entries(store)
    .filter(([, e]) => now - e.viewedAt <= MAX_AGE_MS)
    .sort(([, a], [, b]) => b.viewedAt - a.viewedAt)
    .slice(0, max);
  return Object.fromEntries(kept);
}

/** Keeps the sites `keep` accepts; scopes left with none are dropped. */
function filterSites(store: MockCacheStore, keep: (site: StoredSite, entry: StoredEntry) => boolean): MockCacheStore {
  return Object.fromEntries(
    Object.entries(store).flatMap(([k, e]) => {
      const sites = e.sites.filter((s) => keep(s, e));
      return sites.length > 0 ? [[k, { ...e, sites }]] : [];
    }),
  );
}

export class MockTicketCache {
  /** When the cache was last cleared or had sites purged: data fetched by then is never written (as in Rust). */
  private invalidatedAt = 0;

  constructor(
    private readonly appVersion: string,
    private readonly read: () => MockCacheStore,
    private readonly write: (store: MockCacheStore) => void,
  ) {}

  get(scopeKey: string, config: DominoConfig, now: number): WireScope | null {
    const store = this.read();
    const entry = Object.hasOwn(store, scopeKey) ? store[scopeKey] : undefined;
    if (!entry) return null;
    const sites =
      entry.appVersion === this.appVersion
        ? entry.sites.filter((s) => now - s.takenAt <= MAX_AGE_MS && currentFingerprint(config, s.siteId) === s.fingerprint)
        : [];
    const rest = Object.fromEntries(Object.entries(store).filter(([k]) => k !== scopeKey));
    if (sites.length === 0) {
      this.write(rest);
      return null;
    }
    this.write({ ...rest, [scopeKey]: { ...entry, sites, viewedAt: now } });
    return { scopeKey, sites: sites.map((s) => ({ siteId: s.siteId, takenAt: s.takenAt, data: s.data })), errors: entry.errors };
  }

  put(entry: PutEntry, config: DominoConfig, now: number): void {
    const sites = entry.sites.flatMap((s) => {
      if (s.takenAt <= this.invalidatedAt) return [];
      const fp = fingerprint(entry.backend, s.baseUrl, s.auth);
      return currentFingerprint(config, s.siteId) === fp ? [{ siteId: s.siteId, fingerprint: fp, takenAt: s.takenAt, data: s.data }] : [];
    });
    if (sites.length === 0) return;
    const next = {
      ...this.read(),
      [entry.scopeKey]: { appVersion: this.appVersion, scopeKey: entry.scopeKey, viewedAt: now, sites, errors: entry.errors },
    };
    this.write(pruneEntries(next, now));
  }

  clear(now: number): void {
    this.invalidatedAt = now;
    this.write({});
  }

  forgetSites(isStale: (siteId: string) => boolean, now: number): void {
    this.invalidatedAt = now;
    this.write(filterSites(this.read(), (s) => !isStale(s.siteId)));
  }

  /** After a Settings save: drops sites removed or now loading from another backend, address or account. */
  invalidateChanged(old: DominoConfig, next: DominoConfig, now: number): void {
    const changed = (siteId: string): boolean => currentFingerprint(old, siteId) !== currentFingerprint(next, siteId);
    if (old.sites.some((s) => changed(s.id))) this.forgetSites(changed, now);
  }
}
