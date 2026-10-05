import type { DominoConfig } from "../config/types";
import type { LoadResult } from "../data/MultiSiteLoader";
import type { LoadState } from "./loadView";
import type { SiteAges } from "./refresh";

/**
 * Tickets on screen: a load's result for a scope, where it came from, and when and how (backend,
 * address, account) each site's data was fetched.
 */
export type Shown = Readonly<{
  result: LoadResult;
  scopeKey: string;
  /** "cache": from the ticket cache, not yet confirmed by a load this session. */
  origin: "network" | "cache";
  ages: SiteAges;
  /** Per site: the backend, address and account its data was loaded with (see siteFingerprint). */
  fingerprints: Readonly<Record<string, string>>;
}>;

/** Identifies where a site's data comes from: backend, address and account. */
export function siteFingerprint(config: DominoConfig, siteId: string): string | undefined {
  const site = config.sites.find((s) => s.id === siteId);
  return site && JSON.stringify([config.backend, site.baseUrl, site.auth]);
}

export const fingerprintsOf = (config: DominoConfig, siteIds: readonly string[]): Readonly<Record<string, string>> =>
  Object.fromEntries(
    siteIds.flatMap((id) => {
      const fp = siteFingerprint(config, id);
      return fp === undefined ? [] : [[id, fp]];
    }),
  );

/** `shown` with only the sites `keep` accepts; null when none are left. Unchanged input comes back as the same object. */
function keepSites(shown: Shown | null, keep: (siteId: string) => boolean): Shown | null {
  if (shown?.result.kind !== "ok") return null;
  const data = shown.result.data.filter((d) => keep(d.siteId));
  if (data.length === 0) return null;
  if (data.length === shown.result.data.length) return shown;
  const kept = new Set(data.map((d) => d.siteId));
  const pick = <T>(record: Readonly<Record<string, T>>): Record<string, T> =>
    Object.fromEntries(Object.entries(record).filter(([id]) => kept.has(id)));
  return {
    ...shown,
    result: { kind: "ok", data, errors: shown.result.errors.filter((e) => kept.has(e.siteId)) },
    ages: pick(shown.ages),
    fingerprints: pick(shown.fingerprints),
  };
}

/**
 * What's still fit to show under `config`: sites removed, or now loading from another backend,
 * address or account, are dropped. Null when nothing is left (or there was nothing to show).
 * Unchanged input comes back as the same object.
 */
export function pruneShown(shown: Shown | null, config: DominoConfig): Shown | null {
  if (!shown) return null;
  const fitFor = (siteId: string): boolean =>
    Object.hasOwn(shown.fingerprints, siteId) && shown.fingerprints[siteId] === siteFingerprint(config, siteId);
  return keepSites(shown, fitFor);
}

/**
 * `shown` without the sites `isStale` matches: after a token or sign-in change their tickets may
 * belong to another account, which their fingerprints (address and auth type) can't tell.
 */
export const withoutSites = (shown: Shown | null, isStale: (siteId: string) => boolean): Shown | null =>
  keepSites(shown, (siteId) => !isStale(siteId));

/** The load with those sites dropped from whatever it has on screen. */
export function withoutSitesInLoad(load: LoadState, isStale: (siteId: string) => boolean): LoadState {
  switch (load.status) {
    case "idle":
      return load;
    case "done": {
      const kept = withoutSites(load, isStale);
      return kept === load ? load : kept ? { status: "done", ...kept } : { status: "idle" };
    }
    case "loading":
    case "failed":
      return { ...load, shown: withoutSites(load.shown, isStale) };
  }
}

/** Every remembered scope without those sites; scopes left with none are forgotten. */
export function withoutSitesInMemory(lru: ReadonlyMap<string, Shown>, isStale: (siteId: string) => boolean): ReadonlyMap<string, Shown> {
  return new Map(
    [...lru].flatMap(([key, shown]) => {
      const kept = withoutSites(shown, isStale);
      return kept ? [[key, kept] as const] : [];
    }),
  );
}

/** Scopes remembered in memory for instant switching back; the least recently used drop first. */
export const MAX_REMEMBERED_SCOPES = 12;

/** `lru` with `shown` as its most recently used entry, capped at `max`. */
export function rememberScope(lru: ReadonlyMap<string, Shown>, shown: Shown, max = MAX_REMEMBERED_SCOPES): ReadonlyMap<string, Shown> {
  const next = new Map([...lru].filter(([key]) => key !== shown.scopeKey));
  next.set(shown.scopeKey, shown);
  return new Map([...next].slice(-max));
}
