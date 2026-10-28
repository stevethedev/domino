import { useState, type ReactElement } from "react";
import { siteKindOf, type SiteConfig } from "../config/types";
import { combineGitHubQuery, repoScopeOf } from "../data/github/query";
import type { LoadResult, Scope } from "../data/MultiSiteLoader";
import type { LaggingSite } from "../state/refresh";

/** A GitHub site whose search named repositories or owners and found nothing in them. */
export type EmptyScopedSearch = Readonly<{ siteId: string; names: readonly string[] }>;

/**
 * GitHub sites that loaded without error but found nothing, though their search names a repository or
 * owner. GitHub leaves out what the token can't see without saying so, so a private repository the
 * token isn't authorized for looks just like a search that matched nothing. A `lagging` site's tickets
 * are from before a failed refresh, so they say nothing about the search now.
 */
export function emptyScopedSearches(
  scope: Scope,
  sites: readonly SiteConfig[],
  result: LoadResult,
  lagging: readonly LaggingSite[] = [],
): EmptyScopedSearch[] {
  if (scope.mode !== "jql" || result.kind !== "ok") return [];
  return result.data.flatMap(({ siteId, issues }) => {
    const site = sites.find((s) => s.id === siteId);
    if (!site || siteKindOf(site) !== "github" || issues.length > 0 || lagging.some((l) => l.siteId === siteId)) return [];
    const named = repoScopeOf(combineGitHubQuery(site.baseJql ?? "", scope.github ?? ""));
    const names = [...(named?.repos ?? []), ...(named?.owners ?? [])];
    return names.length > 0 ? [{ siteId, names }] : [];
  });
}

/**
 * The dismissal to keep: forgotten only once a settled load has no empty searches, so the same ones
 * coming back show again. While nothing is settled (`null`: a load running) it's kept.
 */
export const keptDismissal = (dismissed: string | null, searches: readonly EmptyScopedSearch[] | null): string | null =>
  searches?.length === 0 ? null : dismissed;

/**
 * "Nothing found in change/outreach": a hint that the token may not see it, with where to fix it.
 * Dismiss hides it until the searches it's about change. `searches` is null while there's nothing
 * settled to judge by (a load running, or another scope on screen).
 */
export function EmptySearchBanner({
  searches,
  sites,
  onOpenSettings,
}: {
  searches: readonly EmptyScopedSearch[] | null;
  sites: readonly SiteConfig[];
  onOpenSettings: () => void;
}): ReactElement | null {
  const key = JSON.stringify(searches);
  const [dismissed, setDismissed] = useState<string | null>(null);
  if (keptDismissal(dismissed, searches) !== dismissed) setDismissed(null);
  if (!searches?.length || dismissed === key) return null;
  const label = (id: string): string => sites.find((s) => s.id === id)?.label ?? id;
  return (
    <div className="banner warn actionable" role="status">
      <div className="banner-text">
        <strong>Nothing found in {searches.flatMap((s) => s.names).join(", ")}.</strong> GitHub leaves out what a token can&apos;t see,
        without an error. If that&apos;s private, check the token for {searches.map((s) => label(s.siteId)).join(", ")}: a classic token
        needs the repo scope and, for an org with SAML SSO, to be authorized for it (Configure SSO under your GitHub token settings); a
        fine-grained one needs access to the repository.
      </div>
      <div className="banner-actions">
        <button type="button" onClick={onOpenSettings}>
          Open Settings
        </button>
        <button
          type="button"
          onClick={() => {
            setDismissed(key);
          }}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
