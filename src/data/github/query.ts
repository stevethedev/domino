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
 * The site's filter and the query as one search: each its own group, ANDed (GitHub's advanced search),
 * so an `OR` in one can't reach past it.
 */
export function combineGitHubQuery(base: string, query: string): string {
  const parts = [base, query].map((s) => withLegacyScopes(balanced(termsOf(s)))).filter(Boolean);
  return parts.length === 2 ? parts.map((p) => `(${p})`).join(" ") : parts.join("");
}

/**
 * Filters written for the old search, which ORed repeated `org:` / `user:` / `repo:` qualifiers, keep
 * their meaning: advanced search ANDs them, so they're grouped with OR. A search that already uses
 * Boolean syntax goes as written.
 */
function withLegacyScopes(terms: readonly string[]): string {
  const scopes = isBoolean(terms) ? [] : terms.filter((t) => scopeTermOf(t)?.excluded === false);
  if (scopes.length < 2) return terms.join(" ");
  return [`(${scopes.join(" OR ")})`, ...terms.filter((t) => !scopes.includes(t))].join(" ");
}

/**
 * The terms with stray `)` dropped, an unclosed quote closed, and unclosed `(` closed (outside quoted
 * phrases), so grouping can't break them.
 */
function balanced(terms: readonly string[]): string[] {
  let depth = 0;
  const kept = terms.map((t) =>
    t.replace(/"[^"]*"?|[()]/g, (m) => {
      if (m === "(") depth++;
      else if (m === ")") {
        if (depth === 0) return "";
        depth--;
      }
      return m;
    }),
  );
  const out = kept.filter(Boolean);
  const last = out.at(-1) ?? "";
  const unclosedQuote = (last.match(/"/g)?.length ?? 0) % 2 === 1 ? '"' : "";
  if (depth === 0 && !unclosedQuote) return out;
  return [...out.slice(0, -1), `${last}${unclosedQuote}${")".repeat(depth)}`];
}

/** Whether a search's terms use Boolean operators or parentheses (outside quoted phrases). */
const isBoolean = (terms: readonly string[]): boolean =>
  terms.some((t) => /^(?:AND|OR|NOT)$/.test(t) || /[()]/.test(t.replace(/"[^"]*"?/g, "")));

/** A search's terms, each quoted phrase (an unclosed one runs to the end) part of its term, as written. */
const termsOf = (search: string): string[] => search.match(/(?:[^\s"]|"[^"]*"?)+/g) ?? [];

/** A search as GitHub's advanced search reads it: terms, AND (also implicit), OR, NOT and groups. */
export type SearchNode =
  | Readonly<{ kind: "term"; text: string }>
  | Readonly<{ kind: "and" | "or"; items: readonly SearchNode[] }>
  | Readonly<{ kind: "not"; item: SearchNode }>;

/** A search's tokens: its terms, with the parentheses written against them split off. */
function tokensOf(search: string): string[] {
  return termsOf(search).flatMap((t) => {
    const opens = /^\(*/.exec(t)?.[0].length ?? 0;
    const rest = t.slice(opens);
    const closes = /\)*$/.exec(rest)?.[0].length ?? 0;
    const middle = rest.slice(0, rest.length - closes);
    return [...Array<string>(opens).fill("("), ...(middle ? [middle] : []), ...Array<string>(closes).fill(")")];
  });
}

/** The search as a tree. OR binds loosest, then AND, then NOT; an unbalanced parenthesis is forgiven. */
export function parseSearch(search: string): SearchNode {
  const tokens = tokensOf(search);
  let at = 0;
  const group = (kind: "and" | "or", items: SearchNode[]): SearchNode => (items.length === 1 ? items[0] : { kind, items });
  const unary = (): SearchNode => {
    const t = tokens[at++];
    if (t === "NOT") return at < tokens.length && tokens[at] !== ")" ? { kind: "not", item: unary() } : group("and", []);
    if (t !== "(") return { kind: "term", text: t };
    const inner = or();
    if (at < tokens.length && tokens[at] === ")") at++;
    return inner;
  };
  const and = (): SearchNode => {
    const items: SearchNode[] = [];
    while (at < tokens.length && tokens[at] !== ")" && tokens[at] !== "OR") {
      if (tokens[at] === "AND") at++;
      else items.push(unary());
    }
    return group("and", items);
  };
  const or = (): SearchNode => {
    const items = [and()];
    while (at < tokens.length && tokens[at] === "OR") {
      at++;
      items.push(and());
    }
    return group("or", items);
  };
  const parts = [or()];
  while (at < tokens.length) {
    if (tokens[at] === ")") at++;
    else parts.push(or());
  }
  return group("and", parts);
}

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

type Names = Readonly<{ owners: ReadonlySet<string>; repos: ReadonlySet<string> }>;
/**
 * What a search allows, by repository: `only` null means any owner or repo (less what's excluded).
 * `exact` when that's all the search says (scope qualifiers, ORed): only then can NOT turn it around.
 */
type Bound = Readonly<{ only: Names | null; excluded: Names; exact: boolean }>;

const NONE: Names = { owners: new Set(), repos: new Set() };
const UNBOUNDED: Bound = { only: null, excluded: NONE, exact: false };
const union = (a: Names, b: Names): Names => ({ owners: new Set([...a.owners, ...b.owners]), repos: new Set([...a.repos, ...b.repos]) });
/** What both name: an owner both name, or a repo one names that the other names too, directly or by its owner. */
const both = (a: Names, b: Names): Names => {
  const covers = (n: Names, repo: string): boolean => n.repos.has(repo) || n.owners.has(repo.split("/")[0]);
  return {
    owners: new Set([...a.owners].filter((o) => b.owners.has(o))),
    repos: new Set([...[...a.repos].filter((r) => covers(b, r)), ...[...b.repos].filter((r) => covers(a, r))]),
  };
};
const isEmpty = (n: Names): boolean => n.owners.size === 0 && n.repos.size === 0;

/**
 * A bound that never shuts out what the search could match: an OR is bounded only if every branch is,
 * an AND of two bounds keeps both (a union, so broader than GitHub's, never narrower), and NOT turns
 * only an exact bound around (an inexact one says nothing about what NOT keeps).
 */
function boundOf(node: SearchNode): Bound {
  switch (node.kind) {
    case "term": {
      const t = scopeTermOf(node.text);
      if (!t) return UNBOUNDED;
      const names: Names =
        t.kind === "repo" ? { owners: new Set(), repos: new Set([t.value]) } : { owners: new Set([t.value]), repos: new Set() };
      return t.excluded ? { only: null, excluded: names, exact: true } : { only: names, excluded: NONE, exact: true };
    }
    case "and":
      return node.items.map(boundOf).reduce<Bound>(
        (a, b) => ({
          only: a.only && b.only ? union(a.only, b.only) : (a.only ?? b.only),
          excluded: union(a.excluded, b.excluded),
          exact: false,
        }),
        UNBOUNDED,
      );
    case "or": {
      const bounds = node.items.map(boundOf);
      const onlys = bounds.map((b) => b.only);
      return {
        only: onlys.every((o): o is Names => o !== null) ? onlys.reduce(union) : null,
        excluded: bounds.map((b) => b.excluded).reduce(both),
        exact: bounds.every((b) => b.exact),
      };
    }
    case "not": {
      const inner = boundOf(node.item);
      if (!inner.exact) return UNBOUNDED;
      if (inner.only) return isEmpty(inner.excluded) ? { only: null, excluded: inner.only, exact: true } : UNBOUNDED;
      return isEmpty(inner.excluded) ? UNBOUNDED : { only: inner.excluded, excluded: NONE, exact: true };
    }
  }
}

export function repoScopeOf(filter: string | undefined): RepoScope {
  const { only, excluded } = boundOf(parseSearch(filter ?? ""));
  if (!only && isEmpty(excluded)) return null;
  return {
    owners: only?.owners ?? new Set(),
    repos: only?.repos ?? new Set(),
    excludedOwners: excluded.owners,
    excludedRepos: excluded.repos,
  };
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
