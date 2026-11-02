// Which tickets a site's filter takes in, so sites sharing an address (one per org, repo or project)
// can each claim theirs: links and pasted URLs go to the site that covers them.
import { sameAddress } from "../config/schema";
import { siteKindOf, type SiteConfig } from "../config/types";
import { inRepoScope, type RepoScope, repoScopeOf } from "./github/query";
import { parseGitHubKey } from "./ticketKey";

/** How a site's filter takes in a ticket: it names the ticket's repo or project, lets anything through, or keeps it out. */
export type Coverage = "named" | "any" | "none";

const RANK: Readonly<Record<Coverage, number>> = { named: 2, any: 1, none: 0 };

type Scoped = Pick<SiteConfig, "kind" | "baseJql">;

const QUOTED = /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g;
/** Stands in for the n-th quoted string while the rest is read as syntax (a private-use character, never typed). */
const PLACEHOLDER = /^\uE000(\d+)\uE000$/;

/**
 * The Jira projects a filter is limited to (`project = X`, `project in (X, Y)`), or null when it can't
 * tell: no project clause, an OR or NOT (or `||`, `!`) that could reach past it, a negated project, an
 * unclosed quote, or a value that may be a project's name (keys are written in capitals; anything else
 * may be a name). With no OR, every project clause is ANDed: only the projects all of them allow come in.
 */
function jiraProjectsOf(jql: string | undefined): ReadonlySet<string> | null {
  const quoted: string[] = [];
  const masked = (jql ?? "").replace(QUOTED, (q) => `\uE000${quoted.push(q.slice(1, -1)) - 1}\uE000`);
  const where = masked.replace(/\border\s+by\b[\s\S]*$/i, "");
  // `!` on its own is NOT; in `!=` and `!~` it's part of a comparison.
  if (/["']|\bor\b|\|\||!(?![=~])|\bnot\s*(\(|project\b)|\bproject\s*(!=|not\s+in\b)/i.test(where)) return null;
  const operand = (v: string): string => {
    const at = PLACEHOLDER.exec(v.trim());
    return at ? quoted[Number(at[1])] : v.trim();
  };
  const clauses = [
    ...[...where.matchAll(/\bproject\s*=\s*([^\s()]+)/gi)].map((m) => [operand(m[1])]),
    ...[...where.matchAll(/\bproject\s+in\s*\(([^)]*)\)/gi)].map((m) => m[1].split(",").map(operand)),
  ];
  if (!clauses.length || !clauses.flat().every((k) => /^[A-Z][A-Z0-9_]*$/.test(k))) return null;
  return clauses.map((c) => new Set(c)).reduce((a, b) => new Set([...a].filter((k) => b.has(k))));
}

const namesRepo = (scope: RepoScope, owner: string, repo: string): boolean =>
  !!scope && (scope.owners.has(owner) || scope.repos.has(`${owner}/${repo}`));

export function coverageOf(site: Scoped, key: string): Coverage {
  if (siteKindOf(site) === "github") {
    const scope = repoScopeOf(site.baseJql);
    if (!inRepoScope(scope, key)) return "none";
    const k = parseGitHubKey(key);
    return k && namesRepo(scope, k.owner.toLowerCase(), k.repo.toLowerCase()) ? "named" : "any";
  }
  const projects = jiraProjectsOf(site.baseJql);
  if (!projects) return "any";
  return projects.has(key.split("-")[0].toUpperCase()) ? "named" : "none";
}

/**
 * The site among `sites` (all on one address) a ticket belongs to. A link stays on `from` when its
 * filter takes the ticket in; otherwise, and for a ticket with no starting site, it goes to the site
 * whose filter names it, then one that lets it through, then (covered by none) `from` or the first site.
 */
export function siteForKey<S extends Scoped>(sites: readonly S[], key: string, from?: S): S | undefined {
  if (sites.length < 2) return from ?? sites[0]; // nothing to choose between: skip reading filters
  if (from && coverageOf(from, key) !== "none") return from;
  let best: S | undefined;
  for (const s of sites) {
    if (RANK[coverageOf(s, key)] > RANK[best ? coverageOf(best, key) : "none"]) best = s;
  }
  return best ?? from ?? sites[0];
}

/** The sites sharing `site`'s address and kind, `site` among them. */
export const siblingsOf = (site: SiteConfig, sites: readonly SiteConfig[]): readonly SiteConfig[] =>
  sites.filter((s) => sameAddress(s, site) && siteKindOf(s) === siteKindOf(site));

/** The site a ticket linked from one on `from` belongs to: `from`, or the site on its address that covers it. */
export const linkedSite = (from: SiteConfig, key: string, sites: readonly SiteConfig[]): SiteConfig =>
  siteForKey(siblingsOf(from, sites), key, from) ?? from;

/** One id for all the sites on `site`'s address, so a link they each see on that instance counts once. */
export const addressId = (site: SiteConfig, sites: readonly SiteConfig[]): string => (siblingsOf(site, sites)[0] ?? site).id;

type Scope = NonNullable<RepoScope>;
const namesAny = (s: Scope): boolean => s.owners.size > 0 || s.repos.size > 0;

/** Whether both filters let in some repository of an owner or a repository `a` names. */
function shareNamed(a: Scope, b: Scope): boolean {
  const both = (repo: string): boolean => inRepoScope(a, `${repo}#1`) && inRepoScope(b, `${repo}#1`);
  const ownerShared = (o: string): boolean =>
    !a.excludedOwners.has(o) &&
    !b.excludedOwners.has(o) &&
    (b.owners.has(o) || !namesAny(b) || [...b.repos].some((r) => r.startsWith(`${o}/`) && both(r)));
  return [...a.owners].some(ownerShared) || [...a.repos].some(both);
}

/**
 * Whether two sites on one address could both load the same ticket (it'd show twice). Errs toward
 * yes: filters it can't read count as overlapping.
 */
export function filtersOverlap(a: SiteConfig, b: SiteConfig): boolean {
  if (siteKindOf(a) !== "github") {
    const pa = jiraProjectsOf(a.baseJql);
    const pb = jiraProjectsOf(b.baseJql);
    return !pa || !pb || [...pa].some((p) => pb.has(p));
  }
  const sa = repoScopeOf(a.baseJql);
  const sb = repoScopeOf(b.baseJql);
  if (!sa || !sb) return true;
  if (!namesAny(sa) && !namesAny(sb)) return true; // both "anything but …"
  return shareNamed(sa, sb) || shareNamed(sb, sa);
}

/** The other sites on `site`'s address whose filters could load tickets it loads too (they'd show twice). */
export const overlappingSites = (site: SiteConfig, others: readonly SiteConfig[]): readonly SiteConfig[] =>
  siblingsOf(site, others).filter((o) => filtersOverlap(site, o));
