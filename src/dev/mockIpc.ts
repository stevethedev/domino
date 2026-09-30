// Browser-only stand-in for the Rust core, used by `npm run dev:web` for Playwright checks.
// Never bundled into the Tauri app. Config persists to localStorage (best effort).
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { configSchema } from "../config/schema";
import type { DominoConfig } from "../config/types";
import { FixtureSource } from "../data/FixtureSource";
import { mockConfig, mockLinkTypes, mockSites } from "../data/mockData";

const KEY = "domino.dev.config";

function readConfig(): DominoConfig {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return configSchema.parse(JSON.parse(raw)) as DominoConfig;
  } catch {
    /* fall back to the bundled config */
  }
  return structuredClone(mockConfig);
}

function writeConfig(c: DominoConfig) {
  try {
    localStorage.setItem(KEY, JSON.stringify(c));
  } catch {
    /* ignore: private mode etc. */
  }
}

export async function installMockIpc() {
  const failSites = new Set(new URLSearchParams(location.search).getAll("failSite"));
  const source = new FixtureSource(mockSites, mockLinkTypes, failSites);
  const secrets = new Set<string>();
  let config = readConfig();

  const site = (id: string, requireEnabled = true) => {
    const s = config.sites.find((x) => x.id === id);
    if (!s) throw `Unknown site "${id}"`;
    if (requireEnabled && !s.enabled) throw `${s.label} is disabled`;
    return s;
  };
  const wrap = async <T,>(fn: () => Promise<T>): Promise<T> => {
    if (config.backend === "jira") throw "Live Jira needs the desktop app (npm run dev)";
    try {
      return await fn();
    } catch (e) {
      throw e instanceof Error ? e.message : e; // Tauri rejects with strings
    }
  };

  mockWindows("main");
  mockIPC(async (cmd, payload) => {
    const a = (payload ?? {}) as Record<string, unknown>;
    const siteId = a.siteId as string;
    const key = a.key as string;
    // small latency so loading states are visible
    await new Promise((r) => setTimeout(r, 30));
    switch (cmd) {
      case "get_config":
        return config;
      case "save_config": {
        const parsed = configSchema.safeParse(a.config);
        if (!parsed.success) throw parsed.error.issues[0]?.message ?? "Invalid config";
        config = parsed.data as DominoConfig;
        writeConfig(config);
        return config;
      }
      case "site_health":
        return wrap(async () => void (await source.fetchLinkTypes(site(siteId, false).id)));
      case "fetch_by_jql":
        return wrap(() => source.fetchByJql(site(siteId).id, a.jql as string, a.maxResults as number | undefined));
      case "fetch_epic":
        return wrap(() => source.fetchEpic(site(siteId).id, key, a.filter as string | undefined));
      case "fetch_issue":
        return wrap(() => source.fetchIssue(site(siteId).id, key));
      case "fetch_remote_links":
        return wrap(() => source.fetchRemoteLinks(site(siteId).id, key));
      case "fetch_link_types":
        return wrap(async () => ({ issueLinkTypes: await source.fetchLinkTypes(site(siteId).id) }));
      case "set_secret":
        secrets.add(a.secretRef as string);
        return null;
      case "secret_status":
        return secrets.has(a.secretRef as string);
      case "oauth_status":
        return { appConfigured: secrets.has("DOMINO_OAUTH_CLIENT_ID") && secrets.has("DOMINO_OAUTH_CLIENT_SECRET"), connected: false };
      case "oauth_connect":
        throw "Atlassian sign-in needs the desktop app (npm run dev)";
      case "oauth_disconnect":
        return null;
      case "plugin:opener|open_url":
        window.open(a.url as string, "_blank", "noopener,noreferrer");
        return null;
      default:
        throw `mockIpc: unhandled command ${cmd}`;
    }
  });
}
