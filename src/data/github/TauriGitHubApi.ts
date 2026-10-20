import { invoke } from "@tauri-apps/api/core";
import type { GitHubApi } from "./GitHubApi";
import type { GhNode, GhViewer } from "./githubTypes";

/** Calls the Rust core, which holds the token and talks to GitHub (or serves the GitHub fixture). */
export class TauriGitHubApi implements GitHubApi {
  search(siteId: string, query: string, maxResults?: number): Promise<GhNode[]> {
    return invoke("gh_search", { siteId, query, maxResults });
  }
  issues(siteId: string, keys: readonly string[]): Promise<GhNode[]> {
    return invoke("gh_issues", { siteId, keys });
  }
  subIssues(siteId: string, key: string): Promise<GhNode[]> {
    return invoke("gh_sub_issues", { siteId, key });
  }
  viewer(siteId: string): Promise<GhViewer> {
    return invoke("gh_viewer", { siteId });
  }
}
