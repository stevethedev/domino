// GitHub search strings: combining a site's filter with a query, and reading which repositories the
// filter keeps a load to.
import { parseGitHubKey } from "../ticketKey";

/** A term limiting a search to an owner or repository (`org:`, `user:`, `repo:`). */
const SCOPE_TERM = /^(org|user|repo):(\S+)$/i;

/**
 * `base query` as one search. GitHub has no parentheses and ORs repeated `org:` / `user:` / `repo:`
 * qualifiers, so when both name some, only the ones both allow are sent; null when they share none
 * (nothing can match). The loader still drops results outside the base's repos (see `inRepoScope`).
 */
export function combineGitHubQuery(base: string, query: string): string | null {
  const [b, q] = [termsOf(base), termsOf(query)];
  const [bScope, qScope] = [repoScopeOf(base), repoScopeOf(query)];
  const limits = (scope: RepoScope): boolean => scope !== null && (scope.owners.size > 0 || scope.repos.size > 0);
  if (!limits(bScope) || !limits(qScope)) return [...b, ...q].join(" ");
  const allows = (scope: RepoScope, repo: string): boolean => inRepoScope(scope, `${repo}#1`);
  const owners = [...b, ...q].flatMap((t) => {
    const m = SCOPE_TERM.exec(t);
    return m && m[1].toLowerCase() !== "repo" ? [{ kind: m[1].toLowerCase(), owner: m[2].toLowerCase() }] : [];
  });
  const sharedOwners = owners.filter(
    ({ owner }, i) => bScope?.owners.has(owner) && qScope?.owners.has(owner) && owners.findIndex((o) => o.owner === owner) === i,
  );
  const repos = [...new Set([...(bScope?.repos ?? []), ...(qScope?.repos ?? [])])].filter(
    (r) => allows(bScope, r) && allows(qScope, r) && !sharedOwners.some(({ owner }) => r.startsWith(`${owner}/`)),
  );
  const shared = [...sharedOwners.map(({ kind, owner }) => `${kind}:${owner}`), ...repos.map((r) => `repo:${r}`)];
  if (!shared.length) return null;
  return [...b, ...q]
    .filter((t) => !SCOPE_TERM.test(t))
    .concat(shared)
    .join(" ");
}

const termsOf = (search: string): string[] => search.split(/\s+/).filter(Boolean);

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
