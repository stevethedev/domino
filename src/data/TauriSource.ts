import { invoke } from "@tauri-apps/api/core";
import type { JiraSource } from "./JiraSource";
import type { RawIssue, RawIssueChangeLog, RawLinkType, RawRemoteLink, RawStatusDef, RawUser } from "./jiraTypes";

/** Calls the Rust core, which holds credentials and talks to Jira (or the mock backend). */
export class TauriSource implements JiraSource {
  fetchByJql(siteId: string, jql: string, maxResults?: number): Promise<RawIssue[]> {
    return invoke("fetch_by_jql", { siteId, jql, maxResults });
  }
  fetchEpic(siteId: string, key: string, filter?: string): Promise<{ epic: RawIssue; children: RawIssue[] }> {
    return invoke("fetch_epic", { siteId, key, filter });
  }
  fetchIssue(siteId: string, key: string): Promise<RawIssue> {
    return invoke("fetch_issue", { siteId, key });
  }
  fetchRemoteLinks(siteId: string, key: string): Promise<RawRemoteLink[]> {
    return invoke("fetch_remote_links", { siteId, key });
  }
  async fetchStatusHistory(siteId: string, issueIds: readonly string[]): Promise<RawIssueChangeLog[]> {
    const res = await invoke<{ issueChangeLogs: RawIssueChangeLog[] }>("fetch_status_history", { siteId, issueIds });
    return res.issueChangeLogs;
  }
  fetchStatuses(siteId: string): Promise<RawStatusDef[]> {
    return invoke("fetch_statuses", { siteId });
  }
  fetchMyself(siteId: string): Promise<RawUser> {
    return invoke("fetch_myself", { siteId });
  }
  async fetchLinkTypes(siteId: string): Promise<RawLinkType[]> {
    const res = await invoke<{ issueLinkTypes: RawLinkType[] }>("fetch_link_types", { siteId });
    return res.issueLinkTypes;
  }
}
