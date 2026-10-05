import type { DominoConfig, SiteConfig } from "../config/types";
import type { Scope } from "../data/MultiSiteLoader";

/** The scope's fields in a fixed order, so equal scopes always serialize the same way. */
function canonicalScope(scope: Scope): Scope {
  switch (scope.mode) {
    case "jql":
      return { mode: "jql", jql: scope.jql };
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
  JSON.stringify({ sites: sites.map((s) => s.id).sort(), scope: canonicalScope(scope) });

/**
 * Everything a load's result depends on: the scope, where the data comes from, and each selected
 * site's address, account and filter. Every configured site's address counts too, because links
 * to them are matched by URL. Labels, colours and default selections don't count: changing them
 * redraws the graph without loading it again.
 */
export function loadKeyOf(config: DominoConfig, selected: readonly SiteConfig[], scope: Scope): string {
  return JSON.stringify({
    scope: scopeKeyOf(selected, scope),
    backend: config.backend,
    selected: selected.map((s) => [s.id, s.baseUrl, s.auth, s.baseJql ?? "", s.cloudId ?? ""]),
    all: config.sites.map((s) => [s.id, s.baseUrl]),
  });
}
