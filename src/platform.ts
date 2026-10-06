import { openUrl } from "@tauri-apps/plugin-opener";
import type { ConfigStore } from "./config/ConfigStore";
import { TauriConfigStore } from "./config/TauriConfigStore";
import type { JiraSource } from "./data/JiraSource";
import { TauriSource } from "./data/TauriSource";
import { TauriTicketCache } from "./data/TauriTicketCache";
import type { TicketCache } from "./data/TicketCache";

// Everything goes through the Rust core. In `npm run dev:web` the same invoke() calls are
// answered by src/dev/mockIpc.ts instead.
export const configStore: ConfigStore = new TauriConfigStore();
export const jiraSource: JiraSource = new TauriSource();
export const ticketCache: TicketCache = new TauriTicketCache();

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

export type SaveFilter = Readonly<{ name: string; extensions: readonly string[] }>;

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
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 1000);
    return true;
  }
  const [{ save }, { writeFile, writeTextFile }] = await Promise.all([
    import("@tauri-apps/plugin-dialog"),
    import("@tauri-apps/plugin-fs"),
  ]);
  const path = await save({ defaultPath: suggestedName, filters: [{ name: filter.name, extensions: [...filter.extensions] }] });
  if (!path) return false;
  if (typeof data === "string") await writeTextFile(path, data);
  else await writeFile(path, new Uint8Array(await data.arrayBuffer()));
  return true;
}

/**
 * Puts a PNG on the clipboard, ready to paste into chat or a document. Takes the image still being
 * rendered: WebKit only allows the write during the click, so it starts now and fills in later.
 */
export function copyImage(png: Promise<Blob>): Promise<void> {
  return navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
}

/** A newer release, ready to download and install. */
export type AvailableUpdate = Readonly<{
  version: string;
  currentVersion: string;
  /** Release notes, as written on the GitHub release. */
  notes?: string;
  /** Downloads and installs it, reporting progress (0..1, or null while the size is unknown), then restarts the app. */
  install: (onProgress: (fraction: number | null) => void) => Promise<void>;
}>;

/** In the browser preview, `localStorage["domino.dev.fakeUpdate"] = "0.9.0"` pretends that version is out. */
const FAKE_UPDATE_KEY = "domino.dev.fakeUpdate";

function fakeUpdate(): AvailableUpdate | null {
  const version = localStorage.getItem(FAKE_UPDATE_KEY);
  if (!version) return null;
  return {
    version,
    currentVersion: "0.1.0",
    notes: "Preview of the update prompt (browser preview only).",
    install: async (onProgress) => {
      for (const step of [0.25, 0.5, 0.75, 1]) {
        await new Promise((resolve) => setTimeout(resolve, 300));
        onProgress(step);
      }
      localStorage.removeItem(FAKE_UPDATE_KEY);
      window.location.reload();
    },
  };
}

/**
 * Asks the release feed (the latest published GitHub release) whether there's a newer version;
 * null when this is the newest. The updater verifies the download's signature before installing.
 */
export async function checkForUpdate(): Promise<AvailableUpdate | null> {
  if (inBrowserPreview) return fakeUpdate();
  const [{ check }, { relaunch }] = await Promise.all([import("@tauri-apps/plugin-updater"), import("@tauri-apps/plugin-process")]);
  const update = await check();
  if (!update) return null;
  return {
    version: update.version,
    currentVersion: update.currentVersion,
    notes: update.body,
    install: async (onProgress) => {
      let total: number | undefined;
      let received = 0;
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") total = event.data.contentLength;
        if (event.event === "Progress") received += event.data.chunkLength;
        onProgress(total ? Math.min(1, received / total) : null);
      });
      await relaunch();
    },
  };
}

/** The running app's version (from the bundle); "dev" in the browser preview. */
export async function appVersion(): Promise<string> {
  if (inBrowserPreview) return "dev";
  const { getVersion } = await import("@tauri-apps/api/app");
  return getVersion();
}
