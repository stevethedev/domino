/**
 * What the graph is fitted to: the scope and the grouping, which rearrange all of it. Filters,
 * folds and the sort move cards within the layout, so they keep the user's pan and zoom, as do
 * data updates within a scope (a refresh, cached tickets replaced by fresh ones, status history).
 */
export function fitKeyOf(scopeKey: string | null, groupBy: string): string {
  return JSON.stringify([scopeKey, groupBy]);
}

/**
 * Whether a finished layout is fitted: when it draws something, and the scope or grouping changed
 * (see `fitKeyOf`), the last layout drew nothing (filters hid every card), or the last layout's
 * fit is still waiting for its frame (this one is fitted in its place).
 */
export const fitsLayout = (l: Readonly<{ nothingDrawn: boolean; keyChanged: boolean; wasEmpty: boolean; fitWaiting: boolean }>): boolean =>
  !l.nothingDrawn && (l.keyChanged || l.wasEmpty || l.fitWaiting);
