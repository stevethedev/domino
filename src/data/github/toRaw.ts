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
import { gitHubKey } from "../ticketKey";
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
    if (t.merged || t.pullState === "MERGED") return STATUSES.merged;
    if (t.pullState === "CLOSED") return STATUSES.closed;
    return t.isDraft ? STATUSES.draft : STATUSES.inReview;
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
    ...([t.timelineItems, t.blockedBy, t.blocking, t.closingIssuesReferences].some((c) => c?.pageInfo?.hasNextPage === true)
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

type Fence = Readonly<{ char: string; length: number }>;

const LIST_ITEM = /^[ \t]*(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/;

/** How far leading whitespace indents, with tabs to the next multiple of 4 as CommonMark counts them. */
function columnsOf(indent: string): number {
  let col = 0;
  for (const c of indent) col = c === "\t" ? col + 4 - (col % 4) : col + 1;
  return col;
}

/**
 * The Markdown GitHub shows: without HTML comments (an unclosed one runs to the end) or fenced code
 * blocks, read together so a comment marker in code, or a fence in a comment, hides nothing after it.
 * Fences as CommonMark reads them: one closes on the same character, at least as long, with nothing
 * after it; an unclosed fence runs to the end; it opens indented at most 3 spaces, or any amount in a
 * list item (which lasts until unindented text after a blank line), since 4 is indented code. Inline
 * code can wrap onto the next line, so a paragraph's lines (up to a blank or fence-like line) are read
 * together. One pass, whatever the input.
 */
function shownMarkdown(text: string): string {
  const kept: string[] = [];
  let paragraph: string[] = [];
  let fence: Fence | null = null;
  let inComment = false;
  /** Keeps the paragraph's shown text; whether a comment is still open after it. */
  const endParagraph = (): boolean => {
    if (!paragraph.length) return inComment;
    const shown = shownText(paragraph.join("\n"), inComment);
    kept.push(shown.text);
    paragraph = [];
    return shown.inComment;
  };
  let inList = false;
  let afterBlank = false;
  for (const line of text.split(/\r?\n/)) {
    const m = /^([ \t]*)(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      if (m && m[2][0] === fence.char && m[2].length >= fence.length && m[3].trim() === "") fence = null;
      continue;
    }
    const blank = line.trim() === "";
    if (LIST_ITEM.test(line)) inList = true;
    else if (afterBlank && !blank && !/^[ \t]/.test(line)) inList = false;
    afterBlank = blank;
    // An opener may follow a list marker on the same line ("- ```"); a closer never does.
    const o = m ?? /^([ \t]*)(?:[-*+]|\d{1,9}[.)])[ \t]+(`{3,}|~{3,})(.*)$/.exec(line);
    const opener = o && (inList || columnsOf(o[1]) <= 3) ? o : null;
    if (opener || blank) inComment = endParagraph();
    if (!inComment && opener && !(opener[2][0] === "`" && opener[3].includes("`"))) {
      fence = { char: opener[2][0], length: opener[2].length };
    } else paragraph.push(line);
  }
  endParagraph();
  return kept.join("\n");
}

type CodeRun = Readonly<{ start: number; end: number }>;

/**
 * The text outside HTML comments, starting inside one when `inComment`. A `<!--` in an inline code span
 * (a backtick run closed by the next run as long) is code, not a comment; an unclosed run is plain
 * backticks. One pass: each run's closer is looked up, not searched for.
 */
function shownText(line: string, inComment: boolean): { text: string; inComment: boolean } {
  const runs: CodeRun[] = [...line.matchAll(/`+/g)].map((m) => ({ start: m.index, end: m.index + m[0].length }));
  const closerOf = new Map<number, number>();
  const nextOfLength = new Map<number, number>();
  for (let r = runs.length - 1; r >= 0; r--) {
    const length = runs[r].end - runs[r].start;
    const next = nextOfLength.get(length);
    if (next !== undefined) closerOf.set(r, next);
    nextOfLength.set(length, r);
  }
  let text = "";
  let at = 0;
  let run = 0;
  let marker = -2; // the next `<!--` at or after `at`; -1 once there is none
  let commented = inComment;
  while (at < line.length) {
    if (commented) {
      const close = line.indexOf("-->", at);
      if (close < 0) break;
      at = close + 3;
      commented = false;
      continue;
    }
    while (run < runs.length && runs[run].start < at) run++;
    if (marker !== -1 && marker < at) marker = line.indexOf("<!--", at);
    const next = run < runs.length ? runs[run] : undefined;
    if (marker >= 0 && (!next || marker < next.start)) {
      text += line.slice(at, marker);
      at = marker + 4;
      commented = true;
    } else if (!next) {
      text += line.slice(at);
      break;
    } else {
      const closer = closerOf.get(run);
      const end = closer === undefined ? next.end : runs[closer].end;
      text += line.slice(at, end);
      at = end;
      run = closer === undefined ? run + 1 : closer + 1;
    }
  }
  return { text, inComment: commented };
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
