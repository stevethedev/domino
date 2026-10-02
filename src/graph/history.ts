import type { RawIssueChangeLog, RawStatusCategoryKey, RawStatusDef } from "../data/jiraTypes";
import { toDay, type StatusChange } from "./schedule";
import type { GraphNode, StatusCategory } from "./types";

const CATEGORY: Record<RawStatusCategoryKey, StatusCategory> = {
  new: "todo",
  indeterminate: "inprogress",
  done: "done",
  undefined: "unknown",
};

/**
 * Turns one site's raw changelogs into per-uid status-category transitions, oldest first.
 * Changelogs identify issues by Jira id and statuses by id, so both are resolved here;
 * changes to statuses the site doesn't list are matched by name, else dropped.
 */
export function toStatusHistory(
  logs: readonly RawIssueChangeLog[],
  statuses: readonly RawStatusDef[],
  nodes: readonly GraphNode[],
  siteId: string,
): Map<string, StatusChange[]> {
  const uidById = new Map(nodes.flatMap((n): [string, string][] => (n.siteId === siteId && n.jiraId ? [[n.jiraId, n.uid]] : [])));
  const byId = new Map(statuses.map((s) => [s.id, CATEGORY[s.statusCategory.key]]));
  const byName = new Map(statuses.map((s) => [s.name.toLowerCase(), CATEGORY[s.statusCategory.key]]));
  const out = new Map<string, StatusChange[]>();
  for (const log of logs) {
    const uid = uidById.get(log.issueId);
    if (!uid) continue;
    const changes = log.changeHistories
      .flatMap((h) =>
        h.items
          .filter((i) => i.fieldId === "status" || i.field?.toLowerCase() === "status")
          // `toString` is also an inherited Object member, so check it's really a string field.
          .map((i) => ({ created: h.created, category: (i.to && byId.get(i.to)) ?? byName.get((typeof i.toString === "string" ? i.toString : "").toLowerCase()) })),
      )
      .filter((c): c is { created: string | number; category: StatusCategory } => c.category !== undefined)
      .map((c) => ({ at: toDay(c.created), toCategory: c.category, sortKey: new Date(c.created).getTime() }))
      .sort((a, b) => a.sortKey - b.sortKey)
      .map(({ at, toCategory }) => ({ at, toCategory }));
    if (changes.length) out.set(uid, changes);
  }
  return out;
}
