/** One-click queries for the top bar. Each is ANDed onto every selected site's "Always filter by" JQL. */
export type JqlPreset = { id: string; label: string; jql: string };

export const JQL_PRESETS: readonly JqlPreset[] = [
  {
    id: "open-blockers",
    label: "Open with blocking links (30 days)",
    jql: 'statusCategory != Done AND issueLinkType in (blocks, "is blocked by") AND updated >= -30d',
  },
  { id: "open-recent", label: "Open, updated in 14 days", jql: "statusCategory != Done AND updated >= -14d" },
  { id: "sprint", label: "Open in current sprint", jql: "sprint in openSprints() AND statusCategory != Done" },
  { id: "mine", label: "Assigned to me, not done", jql: "assignee = currentUser() AND statusCategory != Done" },
  { id: "all", label: "Everything the site filter allows", jql: "" },
];

export const DEFAULT_PRESET_ID = "open-blockers";

export const presetById = (id: string | undefined) => JQL_PRESETS.find((p) => p.id === id) ?? JQL_PRESETS[0];

const ORDER_BY = /(?:^|\s+)order\s+by\s+[\s\S]*$/i;

function splitOrderBy(jql: string): [where: string, orderBy: string] {
  const t = jql.trim();
  const m = ORDER_BY.exec(t);
  return m ? [t.slice(0, m.index).trim(), m[0].trim()] : [t, ""];
}

/**
 * `(base) AND (query)`. Both sides are parenthesized because Jira's AND binds tighter than OR:
 * without them, `project = A AND x OR y` would match `y` across the whole site. ORDER BY is
 * lifted out of both sides (the query's wins) since it can't appear inside parentheses.
 */
export function combineJql(base: string, query: string): string {
  const [b, bOrder] = splitOrderBy(base);
  const [q, qOrder] = splitOrderBy(query);
  const where = b && q ? `(${b}) AND (${q})` : b || q;
  return [where, qOrder || bOrder].filter(Boolean).join(" ");
}
