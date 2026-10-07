export type SiteAuth =
  | { type: "apiToken"; email: string; secretRef: string } // secretRef names an OS keychain entry
  | { type: "oauth3lo" };

export type SiteConfig = {
  id: string;
  label: string;
  baseUrl: string;
  cloudId?: string;
  auth: SiteAuth;
  color: string;
  enabled: boolean;
  /** Always ANDed onto every search on this site, e.g. `project = CHANGE`. */
  baseJql?: string;
};

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
