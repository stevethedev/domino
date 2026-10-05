import type { LoadResult } from "../data/MultiSiteLoader";

/** Auto-refresh choices in minutes; 0 is off. Each load makes a request per issue, so nothing faster. */
export const REFRESH_MINUTES = [0, 2, 5, 15, 30] as const;
export type RefreshMinutes = (typeof REFRESH_MINUTES)[number];
export const DEFAULT_REFRESH_MINUTES: RefreshMinutes = 5;
export const REFRESH_MINUTES_KEY = "domino.autoRefreshMinutes";

export const parseRefreshMinutes = (raw: unknown): RefreshMinutes | undefined => REFRESH_MINUTES.find((m) => m === raw);

/** When each site's data on screen was fetched (epoch ms), by site id. */
export type SiteAges = Readonly<Record<string, number>>;

/** A site whose latest load failed, still shown with the data fetched at `takenAt`. */
export type LaggingSite = Readonly<{ siteId: string; takenAt: number }>;

export type Shown = Readonly<{ result: LoadResult; ages: SiteAges }>;

export type Merged = Readonly<{ result: LoadResult; ages: SiteAges; lagging: readonly LaggingSite[] }>;

/**
 * Combines a fresh load with what's on screen, site by site: a site that loaded shows its fresh
 * data; a site that failed keeps the data already shown for it (and is listed as lagging), or
 * shows whatever partial data it returned if nothing was shown before. An over-cap result
 * replaces everything, since the scope really grew. When the merge equals what's on screen, the
 * current result object is kept, so nothing downstream recomputes.
 */
export function mergeBySite(current: Shown | null, next: LoadResult, now: number): Merged {
  if (next.kind !== "ok") return { result: next, ages: {}, lagging: [] };
  const before = current?.result.kind === "ok" ? current.result : null;
  const shownAt = (siteId: string): number | undefined =>
    current && Object.hasOwn(current.ages, siteId) ? current.ages[siteId] : undefined;
  const failed = new Set(next.errors.map((e) => e.siteId));
  const kept = before ? before.data.filter((d) => failed.has(d.siteId) && shownAt(d.siteId) !== undefined) : [];
  const keptIds = new Set(kept.map((d) => d.siteId));
  const data = [...next.data.filter((d) => !keptIds.has(d.siteId)), ...kept];
  const result: LoadResult = { kind: "ok", data, errors: next.errors.filter((e) => !keptIds.has(e.siteId)) };
  const ages = Object.fromEntries(data.map((d) => [d.siteId, (keptIds.has(d.siteId) ? shownAt(d.siteId) : undefined) ?? now]));
  const lagging = kept.map((d) => ({ siteId: d.siteId, takenAt: shownAt(d.siteId) ?? now }));
  const unchanged = before !== null && JSON.stringify(result) === JSON.stringify(before);
  return { result: unchanged ? before : result, ages, lagging };
}

/** How long ago data was fetched: "just now", "12m ago", "2h ago", "yesterday", "3 days ago". */
export function ageText(takenAt: number, now: number): string {
  const minutes = Math.floor((now - takenAt) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

/** "Couldn't update Partner; showing its tickets from 2h ago." (the oldest, when several lag). */
export function laggingText(lagging: readonly LaggingSite[], labelOf: (siteId: string) => string, now: number): string {
  const oldest = Math.min(...lagging.map((l) => l.takenAt));
  const labels = lagging.map((l) => labelOf(l.siteId));
  return `Couldn't update ${labels.join(", ")}; showing ${labels.length === 1 ? "its" : "their"} tickets from ${ageText(oldest, now)}.`;
}

/** Milliseconds until the next refresh is due (0 when overdue). */
export const nextRefreshDelay = (lastUpdated: number, now: number, intervalMs: number): number =>
  Math.max(0, lastUpdated + intervalMs - now);

/** "just now", "12m ago", then the local time once it's been an hour or more. */
export function updatedAgo(lastUpdated: number, now: number): string {
  const minutes = Math.floor((now - lastUpdated) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  return `at ${new Date(lastUpdated).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}
