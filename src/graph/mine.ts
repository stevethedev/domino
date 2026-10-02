import type { GraphNode } from "./types";

/** The signed-in user's Jira account id per site id (sites where it's unknown are absent). */
export type Me = ReadonlyMap<string, string>;

/** Loaded issues assigned to / reported by the signed-in user on their own site. */
export type MyIssues = { assigned: ReadonlySet<string>; reported: ReadonlySet<string> };

export const NO_ISSUES: MyIssues = { assigned: new Set(), reported: new Set() };

/** Which loaded (non-ghost) issues are mine; identities are per site, so each issue is matched on its own site. */
export function myIssues(nodes: readonly GraphNode[], me: Me): MyIssues {
  const loaded = nodes.filter((n) => !n.ghost);
  const isMine = (n: GraphNode, accountId: string | undefined): boolean => accountId !== undefined && me.get(n.siteId) === accountId;
  return {
    assigned: new Set(loaded.filter((n) => isMine(n, n.assigneeAccountId)).map((n) => n.uid)),
    reported: new Set(loaded.filter((n) => isMine(n, n.reporterAccountId)).map((n) => n.uid)),
  };
}
