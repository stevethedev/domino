// GitHub search strings: combining a site's filter with a query, and reading which repositories the
// filter keeps a load to.
import { parseGitHubKey } from "../ticketKey";

/** `base query`: GitHub ANDs search terms separated by spaces, so no parentheses are needed. */
export const combineGitHubQuery = (base: string, query: string): string => [base.trim(), query.trim()].filter(Boolean).join(" ");

/** The owners and repositories a search is limited to (`org:`, `user:`, `repo:`), or null when it names none. */
export type RepoScope = Readonly<{ owners: ReadonlySet<string>; repos: ReadonlySet<string> }> | null;

export function repoScopeOf(filter: string | undefined): RepoScope {
  const owners = new Set<string>();
  const repos = new Set<string>();
  for (const term of (filter ?? "").split(/\s+/)) {
    const m = /^(org|user|repo):(\S+)$/i.exec(term);
    if (!m) continue;
    if (m[1].toLowerCase() === "repo") repos.add(m[2].toLowerCase());
    else owners.add(m[2].toLowerCase());
  }
  return owners.size || repos.size ? { owners, repos } : null;
}

/**
 * Whether a linked ticket is inside the site's filter as far as its repository goes. GitHub can't
 * run "these numbers AND this search", so this is how linked tickets outside the filter stay ghosts.
 */
export function inRepoScope(scope: RepoScope, key: string): boolean {
  const k = parseGitHubKey(key);
  if (!k) return false;
  if (!scope) return true;
  return scope.owners.has(k.owner.toLowerCase()) || scope.repos.has(`${k.owner}/${k.repo}`.toLowerCase());
}
