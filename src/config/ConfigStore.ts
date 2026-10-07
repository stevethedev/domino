import type { ConfigFileStatus, DominoConfig, HealthStatus, OAuthStatus } from "./types";

/** Persists site configuration. Implementations never see or return secrets. */
export interface ConfigStore {
  load(): Promise<DominoConfig>;
  save(config: DominoConfig): Promise<DominoConfig>;
  /** Whether the config file could be used at startup (or since), and where it is. */
  fileStatus(): Promise<ConfigFileStatus>;
  /** Reads the config file again, after a hand fix; rejects with why it still can't be used. */
  reloadFile(): Promise<DominoConfig>;
  /** Shows the config file in the system file manager. */
  revealFile(): Promise<void>;
  health(siteId: string): Promise<HealthStatus>;
  /** Write-only: hands a secret to the backend keychain. It is never readable afterwards. */
  setSecret(secretRef: string, value: string): Promise<void>;
  /** Whether a secret exists; never its value. */
  secretStatus(secretRef: string): Promise<boolean>;
  oauthStatus(): Promise<OAuthStatus>;
  /** Opens the system browser for Atlassian sign-in; resolves with the accessible site URLs. */
  oauthConnect(): Promise<string[]>;
  oauthDisconnect(): Promise<void>;
}
