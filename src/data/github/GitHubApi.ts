import type { GhNode, GhViewer } from "./githubTypes";

/** Raw GitHub data for one site at a time: the Rust core's `gh_*` commands. */
export interface GitHubApi {
  /** Issues and pull requests matching a GitHub search; stops after `maxResults`. */
  search(siteId: string, query: string, maxResults?: number): Promise<GhNode[]>;
  /** Issues and pull requests by key (`owner/repo#12`); ones that don't exist are left out. */
  issues(siteId: string, keys: readonly string[]): Promise<GhNode[]>;
  subIssues(siteId: string, key: string): Promise<GhNode[]>;
  viewer(siteId: string): Promise<GhViewer>;
}
