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

const ORDER_BY = /\s+order\s+by\s+[\s\S]*$/i;

/** `(base) AND narrow`, keeping base's ORDER BY at the end. Either side may be blank. */
export function combineJql(base: string, narrow: string): string {
  const b = base.trim();
  const n = narrow.trim();
  if (!n) return b;
  if (!b) return n;
  const order = ORDER_BY.exec(` ${b}`)?.[0].trim() ?? "";
  const body = ` ${b}`.replace(ORDER_BY, "").trim();
  if (!body) return `${n} ${order}`.trim();
  return `(${body}) AND ${n}${order ? ` ${order}` : ""}`;
}
