import { describe, expect, it } from "vitest";
import { buildGraph } from "../../../graph/buildGraph";
import { myIssues } from "../../../graph/mine";
import { data, site } from "../../../graph/__tests__/helpers";
import { defined } from "../../../lib/guards";
import { mockGitHub } from "../../mockData";
import type { GhLinked, GhNode } from "../githubTypes";
import type { RawIssue } from "../../jiraTypes";
import { descriptionOf, jiraLinksIn, keyOf, toRawIssue } from "../toRaw";

const linkedIssue = (key: string, extra: Partial<GhLinked> = {}): GhLinked => {
  const [repo, n] = key.split("#");
  return { __typename: "Issue", number: Number(n), title: key, state: "OPEN", repository: { nameWithOwner: repo }, ...extra };
};
const linkedPull = (key: string, extra: Partial<GhLinked> = {}): GhLinked => {
  const { state: _state, stateReason: _reason, ...base } = linkedIssue(key);
  return { ...base, __typename: "PullRequest", pullState: "OPEN", ...extra };
};
const node = (key: string, extra: Partial<GhNode> = {}): GhNode => ({ ...linkedIssue(key), id: `I_${key}`, ...extra });
const raw = (n: GhNode): RawIssue => defined(toRawIssue(n), "issue");
const fixture = (key: string): GhNode =>
  defined(
    mockGitHub.issues.find((n) => keyOf(n) === key),
    key,
  );

