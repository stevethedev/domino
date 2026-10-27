// In-memory GitHubApi over fixtures/mock/github.json, evaluating the same small advanced-search subset as the
// Rust mock (src-tauri/src/github/mock.rs).
import { settle } from "../FixtureSource";
import type { GitHubApi } from "./GitHubApi";
import type { GhNode, GhViewer } from "./githubTypes";
import { parseSearch, type SearchNode } from "./query";
import { keyOf } from "./toRaw";

export type GitHubFixture = { issues: GhNode[]; viewer: GhViewer };

/** One search term against a node. Free text, and qualifiers the fixtures can't answer, match everything. */
function matchesTerm(node: GhNode, rawTerm: string, viewer: string): boolean {
  const negate = rawTerm.startsWith("-");
  const term = negate ? rawTerm.slice(1) : rawTerm;
  const colon = term.indexOf(":");
  if (colon < 0) return true;
  const qualifier = term.slice(0, colon).toLowerCase();
  const value = term
    .slice(colon + 1)
    .replace(/^"(.*?)"?$/, "$1")
    .toLowerCase();
  const repo = (node.repository?.nameWithOwner ?? "").toLowerCase();
  const pull = node.__typename === "PullRequest";
  const state = pull ? node.pullState : node.state;
  let hit: boolean;
  if (qualifier === "repo") hit = repo === value;
  else if (qualifier === "org" || qualifier === "user") hit = repo.split("/")[0] === value;
  else if ((qualifier === "is" || qualifier === "state") && value === "open") hit = state === "OPEN";
  else if ((qualifier === "is" || qualifier === "state") && value === "closed") hit = state !== "OPEN";
  else if (qualifier === "is" && value === "merged") hit = state === "MERGED";
  else if ((qualifier === "is" || qualifier === "type") && value === "issue") hit = !pull;
  else if ((qualifier === "is" || qualifier === "type") && value === "pr") hit = pull;
  else if (qualifier === "assignee") {
    const login = value === "@me" ? viewer.toLowerCase() : value;
    hit = (node.assignees?.nodes ?? []).some((a) => a?.login?.toLowerCase() === login);
  } else return true;
  return hit !== negate;
}

function matches(node: GhNode, search: SearchNode, viewer: string): boolean {
  switch (search.kind) {
    case "term":
      return matchesTerm(node, search.text, viewer);
    case "and":
      return search.items.every((item) => matches(node, item, viewer));
    case "or":
      return search.items.some((item) => matches(node, item, viewer));
    case "not":
      return !matches(node, search.item, viewer);
  }
}

export class FixtureGitHubApi implements GitHubApi {
  constructor(
    private readonly fixture: GitHubFixture,
    private readonly failSites: ReadonlySet<string> = new Set(),
  ) {}

  private nodes(siteId: string): GhNode[] {
    if (this.failSites.has(siteId)) throw new Error("Simulated outage (503 Service Unavailable)");
    return this.fixture.issues;
  }

  search(siteId: string, query: string, maxResults?: number): Promise<GhNode[]> {
    return settle(() => {
      const viewer = this.fixture.viewer.login ?? "";
      // As GitHub's advanced search reads it: terms ANDed, with OR, NOT and groups.
      const search = parseSearch(query);
      const hits = this.nodes(siteId).filter((n) => matches(n, search, viewer));
      return maxResults === undefined ? hits : hits.slice(0, maxResults);
    });
  }

  issues(siteId: string, keys: readonly string[]): Promise<GhNode[]> {
    // As GitHub (and the Rust mock) answer: ignoring case, one answer per key, saying which key it was asked for.
    return settle(() =>
      keys.flatMap((k) => {
        const n = this.nodes(siteId).find((node) => keyOf(node) === k.toLowerCase());
        return n ? [{ ...n, requestedKey: k }] : [];
      }),
    );
  }

  subIssues(siteId: string, key: string): Promise<GhNode[]> {
    return settle(() => this.nodes(siteId).filter((n) => keyOf(n.parent) === key.toLowerCase()));
  }

  viewer(siteId: string): Promise<GhViewer> {
    return settle(() => {
      this.nodes(siteId);
      return this.fixture.viewer;
    });
  }
}
