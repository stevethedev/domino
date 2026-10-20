// Maps GitHub's issues and pull requests onto the Jira-shaped model the loader and graph read, so a
// GitHub site loads, links and draws like any Jira site.
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
import { gitHubKey, JIRA_KEY_RE } from "../ticketKey";
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

function statusOf(t: GhLinked): RawStatus {
  if (isPull(t)) {
    if (t.merged || t.state === "MERGED") return STATUSES.merged;
    if (t.state === "CLOSED") return STATUSES.closed;
    return t.isDraft ? STATUSES.draft : STATUSES.inReview;
  }
  if (t.state !== "CLOSED") return STATUSES.open;
  return t.stateReason === "NOT_PLANNED" || t.stateReason === "DUPLICATE" ? STATUSES.notPlanned : STATUSES.closed;
}

/** An issue with sub-issues stands in for an epic: Domino groups its sub-issues under it. */
const EPIC_LEVEL = 1;

function typeOf(t: GhNode): RawIssueType {
  if (isPull(t)) return { name: "Pull request" };
  const name = t.issueType?.name ?? "Issue";
  return (t.subIssuesSummary?.total ?? 0) > 0 ? { name, hierarchyLevel: EPIC_LEVEL } : { name };
}

function linked(t: GhLinked, key: string, parent = false): RawLinkedIssue {
  return {
    id: key,
    key,
    fields: {
      summary: t.title ?? key,
      status: statusOf(t),
      // A parent has sub-issues by definition, so it's an epic.
      issuetype: isPull(t) ? { name: "Pull request" } : parent ? { name: "Issue", hierarchyLevel: EPIC_LEVEL } : { name: "Issue" },
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
  for (const issue of nodesOf(t.closingIssuesReferences)) add(LINK_TYPES.closes, issue, true);
  for (const item of nodesOf(t.timelineItems)) {
    const other = item.__typename === "CrossReferencedEvent" ? item.source : item.subject;
    if (!other) continue;
    // A pull request linked to an issue (from its sidebar, or by "fixes #12") closes it when merged.
    const closes = isPull(other) !== isPull(t) && (item.__typename === "ConnectedEvent" || item.willCloseTarget === true);
    if (closes) add(LINK_TYPES.closes, other, isPull(t));
    else add(LINK_TYPES.relates, other, true);
  }
  return [...links.values()];
}

/** The node as a Jira issue keyed `owner/repo#12`, or null when it lacks a repository or number. */
export function toRawIssue(t: GhNode): RawIssue | null {
  const key = keyOf(t);
  if (!key) return null;
  const parentKey = keyOf(t.parent);
  return {
    id: t.id ?? key,
    key,
    self: t.url,
    fields: {
      summary: t.title ?? key,
      issuetype: typeOf(t),
      status: statusOf(t),
      assignee: userOf(nodesOf(t.assignees)[0]),
      reporter: userOf(t.author),
      resolutiondate: t.closedAt ?? null,
      created: t.createdAt,
      fixVersions: releasesOf(t),
      parent: t.parent && parentKey ? linked(t.parent, parentKey, true) : undefined,
      issuelinks: linksOf(t, key),
    },
  };
}

/** Jira tickets the body links to (`https://…/browse/KEY`), as remote links that relate to them. */
export function jiraLinksIn(t: GhNode): RawRemoteLink[] {
  const key = keyOf(t);
  if (!key || !t.bodyText) return [];
  const urls = new Set<string>();
  for (const m of t.bodyText.matchAll(/https:\/\/[A-Za-z0-9.-]+(?::\d+)?\/browse\/([A-Za-z][A-Za-z0-9_]*-\d+)/g)) {
    if (JIRA_KEY_RE.test(m[1].toUpperCase())) urls.add(m[0]);
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
