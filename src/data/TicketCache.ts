import type { BackendKind, DominoConfig, SiteAuth } from "../config/types";
import type { RawSiteData } from "./jiraTypes";
import type { LoadResult, SiteError } from "./MultiSiteLoader";

export type OkResult = Extract<LoadResult, { kind: "ok" }>;

/** When each site's data was fetched (epoch ms), by site id. */
export type SiteTimes = Readonly<Record<string, number>>;

/** A scope's last successful load, as cached: the per-site data and when each site's was fetched. */
export type CachedScope = Readonly<{ scopeKey: string; result: OkResult; ages: SiteTimes }>;

/**
 * The last tickets loaded per scope, kept between launches (encrypted, in the Rust core). Only
 * successful loads are cached. Reading never fails: anything wrong is a miss.
 */
export interface TicketCache {
  get(scopeKey: string): Promise<CachedScope | null>;
  /** `config` says which address and account each site was loaded with; sites it lacks are skipped. */
  put(scopeKey: string, result: OkResult, ages: SiteTimes, config: DominoConfig): Promise<void>;
  clear(): Promise<void>;
}

/** One site's cached data on the wire (what the backend returns). */
export type WireSite = Readonly<{ siteId: string; takenAt: number; data: unknown }>;
export type WireScope = Readonly<{ scopeKey: string; sites: readonly WireSite[]; errors: unknown }>;

/** What `cache_put` takes: each site's data plus the address and account it was loaded with. */
export type PutEntry = Readonly<{
  scopeKey: string;
  backend: BackendKind;
  sites: readonly (WireSite & Readonly<{ baseUrl: string; auth: SiteAuth }>)[];
  errors: readonly SiteError[];
}>;

export function toPutEntry(scopeKey: string, result: OkResult, ages: SiteTimes, config: DominoConfig): PutEntry {
  const sites = result.data.flatMap((data) => {
    const site = config.sites.find((s) => s.id === data.siteId);
    const takenAt = Object.hasOwn(ages, data.siteId) ? ages[data.siteId] : undefined;
    return site && takenAt !== undefined ? [{ siteId: data.siteId, takenAt, data, baseUrl: site.baseUrl, auth: site.auth }] : [];
  });
  return { scopeKey, backend: config.backend, sites, errors: result.errors };
}

const isRecord = (v: unknown): v is Readonly<Record<string, unknown>> => typeof v === "object" && v !== null && !Array.isArray(v);
const isString = (v: unknown): v is string => typeof v === "string";

/** A light structural check: enough that building the graph from it can't trip over its shape. */
function isSiteData(v: unknown, siteId: string): v is RawSiteData {
  return (
    isRecord(v) &&
    v.siteId === siteId &&
    Array.isArray(v.issues) &&
    v.issues.every((i) => isRecord(i) && isString(i.key) && isRecord(i.fields)) &&
    isRecord(v.remoteLinks) &&
    Array.isArray(v.linkTypes) &&
    (v.priorities === undefined || Array.isArray(v.priorities))
  );
}

const isSiteError = (v: unknown): v is SiteError => isRecord(v) && isString(v.siteId) && isString(v.message);

/** The cached scope the backend returned, or null if it's missing or malformed. */
export function parseCachedScope(raw: unknown, scopeKey: string): CachedScope | null {
  if (!isRecord(raw) || raw.scopeKey !== scopeKey || !Array.isArray(raw.sites) || !Array.isArray(raw.errors)) return null;
  const data: RawSiteData[] = [];
  const ages: Record<string, number> = {};
  for (const s of raw.sites) {
    if (!isRecord(s) || !isString(s.siteId) || typeof s.takenAt !== "number" || !isSiteData(s.data, s.siteId)) return null;
    data.push(s.data);
    ages[s.siteId] = s.takenAt;
  }
  if (data.length === 0 || !raw.errors.every(isSiteError)) return null;
  return { scopeKey, result: { kind: "ok", data, errors: raw.errors }, ages };
}
