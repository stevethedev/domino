// Maps GitHub's issues and pull requests onto the Jira-shaped model the loader and graph read, so a
// GitHub site loads, links and draws like any Jira site.
import { Marked } from "marked";
import type {
  RawIssue,
  RawIssueLink,
  RawIssueType,
  RawLinkedIssue,
  RawLinkType,
  RawRemoteLink,
  RawStatus,
  RawStatusDef,
  RawUser,
  RawVersion,
} from "../jiraTypes";
import { gitHubKey, parseGitHubKey } from "../ticketKey";
import type { GhConnection, GhLinked, GhNode, GhUser } from "./githubTypes";

const category = {
  todo: { key: "new", name: "To Do" },
  doing: { key: "indeterminate", name: "In Progress" },
  done: { key: "done", name: "Done" },
} as const;

const STATUSES = {
  open: { id: "gh-open", name: "Open", statusCategory: category.todo },
  closed: { id: "gh-closed", name: "Closed", statusCategory: category.done },
  notPlanned: { id: "gh-not-planned", name: "Not planned", statusCategory: category.done },
  draft: { id: "gh-draft", name: "Draft", statusCategory: category.doing },
  inReview: { id: "gh-in-review", name: "In review", statusCategory: category.doing },
  approved: { id: "gh-approved", name: "Approved", statusCategory: category.doing },
  changesRequested: { id: "gh-changes-requested", name: "Needs changes", statusCategory: category.doing },
  merged: { id: "gh-merged", name: "Merged", statusCategory: category.done },
} satisfies Record<string, RawStatus & RawStatusDef>;

/** Every status a GitHub ticket can have, for the status filter (`GET /status` on Jira). */
export const GITHUB_STATUSES: readonly RawStatusDef[] = Object.values(STATUSES);

const LINK_TYPES = {
  blocks: { id: "gh-blocks", name: "Blocks", inward: "is blocked by", outward: "blocks" },
  closes: { id: "gh-closes", name: "Closes", inward: "is closed by", outward: "closes" },
  relates: { id: "gh-relates", name: "Relates", inward: "relates to", outward: "relates to" },
} satisfies Record<string, RawLinkType>;

/** How GitHub tickets link: dependencies, pull requests closing issues, and mentions. */
export const GITHUB_LINK_TYPES: readonly RawLinkType[] = Object.values(LINK_TYPES);

const isPull = (t: GhLinked): boolean => t.__typename === "PullRequest";

/** `owner/repo#12`, or null when the node is missing its repository or number. */
export function keyOf(t: GhLinked | null | undefined): string | null {
  const repo = t?.repository?.nameWithOwner;
  return repo && typeof t.number === "number" ? gitHubKey(repo, t.number) : null;
}

/**
 * An open pull request's review state: GitHub's decision when the base branch's rules make one, else
 * from the reviewers' latest verdicts (any change request outweighs approvals, as on GitHub).
 */
function reviewStatusOf(t: Pick<GhNode, "reviewDecision" | "latestOpinionatedReviews">): RawStatus {
  const decision =
    t.reviewDecision ??
    (["CHANGES_REQUESTED", "APPROVED"] as const).find((v) => t.latestOpinionatedReviews?.nodes?.some((r) => r?.state === v));
  if (decision === "APPROVED") return STATUSES.approved;
  return decision === "CHANGES_REQUESTED" ? STATUSES.changesRequested : STATUSES.inReview;
}

/** A linked ticket carries no reviews, so a linked open pull request reads "In review" until it's loaded. */
function statusOf(t: GhLinked & Pick<GhNode, "reviewDecision" | "latestOpinionatedReviews">): RawStatus {
  if (isPull(t)) {
    if (t.merged || t.pullState === "MERGED") return STATUSES.merged;
    if (t.pullState === "CLOSED") return STATUSES.closed;
    return t.isDraft ? STATUSES.draft : reviewStatusOf(t);
  }
  if (t.state !== "CLOSED") return STATUSES.open;
  return t.stateReason === "NOT_PLANNED" || t.stateReason === "DUPLICATE" ? STATUSES.notPlanned : STATUSES.closed;
}

