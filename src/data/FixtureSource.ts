import type { JiraSource } from "./JiraSource";
import type { RawIssue, RawLinkType, RawRemoteLink } from "./jiraTypes";
import type { MockSite } from "./mockData";
import { combineJql } from "./jqlPresets";
import { matchesMockJql, parseMockJql } from "./mockJql";

/** In-memory JiraSource over fixture data. `failSites` simulate a site that is down. */
export class FixtureSource implements JiraSource {
  constructor(
    private readonly sites: Record<string, MockSite>,
    private readonly linkTypes: RawLinkType[],
    private readonly failSites: ReadonlySet<string> = new Set(),
  ) {}

  private site(siteId: string): MockSite {
    if (this.failSites.has(siteId)) throw new Error("Simulated outage (503 Service Unavailable)");
    const s = this.sites[siteId];
    if (!s) throw new Error("Could not connect: no mock data for this site");
    return s;
  }

  async fetchByJql(siteId: string, jql: string, maxResults?: number): Promise<RawIssue[]> {
    const clauses = parseMockJql(jql);
    const hits = this.site(siteId).issues.filter((i) => matchesMockJql(i, clauses));
    return maxResults === undefined ? hits : hits.slice(0, maxResults);
  }

  async fetchEpic(siteId: string, key: string, filter?: string) {
    const s = this.site(siteId);
    const epic = s.issues.find((i) => i.key === key);
    if (!epic) throw new Error(`Issue ${key} does not exist`);
    if (epic.fields.issuetype.name !== "Epic") throw new Error(`${key} is not an epic`);
    return { epic, children: await this.fetchByJql(siteId, combineJql(filter ?? "", `parent = ${key}`)) };
  }

  async fetchIssue(siteId: string, key: string): Promise<RawIssue> {
    const hit = this.site(siteId).issues.find((i) => i.key === key);
    if (!hit) throw new Error(`Issue ${key} does not exist`);
    return hit;
  }

  async fetchRemoteLinks(siteId: string, key: string): Promise<RawRemoteLink[]> {
    return this.site(siteId).remoteLinks[key] ?? [];
  }

  async fetchLinkTypes(siteId: string): Promise<RawLinkType[]> {
    this.site(siteId);
    return this.linkTypes;
  }
}
