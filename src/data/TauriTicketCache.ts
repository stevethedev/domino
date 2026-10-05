import { invoke } from "@tauri-apps/api/core";
import type { DominoConfig } from "../config/types";
import { errorMessage } from "./errors";
import { parseCachedScope, toPutEntry, type CachedScope, type OkResult, type SiteTimes, type TicketCache } from "./TicketCache";

/** The ticket cache in the Rust core (encrypted, in the app data folder). */
export class TauriTicketCache implements TicketCache {
  async get(scopeKey: string): Promise<CachedScope | null> {
    try {
      return parseCachedScope(await invoke("cache_get", { scopeKey }), scopeKey);
    } catch (e) {
      console.warn("Couldn't read the ticket cache:", errorMessage(e));
      return null;
    }
  }

  put(scopeKey: string, result: OkResult, ages: SiteTimes, config: DominoConfig): Promise<void> {
    return invoke("cache_put", { entry: toPutEntry(scopeKey, result, ages, config) });
  }

  clear(): Promise<void> {
    return invoke("cache_clear");
  }
}