describe("toRawIssue", () => {
  it("keys tickets owner/repo#number and keeps the fields Domino draws", () => {
    const issue = raw(
      node("acme/web#7", {
        title: "Fix it",
        url: "https://github.com/acme/web/issues/7",
        createdAt: "2026-10-01T10:00:00Z",
        closedAt: null,
        author: { login: "dana", name: "Dana" },
        assignees: { nodes: [{ login: "jonas", name: null, avatarUrl: "https://avatars.example/j" }] },
        milestone: { id: "M1", title: "v2", dueOn: "2026-11-01T00:00:00Z", state: "OPEN" },
        issueType: { name: "Bug" },
      }),
    );
    expect(issue).toMatchObject({
      id: "I_acme/web#7",
      key: "acme/web#7",
      self: "https://github.com/acme/web/issues/7",
      fields: {
        summary: "Fix it",
        issuetype: { name: "Bug" },
        status: { name: "Open", statusCategory: { key: "new" } },
        assignee: { accountId: "jonas", displayName: "jonas", avatarUrls: { "48x48": "https://avatars.example/j" } },
        reporter: { accountId: "dana", displayName: "Dana" },
        created: "2026-10-01T10:00:00Z",
        resolutiondate: null,
        fixVersions: [{ id: "M1", name: "v2", releaseDate: "2026-11-01", released: false }],
        issuelinks: [],
      },
    });
  });

  it("maps issue and pull request states onto status categories", () => {
    const status = (n: GhNode): string => {
      const s = raw(n).fields.status;
      return `${s?.name ?? "?"}/${s?.statusCategory?.key ?? "?"}`;
    };
    expect(status(node("a/b#1"))).toBe("Open/new");
    expect(status(node("a/b#1", { state: "CLOSED", stateReason: "COMPLETED" }))).toBe("Closed/done");
    expect(status(node("a/b#1", { state: "CLOSED", stateReason: "NOT_PLANNED" }))).toBe("Not planned/done");
    expect(status(node("a/b#1", { state: "CLOSED", stateReason: "DUPLICATE" }))).toBe("Not planned/done");
    const pr = (extra: Partial<GhNode>): GhNode => ({ ...linkedPull("a/b#2"), id: "PR_2", ...extra });
    expect(status(pr({ isDraft: true }))).toBe("Draft/indeterminate");
    expect(status(pr({}))).toBe("In review/indeterminate");
    // Pull requests read their state from `pullState` (see pull_fragments.graphql).
    expect(status(pr({ pullState: "MERGED", merged: true }))).toBe("Merged/done");
    expect(status(pr({ pullState: "CLOSED" }))).toBe("Closed/done");
    expect(status(pr({ pullState: "MERGED" }))).toBe("Merged/done");
    expect(raw(pr({})).fields.issuetype).toEqual({ name: "Pull request" });
  });

  it("treats an issue with sub-issues as an epic, and a sub-issue's parent as its epic", () => {
    expect(raw(node("a/b#1", { subIssuesSummary: { total: 2 } })).fields.issuetype).toEqual({ name: "Issue", hierarchyLevel: 1 });
    expect(raw(node("a/b#1", { subIssuesSummary: { total: 0 } })).fields.issuetype).toEqual({ name: "Issue", hierarchyLevel: 0 });
    const child = raw(node("a/b#2", { parent: linkedIssue("a/b#1", { title: "Rollout" }) }));
    expect(child.fields.parent).toMatchObject({ key: "a/b#1", fields: { summary: "Rollout", issuetype: { hierarchyLevel: 1 } } });
  });

  it("groups a three-level hierarchy under its top issue, as Jira groups sub-tasks under the story's epic", () => {
    const top = node("a/b#1", { subIssuesSummary: { total: 1 } });
    const middle = node("a/b#2", { subIssuesSummary: { total: 1 }, parent: linkedIssue("a/b#1") });
    const bottom = node("a/b#3", { parent: { ...linkedIssue("a/b#2"), parent: { id: "I_a/b#1" } } });
    const graph = buildGraph({ sites: [site("gh")], data: [data("gh", [top, middle, bottom].map(raw))] });
    expect(graph.nodes.map((n) => [n.key, n.epic?.key])).toEqual([
      ["a/b#1", "a/b#1"],
      ["a/b#2", "a/b#1"],
      ["a/b#3", "a/b#1"],
    ]);
  });

  it("groups by sub-issues alone, even when a sub-issue's own type is named Epic", () => {
    const top = node("a/b#1", { subIssuesSummary: { total: 1 } });
    const typedEpic = node("a/b#2", { issueType: { name: "Epic" }, parent: linkedIssue("a/b#1") });
    const graph = buildGraph({ sites: [site("gh")], data: [data("gh", [top, typedEpic].map(raw))] });
    expect(graph.nodes.map((n) => [n.key, n.epic?.key])).toEqual([
      ["a/b#1", "a/b#1"],
      ["a/b#2", "a/b#1"],
    ]);
  });

  it("counts a ticket as assigned to me when I'm any of its assignees, not only the first", () => {
    const shared = node("a/b#1", { assignees: { nodes: [{ login: "other" }, { login: "me" }] } });
    const graph = buildGraph({ sites: [site("gh")], data: [data("gh", [raw(shared)])] });
    expect(myIssues(graph.nodes, new Map([["gh", "me"]])).assigned).toEqual(new Set(["gh:a/b#1"]));
    expect(raw(shared).fields.assignee?.accountId).toBe("other");
  });

  it("links the GitHub tickets its shown body mentions by URL or owner/repo#n, but not in code or comments", () => {
    const body = [
      "See https://github.com/acme/api/pull/7/files and Acme/Web#3.",
      "Not #4, not https://other.example/acme/web/issues/5, not https://github.com/acme/web/issues/1 (itself).",
      "Nor `acme/web#6` in code (GitHub doesn't link it), nor <!-- acme/web#8 -->.",
      "```\nacme/web#9\n```",
    ].join("\n\n");
    const issue = raw(node("acme/web#1", { url: "https://github.com/acme/web/issues/1", body }));
    expect((issue.fields.issuelinks ?? []).map((l) => [l.id, l.outwardIssue?.key, l.outwardIssue?.fields.status])).toEqual([
      ["relates:acme/api#7|acme/web#1", "acme/api#7", undefined],
      ["relates:acme/web#1|acme/web#3", "acme/web#3", undefined],
    ]);
  });

  it("reads owner/repo#n only within the ticket's own owner, and never an image's target", () => {
    const body = "Path docs/readme#2, other/tool#4 but https://github.com/other/tool/issues/5 ![x](https://github.com/acme/web/issues/6)";
    const issue = raw(node("acme/web#1", { url: "https://github.com/acme/web/issues/1", body }));
    expect((issue.fields.issuelinks ?? []).map((l) => l.outwardIssue?.key)).toEqual(["other/tool#5"]);
  });

  it("reads a ticket URL only up to a clean end of its number", () => {
    const base = "https://github.com/acme/web";
    const body = `${base}/issues/42-extra ${base}/issues/43abc ${base}/pull/44/files ${base}/issues/45#c1 See ${base}/issues/46.`;
    const issue = raw(node("acme/web#1", { url: `${base}/issues/1`, body }));
    expect((issue.fields.issuelinks ?? []).map((l) => l.outwardIssue?.key)).toEqual(["acme/web#44", "acme/web#45", "acme/web#46"]);
  });

  it("doesn't add a mention for a ticket already linked another way", () => {
    const pr = raw(
      node("acme/web#9", {
        __typename: "PullRequest",
        body: "Fixes acme/web#2",
        closingIssuesReferences: { nodes: [linkedIssue("acme/web#2")] },
      }),
    );
    expect((pr.fields.issuelinks ?? []).map((l) => l.id)).toEqual(["closes:acme/web#9>acme/web#2"]);
  });

  it("writes each link with the same id from both ends, so they collapse into one edge", () => {
    const blocker = raw(node("a/b#1", { blocking: { nodes: [linkedIssue("a/b#2")] } }));
    const blocked = raw(node("a/b#2", { blockedBy: { nodes: [linkedIssue("a/b#1")] } }));
    expect(blocker.fields.issuelinks).toMatchObject([
      { id: "blocks:a/b#1>a/b#2", type: { name: "Blocks" }, outwardIssue: { key: "a/b#2" } },
    ]);
    expect(blocked.fields.issuelinks).toMatchObject([{ id: "blocks:a/b#1>a/b#2", inwardIssue: { key: "a/b#1" } }]);

    const pr = raw(node("a/b#9", { __typename: "PullRequest", closingIssuesReferences: { nodes: [linkedIssue("a/b#2")] } }));
    const closed = raw(
      node("a/b#2", {
        timelineItems: { nodes: [{ __typename: "CrossReferencedEvent", willCloseTarget: true, source: linkedPull("a/b#9") }] },
      }),
    );
    expect(pr.fields.issuelinks).toMatchObject([{ id: "closes:a/b#9>a/b#2", type: { outward: "closes" }, outwardIssue: { key: "a/b#2" } }]);
    expect(closed.fields.issuelinks).toMatchObject([{ id: "closes:a/b#9>a/b#2", inwardIssue: { key: "a/b#9" } }]);

    const mention = (self: string, other: string): string | undefined =>
      raw(
        node(self, {
          timelineItems: { nodes: [{ __typename: "CrossReferencedEvent", willCloseTarget: false, source: linkedIssue(other) }] },
        }),
      ).fields.issuelinks?.[0]?.id;
    expect(mention("a/b#1", "c/d#5")).toBe("relates:a/b#1|c/d#5");
    expect(mention("c/d#5", "a/b#1")).toBe("relates:a/b#1|c/d#5");
  });

  it("links a stacked pull request as blocked by the open pull requests whose head is its base branch", () => {
    const pr = (key: string, base: string, onBase: (GhLinked | null)[], extra: Partial<GhNode> = {}): GhNode => ({
      ...linkedPull(key),
      id: `PR_${key}`,
      repository: { nameWithOwner: key.split("#")[0], defaultBranchRef: { name: "main" } },
      baseRefName: base,
      baseRef: { associatedPullRequests: { nodes: onBase } },
      ...extra,
    });
    expect(raw(pr("a/b#2", "feature-a", [linkedPull("a/b#1"), null])).fields.issuelinks).toMatchObject([
      { id: "blocks:a/b#1>a/b#2", type: { name: "Blocks" }, inwardIssue: { key: "a/b#1" } },
    ]);
    // Into the default branch: an open release pull request from main doesn't block everything.
    expect(raw(pr("a/b#2", "main", [linkedPull("a/b#9")])).fields.issuelinks).toEqual([]);
    // Base branch deleted, or no base reported.
    expect(raw(pr("a/b#2", "feature-a", [], { baseRef: null })).fields.issuelinks).toEqual([]);
    expect(raw(pr("a/b#2", "", [linkedPull("a/b#1")])).fields.issuelinks).toEqual([]);
    // Issues never stack, and a pull request isn't stacked on itself.
    expect(
      raw(node("a/b#3", { baseRefName: "x", baseRef: { associatedPullRequests: { nodes: [linkedPull("a/b#1")] } } })).fields.issuelinks,
    ).toEqual([]);
    expect(raw(pr("a/b#2", "feature-a", [linkedPull("a/b#2")])).fields.issuelinks).toEqual([]);
    const cutShort = { baseRef: { associatedPullRequests: { nodes: [], pageInfo: { hasNextPage: true } } } };
    expect(raw(pr("a/b#2", "feature-a", [], cutShort)).linksIncomplete).toBe(true);
  });

  it("treats a pull request connected to an issue as closing it, and skips self-references and duplicates", () => {
    const issue = raw(
      node("a/b#1", {
        blockedBy: { nodes: [linkedIssue("a/b#3"), linkedIssue("a/b#3"), linkedIssue("a/b#1"), null] },
        timelineItems: {
          nodes: [
            { __typename: "ConnectedEvent", subject: linkedPull("a/b#4") },
            { __typename: "ConnectedEvent", subject: linkedIssue("a/b#5") },
            { __typename: "CrossReferencedEvent", source: null },
          ],
        },
      }),
    );
    expect(issue.fields.issuelinks?.map((l) => l.id)).toEqual(["blocks:a/b#3>a/b#1", "closes:a/b#4>a/b#1", "relates:a/b#1|a/b#5"]);
  });

  it("keys tickets in lower case, whatever spelling GitHub returns", () => {
    expect(keyOf(linkedIssue("Acme/Web#7"))).toBe("acme/web#7");
    expect(raw(node("Acme/Web#7", { blocking: { nodes: [linkedIssue("Acme/API#2")] } })).fields.issuelinks?.[0]?.id).toBe(
      "blocks:acme/web#7>acme/api#2",
    );
  });

  it("keeps a pull request linked from the sidebar only while it's still connected", () => {
    const links = (...events: ("connect" | "disconnect")[]): string[] =>
      raw(
        node("a/b#1", {
          timelineItems: {
            nodes: events.map((e) => ({
              __typename: e === "connect" ? "ConnectedEvent" : "DisconnectedEvent",
              subject: linkedPull("a/b#4"),
            })),
          },
        }),
      ).fields.issuelinks?.map((l) => l.id) ?? [];
    expect(links("connect")).toEqual(["closes:a/b#4>a/b#1"]);
    expect(links("connect", "disconnect")).toEqual([]);
    expect(links("connect", "disconnect", "connect")).toEqual(["closes:a/b#4>a/b#1"]);
  });

  it("doesn't trust sidebar connections on a timeline that was cut short (the unlink may be on a later page)", () => {
    const issue = raw(
      node("a/b#1", {
        timelineItems: {
          nodes: [
            { __typename: "ConnectedEvent", subject: linkedPull("a/b#4") },
            { __typename: "CrossReferencedEvent", willCloseTarget: true, source: linkedPull("a/b#5") },
          ],
          pageInfo: { hasNextPage: true },
        },
      }),
    );
    expect(issue.fields.issuelinks?.map((l) => l.id)).toEqual(["closes:a/b#5>a/b#1"]);
  });

  it("flags tickets whose timeline had more events than one page", () => {
    expect(raw(node("a/b#1", { timelineItems: { nodes: [], pageInfo: { hasNextPage: true } } })).linksIncomplete).toBe(true);
    expect(raw(node("a/b#1", { timelineItems: { nodes: [], pageInfo: { hasNextPage: false } } })).linksIncomplete).toBeUndefined();
    expect(raw(node("a/b#1", { blockedBy: { nodes: [], pageInfo: { hasNextPage: true } } })).linksIncomplete).toBe(true);
    expect(raw(node("a/b#1", { closingIssuesReferences: { nodes: [], pageInfo: { hasNextPage: true } } })).linksIncomplete).toBe(true);
  });

  it("skips nodes without a repository or number", () => {
    expect(toRawIssue({ title: "?" })).toBeNull();
  });
});

