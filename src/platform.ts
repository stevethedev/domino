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

/**
 * Desktop notifications: Tauri's notification plugin in the app, the browser's Notification API in
 * `npm run dev:web`. The plugin is imported on first use, so it stays out of the startup bundle.
 */
const inBrowserPreview = import.meta.env.MODE === "web";

/** Asks the OS for permission if needed; true when notifications can be shown. */
export async function requestNotificationPermission(): Promise<boolean> {
  if (inBrowserPreview) return "Notification" in window && (await Notification.requestPermission()) === "granted";
  const { isPermissionGranted, requestPermission } = await import("@tauri-apps/plugin-notification");
  return (await isPermissionGranted()) || (await requestPermission()) === "granted";
}

/** Shows a notification if permission was granted (silently does nothing otherwise). */
export async function notify(title: string, body: string): Promise<void> {
  if (inBrowserPreview) {
    if ("Notification" in window && Notification.permission === "granted") new Notification(title, { body });
    return;
  }
  const { isPermissionGranted, sendNotification } = await import("@tauri-apps/plugin-notification");
  if (await isPermissionGranted()) sendNotification({ title, body });
}
