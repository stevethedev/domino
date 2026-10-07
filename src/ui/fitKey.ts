/**
 * What the graph is fitted to: the scope and the grouping, which rearrange all of it. Filters,
 * folds and the sort move cards within the layout, so they keep the user's pan and zoom, as do
 * data updates within a scope (a refresh, cached tickets replaced by fresh ones, status history).
 */
export function fitKeyOf(scopeKey: string | null, groupBy: string): string {
  return JSON.stringify([scopeKey, groupBy]);
}
