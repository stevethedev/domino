import { siteKindOf, type SiteConfig } from "../config/types";

/** A Jira issue key, e.g. `CORE-12`. */
export const JIRA_KEY_RE = /^[A-Z][A-Z0-9_]*-\d+$/;

/**
 * A GitHub issue or pull request key, `owner/repo#12`, by GitHub's naming rules (the same check as
 * `parse_key` in src-tauri/src/github.rs): owners are letters, digits and inner dashes; repos also
 * allow `.` and `_`, but aren't `.` or `..`.
 */
const GITHUB_KEY_RE = /^([A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?)\/(?!\.\.?#)([A-Za-z0-9._-]{1,100})#([1-9]\d{0,9})$/;
const MAX_GITHUB_NUMBER = 2 ** 31 - 1; // GraphQL's Int

export type GitHubKey = Readonly<{ owner: string; repo: string; number: number }>;

export function parseGitHubKey(key: string): GitHubKey | null {
  const m = GITHUB_KEY_RE.exec(key);
  if (!m) return null;
  const number = Number(m[3]);
  return number <= MAX_GITHUB_NUMBER ? { owner: m[1], repo: m[2], number } : null;
}

export const gitHubKey = (repo: string, number: number): string => `${repo}#${number}`;

type KindOnly = Pick<SiteConfig, "kind">;

/** Whether `key` names a ticket on this kind of site. */
export const isTicketKey = (site: KindOnly, key: string): boolean =>
  siteKindOf(site) === "github" ? parseGitHubKey(key) !== null : JIRA_KEY_RE.test(key);

/** An issue or pull request page, `/{owner}/{repo}/issues/12` or `/pull/12`, as a key. */
export function gitHubKeyFromPath(pathname: string): string | null {
  const m = /^\/([^/]+)\/([^/]+)\/(?:issues|pull)\/(\d+)\/?$/.exec(pathname);
  if (!m) return null;
  const key = gitHubKey(`${m[1]}/${m[2]}`, Number(m[3]));
  return parseGitHubKey(key) ? key : null;
}

/** What the user typed as a key, in the site's spelling: Jira keys upper-cased, GitHub URLs turned into keys. */
export function normalizeKeyInput(site: KindOnly, input: string): string {
  const t = input.trim();
  if (siteKindOf(site) !== "github") return t.toUpperCase();
  try {
    return gitHubKeyFromPath(new URL(t).pathname) ?? t;
  } catch {
    return t;
  }
}

/** An example key for the site's kind, for placeholders and validation messages. */
export const exampleKey = (site: KindOnly): string => (siteKindOf(site) === "github" ? "acme/web#12" : "CORE-1");

/** The ticket's page: `/browse/KEY` on Jira, the issue page on GitHub (which redirects pull requests to `/pull/`). */
export function ticketUrl(site: Pick<SiteConfig, "kind" | "baseUrl">, key: string): string {
  const base = site.baseUrl.replace(/\/+$/, "");
  const gh = siteKindOf(site) === "github" ? parseGitHubKey(key) : null;
  return gh ? `${base}/${gh.owner}/${gh.repo}/issues/${gh.number}` : `${base}/browse/${key}`;
}
