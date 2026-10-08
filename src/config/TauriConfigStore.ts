import { invoke } from "@tauri-apps/api/core";
import { errorMessage } from "../data/errors";
import type { ConfigStore } from "./ConfigStore";
import { parseConfig } from "./schema";
import type { ConfigFileStatus, DominoConfig, HealthStatus, OAuthStatus } from "./types";

export class TauriConfigStore implements ConfigStore {
  async load(): Promise<DominoConfig> {
    return parseConfig(await invoke("get_config"));
  }

  async save(config: DominoConfig): Promise<DominoConfig> {
    return parseConfig(await invoke("save_config", { config }));
  }

  fileStatus(): Promise<ConfigFileStatus> {
    return invoke("config_status");
  }

  async reloadFile(): Promise<DominoConfig> {
    return parseConfig(await invoke("reload_config"));
  }

  async startFresh(): Promise<{ config: DominoConfig; setAside: string | null }> {
    const res = await invoke<{ config: unknown; setAside: string | null }>("start_fresh_config");
    return { config: parseConfig(res.config), setAside: typeof res.setAside === "string" ? res.setAside : null };
  }

  async revealFile(): Promise<void> {
    await invoke("reveal_config");
  }

  async health(siteId: string): Promise<HealthStatus> {
    try {
      await invoke("site_health", { siteId });
      return { state: "ok" };
    } catch (e) {
      return { state: "error", message: errorMessage(e) };
    }
  }

  async setSecret(secretRef: string, value: string): Promise<void> {
    await invoke("set_secret", { secretRef, value });
  }

  secretStatus(secretRef: string): Promise<boolean> {
    return invoke("secret_status", { secretRef });
  }

  oauthStatus(): Promise<OAuthStatus> {
    return invoke("oauth_status");
  }

  oauthConnect(): Promise<string[]> {
    return invoke("oauth_connect");
  }

  oauthCancel(): Promise<void> {
    return invoke("oauth_cancel");
  }

  oauthDisconnect(): Promise<void> {
    return invoke("oauth_disconnect");
  }
}
