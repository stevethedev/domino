import type { JiraSource } from "../JiraSource";
import type { RawIssue, RawIssueChangeLog, RawLinkType, RawPriority, RawRemoteLink, RawStatusDef, RawUser } from "../jiraTypes";
import type { GitHubApi } from "./GitHubApi";
import type { GhNode } from "./githubTypes";
import { inRepoScope, repoScopeOf } from "./query";
import { descriptionOf, GITHUB_LINK_TYPES, GITHUB_STATUSES, jiraLinksIn, keyOf, toRawIssue } from "./toRaw";

/**
 * Nodes kept for the follow-up calls a load makes (remote links), so they don't each cost a
 * request. Tickets and descriptions are always fetched afresh, and `clear` drops everything when the config or a
 * token changes, so nothing loaded with an old account is served again; replies to requests made before
 * the last `clear` are never kept either.
 */
const MAX_REMEMBERED = 5000;

/**
 * A JiraSource for GitHub sites: GitHub's issues and pull requests in Jira's shape (see toRaw.ts).
 * Queries are GitHub searches; there are no priorities, and no status history yet.
 */
export class GitHubSource implements JiraSource {
  private readonly remembered = new Map<string, GhNode>();
  /** Bumped by `clear`: a reply to a request made under an older generation isn't remembered. */
  private generation = 0;

  constructor(private readonly api: GitHubApi) {}

  /** The nodes as issues, remembered for follow-up calls if they were requested in the current generation. */
  private remember(siteId: string, nodes: readonly GhNode[], requestedIn: number): RawIssue[] {
    return nodes.flatMap((n) => {
      const issue = toRawIssue(n);
      if (!issue) return [];
      if (requestedIn !== this.generation) return [issue];
      const id = `${siteId}|${issue.key}`;
      this.remembered.delete(id); // re-inserted last, so the oldest go first
      this.remembered.set(id, n);
      if (this.remembered.size > MAX_REMEMBERED) this.remembered.delete(this.remembered.keys().next().value ?? "");
      return [issue];
    });
  }

  /** Forgets every remembered node. */
  clear(): void {
    this.generation++;
    this.remembered.clear();
  }

  /** The ticket, from GitHub (or, with `remembered`, from this load when it's known). */
  private async node(siteId: string, rawKey: string, remembered = false): Promise<GhNode> {
    const key = rawKey.toLowerCase();
    const known = remembered ? this.remembered.get(`${siteId}|${key}`) : undefined;
    if (known) return known;
    const requestedIn = this.generation;
    const nodes = await this.api.issues(siteId, [key]);
    // A renamed repo or transferred issue comes back under its new key, still saying what was asked for.
    const hit = nodes.find((n) => keyOf(n) === key || n.requestedKey?.toLowerCase() === key);
    if (!hit) throw new Error(`${key} does not exist, or the token can't see it`);
    this.remember(siteId, [hit], requestedIn);
    return hit;
  }

  async fetchByJql(siteId: string, query: string, maxResults?: number): Promise<RawIssue[]> {
    const requestedIn = this.generation;
    return this.remember(siteId, await this.api.search(siteId, query, maxResults), requestedIn);
  }

  async fetchByKeys(siteId: string, keys: readonly string[], filter?: string): Promise<RawIssue[]> {
    const scope = repoScopeOf(filter);
    const wanted = keys.filter((k) => inRepoScope(scope, k));
    if (!wanted.length) return [];
    const requestedIn = this.generation;
    // By the key GitHub answers with too: a renamed repo can land outside the filter.
    const found = (await this.api.issues(siteId, wanted)).filter((n) => inRepoScope(scope, keyOf(n) ?? ""));
    return this.remember(siteId, found, requestedIn);
  }

  async fetchEpic(siteId: string, key: string, filter?: string): Promise<{ epic: RawIssue; children: RawIssue[] }> {
    const requestedIn = this.generation;
    const [epic] = this.remember(siteId, [await this.node(siteId, key)], requestedIn);
    if (epic.fields.issuetype?.hierarchyLevel !== 1) throw new Error(`${key} has no sub-issues`);
    const scope = repoScopeOf(filter);
    const children = (await this.api.subIssues(siteId, epic.key)).filter((n) => inRepoScope(scope, keyOf(n) ?? ""));
    return { epic, children: this.remember(siteId, children, requestedIn) };
  }

  async fetchIssue(siteId: string, key: string): Promise<RawIssue> {
    const requestedIn = this.generation;
    const [issue] = this.remember(siteId, [await this.node(siteId, key)], requestedIn);
    return issue;
  }

  /** Asked afresh: the ticket may be a ghost now, its remembered body from an earlier load. */
  async fetchDescription(siteId: string, key: string): Promise<unknown> {
    return descriptionOf(await this.node(siteId, key));
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