/**
 * A top-level issue with sub-issues stands in for an epic: Domino groups its sub-issues under it. A
 * sub-issue that has its own sub-issues is a story, so those group under the top issue too.
 */
const EPIC_LEVEL = 1;
/** Every other issue, set outright so a custom issue type named "Epic" can't make it one. */
const STORY_LEVEL = 0;

export const hasSubIssues = (t: GhNode): boolean => (t.subIssuesSummary?.total ?? 0) > 0;

function typeOf(t: GhNode): RawIssueType {
  if (isPull(t)) return { name: "Pull request" };
  const name = t.issueType?.name ?? "Issue";
  return { name, hierarchyLevel: hasSubIssues(t) && !t.parent ? EPIC_LEVEL : STORY_LEVEL };
}

function linked(t: GhLinked, key: string, epic = false): RawLinkedIssue {
  return {
    id: key,
    key,
    fields: {
      summary: t.title ?? key,
      status: statusOf(t),
      issuetype: isPull(t) ? { name: "Pull request" } : { name: "Issue", hierarchyLevel: epic ? EPIC_LEVEL : STORY_LEVEL },
    },
  };
}

function userOf(u: GhUser | null | undefined): RawUser | null {
  if (!u?.login) return null;
  return { accountId: u.login, displayName: u.name || u.login, avatarUrls: u.avatarUrl ? { "48x48": u.avatarUrl } : undefined };
}

const nodesOf = <T>(c: GhConnection<T> | undefined): T[] => (c?.nodes ?? []).filter((n): n is T => n !== null && n !== undefined);

function releasesOf(t: GhNode): RawVersion[] | undefined {
  const m = t.milestone;
  if (!m?.id || !m.title) return undefined;
  return [{ id: m.id, name: m.title, releaseDate: m.dueOn?.slice(0, 10), released: m.state === "CLOSED" }];
}

/**
 * GitHub tickets the shown body mentions, outside code: by URL on the ticket's own host
 * (`…/owner/repo/issues/12`, `…/pull/12/files`) or as `owner/repo#12` within the ticket's own owner
 * (`docs/readme#2` is a path as often as a ticket). Bare `#12` doesn't count either: it reads as a
 * number as often as a ticket. GitHub records these only on the mentioned ticket.
 */
