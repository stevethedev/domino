import type { RawIssue, RawLinkType, RawRemoteLink } from "./jiraTypes";

/** Raw, Jira-shaped data access for one site at a time. */
export interface JiraSource {
  /** Pages through results; stops after `maxResults` so over-cap scopes fail fast. */
  fetchByJql(siteId: string, jql: string, maxResults?: number): Promise<RawIssue[]>;
  /** The epic itself plus its children (`parent = KEY`, ANDed with `filter` when given). */
  fetchEpic(siteId: string, key: string, filter?: string): Promise<{ epic: RawIssue; children: RawIssue[] }>;
  fetchIssue(siteId: string, key: string): Promise<RawIssue>;
  fetchRemoteLinks(siteId: string, key: string): Promise<RawRemoteLink[]>;
  fetchLinkTypes(siteId: string): Promise<RawLinkType[]>;
}
