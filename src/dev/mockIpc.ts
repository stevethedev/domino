// Browser-only stand-in for the Rust core, used by `npm run dev:web` for Playwright checks.
// Never bundled into the Tauri app. Config persists to localStorage (best effort).
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { configSchema } from "../config/schema";
import type { DominoConfig, SiteConfig } from "../config/types";
import { FixtureSource } from "../data/FixtureSource";
import { mockConfig, mockLinkTypes, mockSites } from "../data/mockData";

const KEY = "domino.dev.config";

function readConfig(): DominoConfig {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return configSchema.parse(JSON.parse(raw));
  } catch {
    /* fall back to the bundled config */
  }
  return structuredClone(mockConfig);
}

function writeConfig(c: DominoConfig): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(c));
  } catch {
    /* ignore: private mode etc. */
  }
}

/** Tauri rejects `invoke` with plain strings (not Errors), so the mock does too. */
// oxlint-disable-next-line typescript/prefer-promise-reject-errors -- matching Tauri's string rejections is the point
const rejectLikeTauri = (reason: unknown): Promise<never> => Promise.reject(reason);

/** Thrown by the mock's own checks; `wrap` turns it (like any Error) into its message. */
class MockIpcError extends Error {}

export function installMockIpc(): Promise<void> {
  const failSites = new Set(new URLSearchParams(location.search).getAll("failSite"));
  const source = new FixtureSource(mockSites, mockLinkTypes, failSites);
  const secrets = new Set<string>();
  let config = readConfig();

  const site = (id: string, requireEnabled = true): SiteConfig => {
    const s = config.sites.find((x) => x.id === id);
    if (!s) throw new MockIpcError(`Unknown site "${id}"`);
    if (requireEnabled && !s.enabled) throw new MockIpcError(`${s.label} is disabled`);
    return s;
  };
  const wrap = async <T,>(fn: () => Promise<T>): Promise<T> => {
    if (config.backend === "jira") return rejectLikeTauri("Live Jira needs the desktop app (npm run dev)");
    try {
      return await fn();
    } catch (e) {
      return rejectLikeTauri(e instanceof Error ? e.message : e); // Tauri rejects with strings
    }
  };

  mockWindows("main");
  mockIPC(async (cmd, payload) => {
    // Every command takes named arguments; the binary payload forms are never used.
    const args: Readonly<Record<string, unknown>> = payload === undefined || Array.isArray(payload) || payload instanceof ArrayBuffer || ArrayBuffer.isView(payload) ? {} : payload;
    const str = (name: string): string => optStr(name) ?? "";
    const optStr = (name: string): string | undefined => {
      const v = args[name];
      return typeof v === "string" ? v : undefined;
    };
    const siteId = str("siteId");
    const key = str("key");
    // small latency so loading states are visible
    await new Promise((r) => setTimeout(r, 30));
    switch (cmd) {
      case "get_config":
        return config;
      case "save_config": {
        const parsed = configSchema.safeParse(args.config);
        if (!parsed.success) return rejectLikeTauri(parsed.error.issues[0]?.message ?? "Invalid config");
        config = parsed.data;
        writeConfig(config);
        return config;
      }
      case "site_health":
        return wrap(async () => void (await source.fetchLinkTypes(site(siteId, false).id)));
      case "fetch_by_jql":
        return wrap(() => source.fetchByJql(site(siteId).id, str("jql"), typeof args.maxResults === "number" ? args.maxResults : undefined));
      case "fetch_epic":
        return wrap(() => source.fetchEpic(site(siteId).id, key, optStr("filter")));
      case "fetch_issue":
        return wrap(() => source.fetchIssue(site(siteId).id, key));
      case "fetch_remote_links":
        return wrap(() => source.fetchRemoteLinks(site(siteId).id, key));
      case "fetch_link_types":
        return wrap(async () => ({ issueLinkTypes: await source.fetchLinkTypes(site(siteId).id) }));
      case "fetch_status_history": {
        const ids = Array.isArray(args.issueIds) ? args.issueIds.filter((x): x is string => typeof x === "string") : [];
        return wrap(async () => ({ issueChangeLogs: await source.fetchStatusHistory(site(siteId).id, ids) }));
      }
      case "fetch_statuses":
        return wrap(() => source.fetchStatuses(site(siteId).id));
      case "fetch_myself":
        return wrap(() => source.fetchMyself(site(siteId).id));
      case "set_secret":
        secrets.add(str("secretRef"));
        return null;
      case "secret_status":
        return secrets.has(str("secretRef"));
      case "oauth_status":
        return { appConfigured: secrets.has("DOMINO_OAUTH_CLIENT_ID") && secrets.has("DOMINO_OAUTH_CLIENT_SECRET"), connected: false };
      case "oauth_connect":
        return rejectLikeTauri("Atlassian sign-in needs the desktop app (npm run dev)");
      case "oauth_disconnect":
        return null;
      case "plugin:opener|open_url":
        window.open(str("url"), "_blank", "noopener,noreferrer");
        return null;
      default:
        return rejectLikeTauri(`mockIpc: unhandled command ${cmd}`);
    }
  });
  return Promise.resolve();
}