describe("jiraLinksIn", () => {
  it("finds Jira ticket URLs in the body, once each", () => {
    const n = node("a/b#1", {
      bodyText:
        "See https://acme.atlassian.net/browse/CORE-11. Also https://acme.atlassian.net/browse/CORE-11 and http://x/browse/A-1 and https://acme.atlassian.net/wiki/x",
    });
    const links = jiraLinksIn(n);
    expect(links).toMatchObject([
      { relationship: "relates to", object: { url: "https://acme.atlassian.net/browse/CORE-11", title: "CORE-11" } },
    ]);
    expect(jiraLinksIn(node("a/b#2", { bodyText: n.bodyText }))[0]?.id).not.toBe(links[0]?.id);
    expect(jiraLinksIn(node("a/b#1"))).toEqual([]);
  });

  it("ignores links GitHub doesn't show: in HTML comments and code blocks", () => {
    const body =
      "<!-- Link the ticket: https://acme.atlassian.net/browse/CORE-1 -->\n```\nhttps://acme.atlassian.net/browse/CORE-2\n```\nSee https://acme.atlassian.net/browse/CORE-3";
    expect(jiraLinksIn(node("a/b#1", { body })).map((l) => l.object.title)).toEqual(["CORE-3"]);
    const fences = "~~~\nhttps://acme.atlassian.net/browse/CORE-4\n~~~\n````\n```\nhttps://acme.atlassian.net/browse/CORE-5\n````";
    expect(jiraLinksIn(node("a/b#1", { body: fences }))).toEqual([]);
  });

  it("reads code fences as CommonMark does", () => {
    const url = (n: number): string => `https://acme.atlassian.net/browse/CORE-${n}`;
    const found = (body: string): (string | undefined)[] => jiraLinksIn(node("a/b#1", { body })).map((l) => l.object.title);
    expect(found(`1. step\n   \`\`\`\n   ${url(1)}\n   \`\`\`\nSee ${url(9)}`)).toEqual(["CORE-9"]); // list-item fence
    expect(found(`\`\`\`\n${url(1)}\n  \`\`\`\nSee ${url(9)}`)).toEqual(["CORE-9"]); // indented close
    expect(found(`See ${url(9)}\n\`\`\`\n${url(1)}`)).toEqual(["CORE-9"]); // unclosed: runs to the end
    expect(found(`Use \`\`\`x\`\`\` here ${url(9)}`)).toEqual(["CORE-9"]); // not an opener
    expect(found(`See ${url(9)}\n<!-- unclosed ${url(1)}`)).toEqual(["CORE-9"]);
  });

  it("reads four-space-indented backticks as indented code at the top level, but as a fence in a list item", () => {
    const url = (n: number): string => `https://acme.atlassian.net/browse/CORE-${n}`;
    const found = (body: string): (string | undefined)[] => jiraLinksIn(node("a/b#1", { body })).map((l) => l.object.title);
    expect(found(`Intro\n\n    \`\`\`\n\nSee ${url(9)}`)).toEqual(["CORE-9"]);
    expect(found(`- a\n  - b\n\n      \`\`\`\n      ${url(1)}\n      \`\`\`\n\nSee ${url(9)}`)).toEqual(["CORE-9"]);
    expect(found(`- a\n\nDone.\n\n    \`\`\`\n\nSee ${url(9)}`)).toEqual(["CORE-9"]); // the list ended
  });

  it("ignores fenced code in a blockquote, but not the prose after the quote", () => {
    const url = (n: number): string => `https://acme.atlassian.net/browse/CORE-${n}`;
    const found = (body: string): (string | undefined)[] => jiraLinksIn(node("a/b#1", { body })).map((l) => l.object.title);
    expect(found(`> \`\`\`\n> ${url(11)}\n> \`\`\`\n\nSee ${url(9)}`)).toEqual(["CORE-9"]);
    expect(found(`> Quoted ${url(2)}\n\nSee ${url(9)}`)).toEqual(["CORE-2", "CORE-9"]);
  });

  it("reads a fence that opens on a list marker's own line", () => {
    const url = (n: number): string => `https://acme.atlassian.net/browse/CORE-${n}`;
    const found = (body: string): (string | undefined)[] => jiraLinksIn(node("a/b#1", { body })).map((l) => l.object.title);
    expect(found(`- \`\`\`\n  ${url(1)}\n  \`\`\`\n\nSee ${url(9)}`)).toEqual(["CORE-9"]);
    expect(found(`1. ~~~\n   ${url(1)}\n   ~~~\n\nSee ${url(9)}`)).toEqual(["CORE-9"]);
    expect(found(`-     \`\`\`\n\nSee ${url(9)}`)).toEqual(["CORE-9"]); // 5 spaces in: indented code, not a fence
    expect(found(`-\t\`\`\`\n    ${url(1)}\n    \`\`\`\n\nSee ${url(9)}`)).toEqual(["CORE-9"]); // a tab after the marker
    expect(found(`1.    ~~~\n      ${url(1)}\n      ~~~\n\nSee ${url(9)}`)).toEqual(["CORE-9"]); // 4 spaces: still a fence
  });

  it("reads comments and fences together: neither hides prose after the other closes", () => {
    const url = (n: number): string => `https://acme.atlassian.net/browse/CORE-${n}`;
    const found = (body: string): (string | undefined)[] => jiraLinksIn(node("a/b#1", { body })).map((l) => l.object.title);
    expect(found(`\`\`\`html\n<!-- ${url(1)}\n\`\`\`\nSee ${url(9)}`)).toEqual(["CORE-9"]); // a comment opener in code
    expect(found(`<!--\n\`\`\`\n${url(1)}\n-->\nSee ${url(9)}`)).toEqual(["CORE-9"]); // a fence in a comment
    expect(found(`<!-- a --> See ${url(9)} <!-- ${url(1)} --> and ${url(8)}`)).toEqual(["CORE-9", "CORE-8"]);
  });

  it("scans a hostile body in linear time", () => {
    const started = performance.now();
    jiraLinksIn(node("a/b#1", { body: "\`\`\`a\n".repeat(16000) + "<!--".repeat(16000) }));
    expect(performance.now() - started).toBeLessThan(200);
  });

  it("reads a comment marker inside inline code as code, hiding nothing after it", () => {
    const body = "Use `<!--` or `` a `<!--` b `` to begin a comment.\nNeeds https://acme.atlassian.net/browse/CORE-11";
    expect(jiraLinksIn(node("a/b#1", { body })).map((l) => l.object.title)).toEqual(["CORE-11"]);
    // An inline comment hides its text; an unclosed `<!--` mid-paragraph is plain text, as GitHub shows it.
    const mixed = "`code` <!-- https://acme.atlassian.net/browse/CORE-12 --> ``unclosed <!-- https://acme.atlassian.net/browse/CORE-13";
    expect(jiraLinksIn(node("a/b#1", { body: mixed })).map((l) => l.object.title)).toEqual(["CORE-13"]);
  });

  it("reads inline code that wraps onto the next line as code, but not past a blank line", () => {
    const titles = (body: string): (string | undefined)[] => jiraLinksIn(node("a/b#1", { body })).map((l) => l.object.title);
    expect(titles("Use `<!--\nin code`.\nNeeds https://acme.atlassian.net/browse/CORE-11")).toEqual(["CORE-11"]);
    // A blank line ends the paragraph: the backtick is plain, and the comment hides what follows.
    expect(titles("Use `\n\n<!-- https://acme.atlassian.net/browse/CORE-12 `")).toEqual([]);
  });

  it("takes only whole ticket URLs, not the start of a longer path", () => {
    const base = "https://acme.atlassian.net/browse";
    const found = (body: string): (string | undefined)[] => jiraLinksIn(node("a/b#1", { body })).map((l) => l.object.title);
    expect(found(`${base}/CORE-11-extra ${base}/CORE-12x ${base}/CORE-13/sub`)).toEqual([]);
    expect(found(`(${base}/CORE-1). ${base}/CORE-2/ ${base}/CORE-3?focused=1 ${base}/CORE-4#c, ${base}/CORE-5`)).toEqual([
      "CORE-1",
      "CORE-2",
      "CORE-3",
      "CORE-4",
      "CORE-5",
    ]);
  });

  it("reads links from the Markdown body, which keeps the URLs behind link text", () => {
    const n = node("a/b#1", {
      body: "Needed by [CORE-11](https://acme.atlassian.net/browse/CORE-11).",
      bodyText: "Needed by CORE-11.",
    });
    expect(jiraLinksIn(n).map((l) => l.object.url)).toEqual(["https://acme.atlassian.net/browse/CORE-11"]);
  });
});

