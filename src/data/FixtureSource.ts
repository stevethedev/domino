import type { JiraSource } from "./JiraSource";
import type { RawIssue, RawIssueChangeLog, RawLinkType, RawRemoteLink, RawStatusDef } from "./jiraTypes";
import type { MockSite } from "./mockData";
import { combineJql } from "./jqlPresets";
import { matchesMockJql, parseMockJql } from "./mockJql";

/** Runs `fn` as an async method body would: a throw becomes a rejection, never a synchronous exception. */
const settle = <T,>(fn: () => T): Promise<T> => new Promise((resolve) => { resolve(fn()); });

/** In-memory JiraSource over fixture data. `failSites` simulate a site that is down. */
export class FixtureSource implements JiraSource {
  constructor(
    private readonly sites: Readonly<Partial<Record<string, MockSite>>>,
    private readonly linkTypes: RawLinkType[],
    private readonly failSites: ReadonlySet<string> = new Set(),
  ) {}

  private site(siteId: string): MockSite {
    if (this.failSites.has(siteId)) throw new Error("Simulated outage (503 Service Unavailable)");
    const s = this.sites[siteId];
    if (!s) throw new Error("Could not connect: no mock data for this site");
    return s;
  }

  fetchByJql(siteId: string, jql: string, maxResults?: number): Promise<RawIssue[]> {
    return settle(() => {
      const clauses = parseMockJql(jql);
      const hits = this.site(siteId).issues.filter((i) => matchesMockJql(i, clauses));
      return maxResults === undefined ? hits : hits.slice(0, maxResults);
    });
  }

  async fetchEpic(siteId: string, key: string, filter?: string): Promise<{ epic: RawIssue; children: RawIssue[] }> {
    const s = this.site(siteId);
    const epic = s.issues.find((i) => i.key === key);
    if (!epic) throw new Error(`Issue ${key} does not exist`);
    if (epic.fields.issuetype?.name !== "Epic") throw new Error(`${key} is not an epic`);
    return { epic, children: await this.fetchByJql(siteId, combineJql(filter ?? "", `parent = ${key}`)) };
  }

  fetchIssue(siteId: string, key: string): Promise<RawIssue> {
    return settle(() => {
      const hit = this.site(siteId).issues.find((i) => i.key === key);
      if (!hit) throw new Error(`Issue ${key} does not exist`);
      return hit;
    });
  }

  fetchRemoteLinks(siteId: string, key: string): Promise<RawRemoteLink[]> {
    return settle(() => this.site(siteId).remoteLinks[key] ?? []);
  }

  fetchStatusHistory(siteId: string, issueIds: readonly string[]): Promise<RawIssueChangeLog[]> {
    return settle(() => {
      const logs = this.site(siteId).changelogs ?? {};
      return issueIds.flatMap((id) => {
        const changeHistories = logs[id];
        return changeHistories ? [{ issueId: id, changeHistories }] : [];
      });
    });
  }

  fetchStatuses(siteId: string): Promise<RawStatusDef[]> {
    return settle(() => this.site(siteId).statuses ?? []);
  }

  fetchLinkTypes(siteId: string): Promise<RawLinkType[]> {
    return settle(() => {
      this.site(siteId);
      return this.linkTypes;
    });
  }
}
