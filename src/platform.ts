import { openUrl } from "@tauri-apps/plugin-opener";
import type { ConfigStore } from "./config/ConfigStore";
import { TauriConfigStore } from "./config/TauriConfigStore";
import type { JiraSource } from "./data/JiraSource";
import { TauriSource } from "./data/TauriSource";

// Everything goes through the Rust core. In `npm run dev:web` the same invoke() calls are
// answered by src/dev/mockIpc.ts instead.
export const configStore: ConfigStore = new TauriConfigStore();
export const jiraSource: JiraSource = new TauriSource();

/** Opens an https URL in the system browser. */
export function openExternal(url: string): void {
  if (!/^https:\/\//i.test(url)) return;
  openUrl(url).catch(() => window.open(url, "_blank", "noopener,noreferrer"));
}

export const openIssue = openExternal;
