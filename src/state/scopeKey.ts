import { siteKindOf, type DominoConfig, type SiteConfig } from "../config/types";
import type { Scope } from "../data/MultiSiteLoader";

/**
 * The scope's fields in a fixed order, so equal scopes always serialize the same way. The GitHub
 * search counts only when a GitHub site is selected (only those run it), so Jira-only scopes keep
 * the keys they had before GitHub support.
 */
function canonicalScope(scope: Scope, sites: readonly SiteConfig[]): Scope {
  switch (scope.mode) {
    case "jql": {
      const github = sites.some((s) => siteKindOf(s) === "github") ? scope.github?.trim() : undefined;
      return github ? { mode: "jql", jql: scope.jql, github } : { mode: "jql", jql: scope.jql };
    }
    case "epic":
      return { mode: "epic", siteId: scope.siteId, key: scope.key };
    case "seed":
      return { mode: "seed", siteId: scope.siteId, key: scope.key, depth: scope.depth };
  }
}

/**
 * Stable identity of a scope: the selected sites plus the query or mode. Stored per scope by
 * "Since you last looked" and the ticket cache, so the format must not change.
 */
export const scopeKeyOf = (sites: readonly SiteConfig[], scope: Scope): string =>
  JSON.stringify({ sites: sites.map((s) => s.id).sort(), scope: canonicalScope(scope, sites) });

/**
 * Everything a load's result depends on: the scope, where the data comes from, and each selected
 * site's address, account and filter. Every configured site's address and filter count too: links
 * are matched to sites by URL, and on an address several sites share, by whose filter covers the
 * ticket (src/data/siteScope.ts). Labels, colours and default selections don't count: changing them
 * redraws the graph without loading it again.
 */
export function loadKeyOf(config: DominoConfig, selected: readonly SiteConfig[], scope: Scope): string {
  return JSON.stringify({
    scope: scopeKeyOf(selected, scope),
    backend: config.backend,
    selected: selected.map((s) => [s.id, s.baseUrl, s.auth, s.baseJql ?? "", s.cloudId ?? ""]),
    all: config.sites.map((s) => [s.id, s.baseUrl, s.baseJql ?? ""]),
  });
}
