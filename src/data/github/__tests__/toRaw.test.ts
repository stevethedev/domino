import { describe, expect, it } from "vitest";
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
    expect(raw(node("a/b#1", { subIssuesSummary: { total: 0 } })).fields.issuetype).toEqual({ name: "Issue" });
    const child = raw(node("a/b#2", { parent: linkedIssue("a/b#1", { title: "Rollout" }) }));
    expect(child.fields.parent).toMatchObject({ key: "a/b#1", fields: { summary: "Rollout", issuetype: { hierarchyLevel: 1 } } });
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
    expect(found(`\`\`\`\n${url(1)}\n\`\`\`~\n${url(2)}\n\`\`\`\nSee ${url(9)}`)).toEqual(["CORE-9"]); // \`\`\`~ doesn't close
    expect(found(`Use \`\`\`x\`\`\` here ${url(9)}`)).toEqual(["CORE-9"]); // not an opener
    expect(found(`See ${url(9)}\n<!-- unclosed ${url(1)}`)).toEqual(["CORE-9"]);
  });

  it("scans a hostile body in linear time", () => {
    const started = performance.now();
    jiraLinksIn(node("a/b#1", { body: "\`\`\`a\n".repeat(16000) + "<!--".repeat(16000) }));
    expect(performance.now() - started).toBeLessThan(200);
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
    expect(jiraLinksIn(fixture("acme/api#12")).map((l) => l.object.url)).toEqual(["https://acme.atlassian.net/browse/CORE-11"]);
  });
});
