import type { RawIssue, RawIssueChangeLog, RawLinkType, RawRemoteLink, RawStatusDef, RawUser } from "./jiraTypes";

/** Raw, Jira-shaped data access for one site at a time. */
export interface JiraSource {
  /** Pages through results; stops after `maxResults` so over-cap scopes fail fast. */
  fetchByJql(siteId: string, jql: string, maxResults?: number): Promise<RawIssue[]>;
  /** The epic itself plus its children (`parent = KEY`, ANDed with `filter` when given). */
  fetchEpic(siteId: string, key: string, filter?: string): Promise<{ epic: RawIssue; children: RawIssue[] }>;
  fetchIssue(siteId: string, key: string): Promise<RawIssue>;
  fetchRemoteLinks(siteId: string, key: string): Promise<RawRemoteLink[]>;
  fetchLinkTypes(siteId: string): Promise<RawLinkType[]>;
  /** Status changes for these issues (Jira ids), all pages merged. */
  fetchStatusHistory(siteId: string, issueIds: readonly string[]): Promise<RawIssueChangeLog[]>;
  fetchStatuses(siteId: string): Promise<RawStatusDef[]>;
  /** The signed-in user on this site (`GET /myself`). */
  fetchMyself(siteId: string): Promise<RawUser>;
}
