import type { ViewFilters } from "../graph/visible";

/**
 * What the graph is fitted to: the scope and the view settings that rearrange it. The view fits
 * again only when this changes, so data updates within a scope (a refresh, cached tickets
 * replaced by fresh ones, status history arriving) keep the user's pan and zoom.
 */
export function fitKeyOf(scopeKey: string | null, groupBy: string, filters: ViewFilters, folded: ReadonlySet<string>): string {
  return JSON.stringify([scopeKey, groupBy, filters, [...folded].sort()]);
}
