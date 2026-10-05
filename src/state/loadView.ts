import type { SiteConfig } from "../config/types";
import type { Scope, SiteOutcome } from "../data/MultiSiteLoader";
import type { Shown } from "./cacheState";

/** Each selected site's part of the current load. */
export type SiteProgress = Readonly<Record<string, "pending" | SiteOutcome>>;

export type LoadState =
  | { status: "idle" }
  /** `shown`: what stays on screen meanwhile (this scope from the cache, or the previous scope). */
  | { status: "loading"; scopeKey: string; shown: Shown | null; progress: SiteProgress }
  /** What was loaded, for which scope (consumers never pair a result with a newer scope). */
  | ({ status: "done" } & Shown)
  | { status: "failed"; scopeKey: string; message: string; shown: Shown | null };

/** The tickets on screen, whatever the load is doing. */
export const shownOf = (load: LoadState): Shown | null => {
  switch (load.status) {
    case "idle":
      return null;
    case "done":
      return load;
    case "loading":
    case "failed":
      return load.shown;
  }
};

export const pendingProgress = (sites: readonly SiteConfig[]): SiteProgress => Object.fromEntries(sites.map((s) => [s.id, "pending"]));

/** `progress` with `siteId` done; sites outside the load are ignored. */
export const withSiteDone = (progress: SiteProgress, siteId: string, outcome: SiteOutcome): SiteProgress =>
  Object.hasOwn(progress, siteId) ? { ...progress, [siteId]: outcome } : progress;

/**
 * What the views show, derived from the load and the scope asked for:
 * - `empty`: nothing to show (a centred message while busy);
 * - `current`: tickets for the scope asked for (possibly from the cache, updating while busy);
 * - `other`: the previous scope's tickets while the new one loads (faded, not interactive).
 */
export type LoadView = Readonly<{
  shown: Shown | null;
  mode: "empty" | "current" | "other";
  /**
   * The previous scope's tickets stand in for a scope being loaded (or that failed to load): fade
   * them and keep them out of reach. Not set for the moment between asking for a scope and its
   * load starting, so switching to a remembered scope doesn't flash the old one faded.
   */
  stale: boolean;
  busy: boolean;
  progress: SiteProgress | null;
  /** Why the last load failed, while something else stays on screen. */
  failure: string | null;
}>;

export function loadViewOf(load: LoadState, requestedScopeKey: string | null): LoadView {
  const shown = shownOf(load);
  const mode = !shown ? "empty" : shown.scopeKey === requestedScopeKey ? "current" : "other";
  return {
    shown,
    mode,
    stale: mode === "other" && load.status !== "done",
    busy: load.status === "loading",
    progress: load.status === "loading" ? load.progress : null,
    failure: load.status === "failed" && shown ? load.message : null,
  };
}

/** Sites in load order with their progress, labelled for display. */
export function progressParts(sites: readonly SiteConfig[], progress: SiteProgress): { label: string; state: "pending" | SiteOutcome }[] {
  return sites.flatMap((s) => (Object.hasOwn(progress, s.id) ? [{ label: s.label, state: progress[s.id] ?? "pending" }] : []));
}

const MAX_LABEL = 40;

/** A short name for a scope: the query (shortened), the epic, or the seed issue and depth. */
export function scopeLabel(scope: Scope): string {
  switch (scope.mode) {
    case "jql": {
      const q = scope.jql.trim().replace(/\s+/g, " ");
      if (!q) return "the default query";
      return q.length > MAX_LABEL ? `“${q.slice(0, MAX_LABEL - 1)}…”` : `“${q}”`;
    }
    case "epic":
      return `epic ${scope.key}`;
    case "seed":
      return `${scope.key} and its links (depth ${scope.depth})`;
  }
}
