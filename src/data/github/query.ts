// GitHub search strings: combining a site's filter with a query, and reading which repositories the
// filter keeps a load to.
import { parseGitHubKey } from "../ticketKey";

/** `kind` is `org`, `user` or `repo`. */
type ScopeTerm = Readonly<{ excluded: boolean; kind: string; value: string }>;

/** A term limiting a search to (or, with `-`, excluding) an owner or repository, its value unquoted and lower-cased. */
function scopeTermOf(term: string): ScopeTerm | null {
  const m = /^(-?)(org|user|repo):(?:"([^"]*)"?|([^\s"]+))$/i.exec(term);
  const value = (m?.[3] ?? m?.[4] ?? "").toLowerCase();
  if (!m || !value) return null;
  return { excluded: m[1] === "-", kind: m[2].toLowerCase(), value };
}

/**
 * `base query` as one search. GitHub has no parentheses and ORs repeated `org:` / `user:` / `repo:`
 * qualifiers, so when both name some, only the ones both allow are sent; null when they share none
 * (nothing can match). The loader still drops results outside the base's repos (see `inRepoScope`).
 */
export function combineGitHubQuery(base: string, query: string): string | null {
  const [b, q] = [termsOf(base), termsOf(query)];
  const [bScope, qScope] = [repoScopeOf(base), repoScopeOf(query)];
  const limits = (scope: NonNullable<RepoScope>): boolean => scope.owners.size > 0 || scope.repos.size > 0;
  // A Boolean or grouped search can't be rewritten term by term: it goes as written, and the loader
  // keeps only results inside both scopes.
  if (!bScope || !qScope || !limits(bScope) || !limits(qScope) || isBoolean(b) || isBoolean(q)) return [...b, ...q].join(" ");
  const allows = (scope: RepoScope, repo: string): boolean => inRepoScope(scope, `${repo}#1`);
  const owners = [...b, ...q].flatMap((t) => {
    const term = scopeTermOf(t);
    return term && !term.excluded && term.kind !== "repo" ? [{ kind: term.kind, owner: term.value }] : [];
  });
  const sharedOwners = owners.filter(
    ({ owner }, i) => bScope.owners.has(owner) && qScope.owners.has(owner) && owners.findIndex((o) => o.owner === owner) === i,
  );
  const repos = [...new Set([...bScope.repos, ...qScope.repos])].filter(
    (r) => allows(bScope, r) && allows(qScope, r) && !sharedOwners.some(({ owner }) => r.startsWith(`${owner}/`)),
  );
  const shared = [...sharedOwners.map(({ kind, owner }) => `${kind}:${owner}`), ...repos.map((r) => `repo:${r}`)];
  if (!shared.length) return null;
  return [...b, ...q]
    .filter((t) => scopeTermOf(t)?.excluded ?? true)
    .concat(shared)
    .join(" ");
}

/** Whether a search's terms use Boolean operators or parentheses (outside quoted phrases). */
const isBoolean = (terms: readonly string[]): boolean =>
  terms.some((t) => /^(?:AND|OR|NOT)$/.test(t) || /[()]/.test(t.replace(/"[^"]*"?/g, "")));

/** A search's terms, each quoted phrase (an unclosed one runs to the end) part of its term, as written. */
const termsOf = (search: string): string[] => search.match(/(?:[^\s"]|"[^"]*"?)+/g) ?? [];

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
  for (const term of termsOf(filter ?? "").map(scopeTermOf)) {
    if (!term) continue;
    const repo = term.kind === "repo";
    const into = term.excluded ? (repo ? scope.excludedRepos : scope.excludedOwners) : repo ? scope.repos : scope.owners;
    into.add(term.value);
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