describe("descriptionOf", () => {
  it("turns the body into paragraphs of plain text", () => {
    expect(descriptionOf(node("a/b#1", { bodyText: "One\ntwo\n\nThree" }))).toEqual({
      type: "doc",
      version: 1,
      content: [
        { type: "paragraph", content: [{ type: "text", text: "One" }, { type: "hardBreak" }, { type: "text", text: "two" }] },
        { type: "paragraph", content: [{ type: "text", text: "Three" }] },
      ],
    });
    expect(descriptionOf(node("a/b#1", { bodyText: "  " }))).toBeNull();
  });
});

describe("the GitHub fixture", () => {
  it("maps both ends of every relationship onto matching links", () => {
    const ids = (key: string): string[] | undefined =>
      raw(fixture(key))
        .fields.issuelinks?.map((l) => l.id)
        .sort();
    expect(ids("acme/web#31")).toEqual(["blocks:acme/api#12>acme/web#31", "closes:acme/web#45>acme/web#31"]);
    expect(ids("acme/api#12")).toEqual(["blocks:acme/api#12>acme/web#31", "relates:acme/api#12|acme/api#15"]);
    expect(ids("acme/web#42")).toEqual(["closes:acme/web#42>acme/web#32"]);
    expect(ids("acme/web#47")).toEqual(["blocks:acme/web#45>acme/web#47"]);
    expect(jiraLinksIn(fixture("acme/api#12")).map((l) => l.object.url)).toEqual(["https://acme.atlassian.net/browse/CORE-11"]);
  });
});
