import type { JiraSource } from "../JiraSource";
import type { RawIssue, RawIssueChangeLog, RawLinkType, RawPriority, RawRemoteLink, RawStatusDef, RawUser } from "../jiraTypes";
import type { GitHubApi } from "./GitHubApi";
import type { GhNode } from "./githubTypes";
import { inRepoScope, repoScopeOf } from "./query";
import { descriptionOf, GITHUB_LINK_TYPES, GITHUB_STATUSES, jiraLinksIn, keyOf, toRawIssue } from "./toRaw";

/**
 * Nodes kept for the follow-up calls a load makes (remote links, descriptions), so they don't each cost a
 * request. Tickets themselves are always fetched afresh, and `clear` drops everything when the config or a
 * token changes, so nothing loaded with an old account is served again.
 */
const MAX_REMEMBERED = 5000;

/**
 * A JiraSource for GitHub sites: GitHub's issues and pull requests in Jira's shape (see toRaw.ts).
 * Queries are GitHub searches; there are no priorities, and no status history yet.
 */
export class GitHubSource implements JiraSource {
  private readonly remembered = new Map<string, GhNode>();

  constructor(private readonly api: GitHubApi) {}

  private remember(siteId: string, nodes: readonly GhNode[]): RawIssue[] {
    return nodes.flatMap((n) => {
      const issue = toRawIssue(n);
      if (!issue) return [];
      const id = `${siteId}|${issue.key}`;
      this.remembered.delete(id); // re-inserted last, so the oldest go first
      this.remembered.set(id, n);
      if (this.remembered.size > MAX_REMEMBERED) this.remembered.delete(this.remembered.keys().next().value ?? "");
      return [issue];
    });
  }

  /** Forgets every remembered node. */
  clear(): void {
    this.remembered.clear();
  }

  /** The ticket, from GitHub (or, with `remembered`, from this load when it's known). */
  private async node(siteId: string, rawKey: string, remembered = false): Promise<GhNode> {
    const key = rawKey.toLowerCase();
    const known = remembered ? this.remembered.get(`${siteId}|${key}`) : undefined;
    if (known) return known;
    const hit = (await this.api.issues(siteId, [key])).find((n) => keyOf(n) === key);
    if (!hit) throw new Error(`${key} does not exist, or the token can't see it`);
    this.remember(siteId, [hit]);
    return hit;
  }

  async fetchByJql(siteId: string, query: string, maxResults?: number): Promise<RawIssue[]> {
    return this.remember(siteId, await this.api.search(siteId, query, maxResults));
  }

  async fetchByKeys(siteId: string, keys: readonly string[], filter?: string): Promise<RawIssue[]> {
    const scope = repoScopeOf(filter);
    const wanted = keys.filter((k) => inRepoScope(scope, k));
    return wanted.length ? this.remember(siteId, await this.api.issues(siteId, wanted)) : [];
  }

  async fetchEpic(siteId: string, key: string, filter?: string): Promise<{ epic: RawIssue; children: RawIssue[] }> {
    const [epic] = this.remember(siteId, [await this.node(siteId, key)]);
    if (epic.fields.issuetype?.hierarchyLevel !== 1) throw new Error(`${key} has no sub-issues`);
    const scope = repoScopeOf(filter);
    const children = (await this.api.subIssues(siteId, key)).filter((n) => inRepoScope(scope, keyOf(n) ?? ""));
    return { epic, children: this.remember(siteId, children) };
  }

  async fetchIssue(siteId: string, key: string): Promise<RawIssue> {
    const [issue] = this.remember(siteId, [await this.node(siteId, key)]);
    return issue;
  }

  async fetchDescription(siteId: string, key: string): Promise<unknown> {
    return descriptionOf(await this.node(siteId, key, true));
  }

  async fetchRemoteLinks(siteId: string, key: string): Promise<RawRemoteLink[]> {
    return jiraLinksIn(await this.node(siteId, key, true));
  }

  fetchLinkTypes(): Promise<RawLinkType[]> {
    return Promise.resolve([...GITHUB_LINK_TYPES]);
  }

  fetchPriorities(): Promise<RawPriority[]> {
    return Promise.resolve([]);
  }

  fetchStatusHistory(): Promise<RawIssueChangeLog[]> {
    return Promise.resolve([]);
  }

  fetchStatuses(): Promise<RawStatusDef[]> {
    return Promise.resolve([...GITHUB_STATUSES]);
  }

  async fetchMyself(siteId: string): Promise<RawUser> {
    const v = await this.api.viewer(siteId);
    if (!v.login) throw new Error("GitHub didn't say who the token belongs to");
    return { accountId: v.login, displayName: v.name || v.login, avatarUrls: v.avatarUrl ? { "48x48": v.avatarUrl } : undefined };
  }
}
