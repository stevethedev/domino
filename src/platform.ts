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

/** `npm run dev:web`: browser APIs stand in for the Tauri plugins. */
const inBrowserPreview = import.meta.env.MODE === "web";

/**
 * Desktop notifications: Tauri's notification plugin in the app, the browser's Notification API in
 * the browser preview. The plugin is imported on first use, so it stays out of the startup bundle.
 */
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

export type SaveFilter = { name: string; extensions: string[] };

/**
 * Saves `data` to a file the user picks: a native save dialog in the app (the dialog grants write
 * access to that one path only), a download in the browser preview. Resolves false if cancelled.
 */
export async function saveFile(suggestedName: string, data: Blob | string, filter: SaveFilter): Promise<boolean> {
  if (inBrowserPreview) {
    const blob = typeof data === "string" ? new Blob([data], { type: "text/plain" }) : data;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = suggestedName;
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 1000);
    return true;
  }
  const [{ save }, { writeFile, writeTextFile }] = await Promise.all([
    import("@tauri-apps/plugin-dialog"),
    import("@tauri-apps/plugin-fs"),
  ]);
  const path = await save({ defaultPath: suggestedName, filters: [filter] });
  if (!path) return false;
  if (typeof data === "string") await writeTextFile(path, data);
  else await writeFile(path, new Uint8Array(await data.arrayBuffer()));
  return true;
}

/** Puts a PNG on the clipboard, ready to paste into chat or a document. */
export async function copyImage(png: Blob): Promise<void> {
  await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
}
