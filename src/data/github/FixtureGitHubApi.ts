// In-memory GitHubApi over fixtures/mock/github.json, evaluating the same tiny search subset as the
// Rust mock (src-tauri/src/github/mock.rs).
import type { GitHubApi } from "./GitHubApi";
import type { GhNode, GhViewer } from "./githubTypes";
import { keyOf } from "./toRaw";

export type GitHubFixture = { issues: GhNode[]; viewer: GhViewer };

/** One search term against a node. Free text, and qualifiers the fixtures can't answer, match everything. */
function matchesTerm(node: GhNode, rawTerm: string, viewer: string): boolean {
  const negate = rawTerm.startsWith("-");
  const term = negate ? rawTerm.slice(1) : rawTerm;
  const colon = term.indexOf(":");
  if (colon < 0) return true;
  const qualifier = term.slice(0, colon).toLowerCase();
  const value = term.slice(colon + 1).toLowerCase();
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

/** Runs `fn` as an async method body would: a throw becomes a rejection. */
const settle = <T>(fn: () => T): Promise<T> =>
  new Promise((resolve) => {
    resolve(fn());
  });

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
      const terms = query.split(/\s+/).filter(Boolean);
      const viewer = this.fixture.viewer.login ?? "";
      const hits = this.nodes(siteId).filter((n) => terms.every((t) => matchesTerm(n, t, viewer)));
      return maxResults === undefined ? hits : hits.slice(0, maxResults);
    });
  }

  issues(siteId: string, keys: readonly string[]): Promise<GhNode[]> {
    return settle(() => this.nodes(siteId).filter((n) => keys.includes(keyOf(n) ?? "")));
  }

  subIssues(siteId: string, key: string): Promise<GhNode[]> {
    return settle(() => this.nodes(siteId).filter((n) => keyOf(n.parent) === key));
  }

  viewer(siteId: string): Promise<GhViewer> {
    return settle(() => {
      this.nodes(siteId);
      return this.fixture.viewer;
    });
  }
}