function mentionsIn(t: GhNode, self: string): string[] {
  const body = t.body ?? t.bodyText;
  if (!body) return [];
  const text = shownMarkdown(body, true);
  const owner = self.split("/")[0];
  const host = /^https:\/\/([^/]+)\//.exec(t.url ?? "")?.[1] ?? "github.com";
  const keys = new Set<string>();
  const add = (repo: string, number: string): void => {
    const key = gitHubKey(repo, Number(number));
    if (parseGitHubKey(key)) keys.add(key);
  };
  const escapedHost = host.replace(/[.*+?^$()|[\]\\{}]/g, "\\$&");
  const urls = new RegExp(String.raw`https://${escapedHost}/([\w.-]+/[\w.-]+)/(?:issues|pull)/(\d+)(?![\w-])`, "gi");
  for (const m of text.matchAll(urls)) add(m[1], m[2]);
  for (const m of text.matchAll(/(?<![\w./#-])([A-Za-z0-9-]+)\/([\w.-]+)#(\d+)(?!\w)/g)) {
    if (m[1].toLowerCase() === owner) add(`${m[1]}/${m[2]}`, m[3]);
  }
  return [...keys];
}

/**
 * The open pull requests whose head branch is a stacked pull request's base branch: the ones it builds
 * on. A pull request into the default branch is stacked on nothing, even when a release pull request
 * from that branch is open, so it has no such connection.
 */
function stackConnection(t: GhNode): GhConnection<GhLinked> | undefined {
  if (!isPull(t) || !t.baseRefName || t.baseRefName === t.repository?.defaultBranchRef?.name) return undefined;
  return t.baseRef?.associatedPullRequests;
}

const stackedOn = (t: GhNode): GhLinked[] => nodesOf(stackConnection(t)).filter(isPull);

/**
 * The node's links, in Jira's shape: `outwardIssue` when this ticket is the source ("blocks",
 * "closes"), `inwardIssue` when it's the target. Link ids are built from both ends, so the copy of a
 * link GitHub reports on each of them collapses into one edge.
 */
function linksOf(t: GhNode, self: string): RawIssueLink[] {
  const links = new Map<string, RawIssueLink>();
  const add = (type: RawLinkType, other: GhLinked | null | undefined, selfIsSource: boolean): void => {
    const otherKey = keyOf(other);
    if (!other || !otherKey || otherKey === self) return;
    const [from, to] = selfIsSource ? [self, otherKey] : [otherKey, self];
    // Mentions have no direction: either end builds the same id.
    const id = type === LINK_TYPES.relates ? `relates:${[self, otherKey].sort().join("|")}` : `${type.name.toLowerCase()}:${from}>${to}`;
    if (links.has(id)) return;
    const end = linked(other, otherKey);
    links.set(id, { id, type, ...(selfIsSource ? { outwardIssue: end } : { inwardIssue: end }) });
  };
  for (const b of nodesOf(t.blockedBy)) add(LINK_TYPES.blocks, b, false);
  for (const b of nodesOf(t.blocking)) add(LINK_TYPES.blocks, b, true);
  for (const b of stackedOn(t)) add(LINK_TYPES.blocks, b, false);
  for (const issue of nodesOf(t.closingIssuesReferences)) add(LINK_TYPES.closes, issue, true);
  // A pull request that closes an issue when merged: by "fixes #12" (a cross-reference that will close it),
  // or linked from the sidebar. Sidebar links can be undone, so connections are replayed in timeline order
  // and only the ones still standing count; on a timeline cut short, the undoing may be on a page not
  // fetched, so its connections don't count at all.
  const closesOrRelates = (other: GhLinked): void => {
    if (isPull(other) !== isPull(t)) add(LINK_TYPES.closes, other, isPull(t));
    else add(LINK_TYPES.relates, other, true);
  };
  const connected = new Map<string, GhLinked | null>();
  for (const item of nodesOf(t.timelineItems)) {
    if (item.__typename === "CrossReferencedEvent") {
      if (item.source && item.willCloseTarget === true && isPull(item.source) !== isPull(t)) add(LINK_TYPES.closes, item.source, isPull(t));
      else if (item.source) add(LINK_TYPES.relates, item.source, true);
      continue;
    }
    const otherKey = keyOf(item.subject);
    if (item.subject && otherKey) connected.set(otherKey, item.__typename === "ConnectedEvent" ? item.subject : null);
  }
  if (t.timelineItems?.pageInfo?.hasNextPage !== true) for (const other of connected.values()) if (other) closesOrRelates(other);
  // Mentions, last: a ticket already linked another way (a PR that closes it) keeps just that link.
  const linkedKeys = new Set([...links.values()].map((l) => (l.outwardIssue ?? l.inwardIssue)?.key));
  for (const other of mentionsIn(t, self)) {
    if (other === self || linkedKeys.has(other)) continue;
    const id = `relates:${[self, other].sort().join("|")}`;
    // Only the key is known: the status is left out rather than guessed.
    links.set(id, { id, type: LINK_TYPES.relates, outwardIssue: { id: other, key: other, fields: { summary: other } } });
  }
  return [...links.values()];
}

/** The node as a Jira issue keyed `owner/repo#12`, or null when it lacks a repository or number. */
export function toRawIssue(t: GhNode): RawIssue | null {
  const key = keyOf(t);
  if (!key) return null;
  const parentKey = keyOf(t.parent);
  const asked = t.requestedKey?.toLowerCase();
  const assignees = nodesOf(t.assignees).flatMap((u) => userOf(u) ?? []);
  const others = assignees.slice(1);
  return {
    id: t.id ?? key,
    key,
    self: t.url,
    ...(asked && asked !== key ? { aliases: [asked] } : {}),
    ...(others.length > 0 ? { otherAssignees: others.flatMap((u) => u.accountId ?? []) } : {}),
    ...([t.timelineItems, t.blockedBy, t.blocking, t.closingIssuesReferences, stackConnection(t)].some(
      (c) => c?.pageInfo?.hasNextPage === true,
    )
      ? { linksIncomplete: true }
      : {}),
    fields: {
      summary: t.title ?? key,
      issuetype: typeOf(t),
      status: statusOf(t),
      assignee: assignees.length > 0 ? assignees[0] : null,
      reporter: userOf(t.author),
      resolutiondate: t.closedAt ?? null,
      created: t.createdAt,
      fixVersions: releasesOf(t),
      // A parent has sub-issues by definition, so it's an epic unless it's a sub-issue itself.
      parent: t.parent && parentKey ? linked(t.parent, parentKey, !t.parent.parent) : undefined,
      issuelinks: linksOf(t, key),
    },
  };
}

/** A token field as a string: marked types a token's fields loosely (`any`), so check rather than trust them. */
const stringOf = (v: unknown): string => (typeof v === "string" ? v : "");

/** Our own parser, so another module's `marked.use()` can't change what counts as code or a comment. */
const markdown = new Marked();

/** HTML comments, as GitHub hides them; an unclosed one runs to the end of its block. */
const HTML_COMMENT = /<!--[\s\S]*?(?:-->|$)/g;

/**
 * The Markdown GitHub shows, as plain text plus link targets: CommonMark (via marked) decides what is
 * a code block or a comment, so fenced and indented code (in lists and quotes too) and HTML comments
 * drop out. Inline code and image targets stay unless `forReferences`: GitHub shows them, but doesn't
 * make ticket references from them.
 */
function shownMarkdown(body: string, forReferences = false): string {
  const parts: string[] = [];
  void markdown.walkTokens(markdown.lexer(body), (token) => {
    if (token.type === "link" || (token.type === "image" && !forReferences)) parts.push(stringOf(token.href));
    else if (token.type === "html") parts.push(stringOf(token.text).replace(HTML_COMMENT, ""));
    else if (token.type === "codespan") {
      if (!forReferences) parts.push(stringOf(token.text));
    } else if ((token.type === "text" || token.type === "escape") && !("tokens" in token && token.tokens)) {
      parts.push(stringOf(token.text));
    }
  });
  return parts.join("\n");
}

/** Jira tickets the body links to (`https://…/browse/KEY`), as remote links that relate to them. */
export function jiraLinksIn(t: GhNode): RawRemoteLink[] {
  const key = keyOf(t);
  // The Markdown: rendered text drops the URL behind `[CORE-11](https://…)`. What GitHub doesn't show
  // (PR template comments, fenced code) doesn't count.
  const body = t.body ?? t.bodyText;
  const text = body && shownMarkdown(body);
  if (!key || !text) return [];
  const urls = new Set<string>();
  // The whole key: `/browse/CORE-11-extra` or `/browse/CORE-11/sub` isn't a link to CORE-11.
  for (const m of text.matchAll(/https:\/\/[A-Za-z0-9.-]+(?::\d+)?\/browse\/[A-Za-z][A-Za-z0-9_]*-\d+(?![\w-]|\/[\w-])/g)) {
    urls.add(m[0]);
  }
  return [...urls].map((url) => ({
    id: remoteId(`${key} ${url}`),
    relationship: "relates to",
    object: { url, title: url.split("/").pop() },
  }));
}

/** A stable number for a synthetic remote link (FNV-1a), unique enough to key its edge. */
function remoteId(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** The body as a minimal Atlassian Document (paragraphs of plain text), so the details panel renders it as-is. */
export function descriptionOf(t: GhNode): unknown {
  const text = t.bodyText?.trim();
  if (!text) return null;
  const paragraph = (p: string): unknown => ({
    type: "paragraph",
    content: p
      .split("\n")
      .flatMap((line, i) => [...(i > 0 ? [{ type: "hardBreak" }] : []), ...(line ? [{ type: "text", text: line }] : [])]),
  });
  return { type: "doc", version: 1, content: text.split(/\n{2,}/).map(paragraph) };
}
