import type { JiraSource } from "../JiraSource";
import type { RawIssue, RawIssueChangeLog, RawLinkType, RawPriority, RawRemoteLink, RawStatusDef, RawUser } from "../jiraTypes";
import type { GitHubApi } from "./GitHubApi";
import type { GhNode } from "./githubTypes";
import { inRepoScope, type RepoScope, repoScopeOf } from "./query";
import { descriptionOf, GITHUB_LINK_TYPES, GITHUB_STATUSES, hasSubIssues, jiraLinksIn, keyOf, toRawIssue } from "./toRaw";

/**
 * Nodes kept for the follow-up calls a load makes (remote links), so they don't each cost a
 * request. Tickets and descriptions are always fetched afresh, and `clear` drops everything when the config or a
 * token changes, so nothing loaded with an old account is served again; replies to requests made before
 * the last `clear` are never kept either.
 */
const MAX_REMEMBERED = 5000;

/** GitHub nests sub-issues at most this deep, which bounds the walk up to an epic. */
const MAX_SUB_ISSUE_DEPTH = 8;

/**
 * A JiraSource for GitHub sites: GitHub's issues and pull requests in Jira's shape (see toRaw.ts).
 * Queries are GitHub searches; there are no priorities, and no status history yet.
 */
export class GitHubSource implements JiraSource {
  /** Each remembered node with the number of the request that brought it. */
  private readonly remembered = new Map<string, Readonly<{ node: GhNode; request: number }>>();
  /** Requests are numbered in the order they're made. */
  private requests = 0;
  /** The last request made before `clear`: no reply to it or an earlier one is remembered. */
  private clearedAfter = 0;

  constructor(private readonly api: GitHubApi) {}

  private nextRequest(): number {
    return ++this.requests;
  }

  /**
   * The nodes as issues, remembered for follow-up calls unless they were requested before the last
   * `clear`, or a later request's reply is already remembered (an older one can finish last).
   */
  private remember(siteId: string, nodes: readonly GhNode[], request: number): RawIssue[] {
    return nodes.flatMap((n) => {
      const issue = toRawIssue(n);
      if (!issue) return [];
      const id = `${siteId}|${issue.key}`;
      if (request <= this.clearedAfter || (this.remembered.get(id)?.request ?? 0) > request) return [issue];
      this.remembered.delete(id); // re-inserted last, so the oldest go first
      this.remembered.set(id, { node: n, request });
      if (this.remembered.size > MAX_REMEMBERED) this.remembered.delete(this.remembered.keys().next().value ?? "");
      return [issue];
    });
  }

  /** Forgets every remembered node, and every reply still to come. */
  clear(): void {
    this.clearedAfter = this.requests;
    this.remembered.clear();
  }

  /** The ticket, from GitHub (or, with `remembered`, from this load when it's known). */
  private async node(siteId: string, rawKey: string, remembered = false): Promise<GhNode> {
    const hit = await this.lookup(siteId, rawKey, remembered);
    if (!hit) throw new Error(`${rawKey.toLowerCase()} does not exist, or the token can't see it`);
    return hit;
  }

  /** The ticket, or undefined when GitHub doesn't answer for it (it doesn't exist, or the token can't see it). */
  private async lookup(siteId: string, rawKey: string, remembered = false): Promise<GhNode | undefined> {
    const key = rawKey.toLowerCase();
    const known = remembered ? this.remembered.get(`${siteId}|${key}`)?.node : undefined;
    if (known) return known;
    const request = this.nextRequest();
    const nodes = await this.api.issues(siteId, [key]);
    // A renamed repo or transferred issue comes back under its new key, still saying what was asked for.
    const hit = nodes.find((n) => keyOf(n) === key || n.requestedKey?.toLowerCase() === key);
    if (hit) this.remember(siteId, [hit], request);
    return hit;
  }

  async fetchByJql(siteId: string, query: string, maxResults?: number): Promise<RawIssue[]> {
    const request = this.nextRequest();
    return this.remember(siteId, await this.api.search(siteId, query, maxResults), request);
  }

  /**
   * Asks only for keys inside the filter. A ticket GitHub answers under another key (a renamed repo)
   * comes back even when the new key is outside it, with the asked key as its alias: the loader puts
   * it on the site that covers the new name, or drops it.
   */
  async fetchByKeys(siteId: string, keys: readonly string[], filter?: string): Promise<RawIssue[]> {
    const wanted = keys.filter((k) => inRepoScope(repoScopeOf(filter), k));
    if (!wanted.length) return [];
    const request = this.nextRequest();
    return this.remember(siteId, await this.api.issues(siteId, wanted), request);
  }

  /** The ticket as an issue (remembered by `node`). */
  private async issue(siteId: string, key: string): Promise<RawIssue> {
    return this.asIssue(key, await this.node(siteId, key));
  }

  private asIssue(key: string, node: GhNode): RawIssue {
    const issue = toRawIssue(node);
    if (!issue) throw new Error(`${key} does not exist, or the token can't see it`);
    return issue;
  }

  async fetchEpic(siteId: string, key: string, filter?: string): Promise<{ epic: RawIssue; children: RawIssue[] }> {
    const node = await this.node(siteId, key);
    const epic = this.asIssue(key, node);
    if (!hasSubIssues(node)) throw new Error(`${key} has no sub-issues`);
    const scope = repoScopeOf(filter);
    const childrenRequest = this.nextRequest();
    const children = this.remember(
      siteId,
      (await this.api.subIssues(siteId, epic.key)).filter((n) => inRepoScope(scope, keyOf(n) ?? "")),
      childrenRequest,
    );
    return { epic, children: [...(await this.storiesUp(siteId, node, scope)), ...children] };
  }

  /**
   * A sub-issue with sub-issues of its own is a story, and so is each of its ancestors below the top
   * one: its sub-issues find their epic through them all, so they load too.
   */
  private async storiesUp(siteId: string, start: GhNode, scope: RepoScope): Promise<RawIssue[]> {
    const stories: RawIssue[] = [];
    let story: GhNode | undefined = start.parent ? start : undefined;
    while (story && stories.length < MAX_SUB_ISSUE_DEPTH) {
      const issue = toRawIssue(story);
      // Past the start, a story outside the site's filter (perhaps answering under a new key) ends the walk.
      const outside = stories.length > 0 && !inRepoScope(scope, issue?.key ?? "");
      if (!issue || outside || stories.some((s) => s.key === issue.key)) break;
      stories.push(issue);
      const parentKey = story.parent?.parent ? keyOf(story.parent) : null;
      // One the token can't see ends the walk too: the stories below it load, just not under the epic.
      story = parentKey && inRepoScope(scope, parentKey) ? await this.lookup(siteId, parentKey) : undefined;
    }
    return stories;
  }

  fetchIssue(siteId: string, key: string): Promise<RawIssue> {
    return this.issue(siteId, key);
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
