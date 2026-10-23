export type SiteAuth =
  | { type: "apiToken"; email: string; secretRef: string } // secretRef names an OS keychain entry
  | { type: "oauth3lo" }
  | { type: "githubToken"; secretRef: string }; // a GitHub personal access token

/** A Jira Cloud site, or a GitHub host (github.com or GitHub Enterprise Server). */
export type SiteKind = "jira" | "github";

export type SiteConfig = {
  id: string;
  /** Absent on Jira sites (every site was Jira before GitHub support). */
  kind?: SiteKind;
  label: string;
  baseUrl: string;
  cloudId?: string;
  auth: SiteAuth;
  color: string;
  enabled: boolean;
  /** Always ANDed onto every search on this site, e.g. `project = CHANGE`; on GitHub, a search like `org:acme`. */
  baseJql?: string;
};

export const siteKindOf = (site: Pick<SiteConfig, "kind">): SiteKind => site.kind ?? "jira";

/** Where Jira data comes from: bundled fixtures or live Jira REST v3 (via the Rust core). */
export type BackendKind = "mock" | "jira";

export type DominoConfig = {
  sites: SiteConfig[];
  defaultSiteIds: string[];
  backend: BackendKind;
};

export type OAuthStatus = { appConfigured: boolean; connected: boolean };

/** The config file: where it is, and why it couldn't be used (the app then runs on an empty config). */
export type ConfigFileStatus = Readonly<{ problem: string | null; path: string }>;

export type HealthStatus = { state: "unknown" } | { state: "checking" } | { state: "ok" } | { state: "error"; message: string };
