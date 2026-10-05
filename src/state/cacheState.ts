import type { DominoConfig } from "../config/types";
import type { LoadResult } from "../data/MultiSiteLoader";
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

/**
 * What's still fit to show under `config`: sites removed, or now loading from another backend,
 * address or account, are dropped. Null when nothing is left (or there was nothing to show).
 * Unchanged input comes back as the same object.
 */
export function pruneShown(shown: Shown | null, config: DominoConfig): Shown | null {
  if (shown?.result.kind !== "ok") return null;
  const valid = (siteId: string): boolean =>
    Object.hasOwn(shown.fingerprints, siteId) && shown.fingerprints[siteId] === siteFingerprint(config, siteId);
  const data = shown.result.data.filter((d) => valid(d.siteId));
  if (data.length === 0) return null;
  if (data.length === shown.result.data.length) return shown;
  const keep = new Set(data.map((d) => d.siteId));
  const pick = <T>(record: Readonly<Record<string, T>>): Record<string, T> =>
    Object.fromEntries(Object.entries(record).filter(([id]) => keep.has(id)));
  return {
    ...shown,
    result: { kind: "ok", data, errors: shown.result.errors.filter((e) => keep.has(e.siteId)) },
    ages: pick(shown.ages),
    fingerprints: pick(shown.fingerprints),
  };
}

/** Scopes remembered in memory for instant switching back; the least recently used drop first. */
export const MAX_REMEMBERED_SCOPES = 12;

/** `lru` with `shown` as its most recently used entry, capped at `max`. */
export function rememberScope(lru: ReadonlyMap<string, Shown>, shown: Shown, max = MAX_REMEMBERED_SCOPES): ReadonlyMap<string, Shown> {
  const next = new Map([...lru].filter(([key]) => key !== shown.scopeKey));
  next.set(shown.scopeKey, shown);
  return new Map([...next].slice(-max));
}
