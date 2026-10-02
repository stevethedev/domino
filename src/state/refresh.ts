import type { LoadResult } from "../data/MultiSiteLoader";

/** Auto-refresh choices in minutes; 0 is off. Each load makes a request per issue, so nothing faster. */
export const REFRESH_MINUTES = [0, 2, 5, 15, 30] as const;
export type RefreshMinutes = (typeof REFRESH_MINUTES)[number];
export const DEFAULT_REFRESH_MINUTES: RefreshMinutes = 5;
export const REFRESH_MINUTES_KEY = "domino.autoRefreshMinutes";

export const parseRefreshMinutes = (raw: unknown): RefreshMinutes | undefined => REFRESH_MINUTES.find((m) => m === raw);

/** What a background refresh should do with its result. */
export type RefreshOutcome =
  /** Show `result` (identical data keeps the current object, so nothing downstream recomputes). */
  | { kind: "apply"; result: LoadResult }
  /** Keep what's on screen: these sites failed now but loaded before, so applying would drop their issues. */
  | { kind: "keep"; failedSiteIds: string[] };

export function adoptRefresh(current: LoadResult, next: LoadResult): RefreshOutcome {
  const failedBefore = new Set(current.errors.map((e) => e.siteId));
  const newlyFailed = next.errors.map((e) => e.siteId).filter((id) => !failedBefore.has(id));
  if (newlyFailed.length > 0) return { kind: "keep", failedSiteIds: newlyFailed };
  return { kind: "apply", result: JSON.stringify(next) === JSON.stringify(current) ? current : next };
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
