// GitHub search strings: combining a site's filter with a query, and reading which repositories the
// filter keeps a load to.
import { parseGitHubKey } from "../ticketKey";

/**
 * `base query`. GitHub has no parentheses and ORs repeated `org:` / `repo:` / `user:` qualifiers, so this
 * alone can widen the base's repos; the loader drops results outside them (see `inRepoScope`).
 */
export const combineGitHubQuery = (base: string, query: string): string => [base.trim(), query.trim()].filter(Boolean).join(" ");

/**
 * The owners and repositories a search is limited to (`org:`, `user:`, `repo:`) and the ones it
 * excludes (`-org:`, `-user:`, `-repo:`), or null when it names none.
 */
export type RepoScope = Readonly<{
  owners: ReadonlySet<string>;
  repos: ReadonlySet<string>;
  excludedOwners: ReadonlySet<string>;
  excludedRepos: ReadonlySet<string>;
}> | null;

export function repoScopeOf(filter: string | undefined): RepoScope {
  const scope = {
    owners: new Set<string>(),
    repos: new Set<string>(),
    excludedOwners: new Set<string>(),
    excludedRepos: new Set<string>(),
  };
  for (const term of (filter ?? "").split(/\s+/)) {
    const m = /^(-?)(org|user|repo):(\S+)$/i.exec(term);
    if (!m) continue;
    const repo = m[2].toLowerCase() === "repo";
    const into = m[1] ? (repo ? scope.excludedRepos : scope.excludedOwners) : repo ? scope.repos : scope.owners;
    into.add(m[3].toLowerCase());
  }
  return Object.values(scope).some((s) => s.size > 0) ? scope : null;
}

/**
 * Whether a linked ticket is inside the site's filter as far as its repository goes. GitHub can't
 * run "these numbers AND this search", so this is how linked tickets outside the filter stay ghosts.
 */
export function inRepoScope(scope: RepoScope, key: string): boolean {
  const k = parseGitHubKey(key);
  if (!k) return false;
  if (!scope) return true;
  const owner = k.owner.toLowerCase();
  const repo = `${owner}/${k.repo.toLowerCase()}`;
  if (scope.excludedOwners.has(owner) || scope.excludedRepos.has(repo)) return false;
  return (scope.owners.size === 0 && scope.repos.size === 0) || scope.owners.has(owner) || scope.repos.has(repo);
}
