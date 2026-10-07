import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { ConfigStore } from "../config/ConfigStore";
import type { ConfigFileStatus, DominoConfig, HealthStatus, OAuthStatus, SiteConfig } from "../config/types";
import { errorMessage } from "../data/errors";
import type { JiraSource } from "../data/JiraSource";
import { DEFAULT_PRESET_ID, presetById } from "../data/jqlPresets";
import { isAbortError, MultiSiteLoader, type LoadResult, type Scope } from "../data/MultiSiteLoader";
import type { TicketCache } from "../data/TicketCache";
import { fingerprintsOf, pruneShown, rememberScope, withoutSitesInLoad, withoutSitesInMemory, type Shown } from "./cacheState";
import { pendingProgress, shownOf, withSiteDone, type LoadState } from "./loadView";
import { mergeBySite, type LaggingSite } from "./refresh";
import { loadKeyOf, scopeKeyOf } from "./scopeKey";
import { readStored, writeStored } from "./storage";
import { buildGraph } from "../graph/buildGraph";
import type { Graph } from "../graph/types";

export type { LoadState } from "./loadView";

const QUERY_KEY = "domino.query";
const asString = (raw: unknown): string | undefined => (typeof raw === "string" ? raw : undefined);

/** The last-run top-bar query, remembered per viewer. */
const loadQuery = (): string => readStored(QUERY_KEY, asString, presetById(DEFAULT_PRESET_ID).jql);
export const saveQuery = (q: string): void => {
  writeStored(QUERY_KEY, q);
};

/** The configured sites a selection of ids loads: enabled ones only. */
export const selectedSitesOf = (sites: readonly SiteConfig[], ids: readonly string[]): SiteConfig[] =>
  sites.filter((s) => s.enabled && ids.includes(s.id));

const EMPTY_GRAPH: Graph = { nodes: [], edges: [], cycles: [], cycleEdgeIds: new Set(), brokenEdgeIds: new Set() };

/** A refresh with identical data rewrites the disk cache at most this often (it's only re-dated). */
const DISK_REWRITE_MS = 30 * 60_000;

export type Domino = {
  config: DominoConfig | null;
  configError: string | null;
  /** The config file's status; its `problem` is set while the app runs on an empty config instead. */
  configFile: ConfigFileStatus | null;
  /** Reads the config file again (after a hand fix); rejects with why it still can't be used. */
  reloadConfigFile: () => Promise<void>;
  /** Bumped whenever a token or the Atlassian sign-in changes: data keyed by it is from before. */
  credentialEpoch: number;
  selected: string[];
  setSelected: Dispatch<SetStateAction<string[]>>;
  selectedSites: SiteConfig[];
  scope: Scope;
  setScope: Dispatch<SetStateAction<Scope>>;
  /**
   * Shows `next` (and the `siteIds`, when given). Asking for exactly what's already shown refreshes
   * it in place instead of loading it again from scratch.
   */
  applyScope: (next: Scope, siteIds?: readonly string[]) => void;
  load: LoadState;
  /** The graph of the tickets on screen (see `shownOf`): this scope's, or the previous one's while loading. */
  graph: Graph;
  loadedSiteCount: number;
  /** Loads the scope again (the tickets on screen stay until it's done). */
  reload: () => void;
  /** Re-fetches the scope in the background, keeping the current graph on screen (see `BackgroundRefresh`). */
  refresh: () => Promise<void>;
  background: BackgroundRefresh;
  saveConfig: (next: DominoConfig) => Promise<DominoConfig>;
  /** Re-reads config the backend may have changed on its own (e.g. discovered cloudIds). */
  refreshConfig: () => Promise<void>;
  /** Forgets every cached ticket (on disk and in memory); what's on screen stays. */
  clearCache: () => Promise<void>;
  health: Record<string, HealthStatus>;
  testConnection: (siteId: string) => Promise<void>;
  /** Config and credentials. Changing a secret or the Atlassian sign-in loads the scope again. */
  store: ConfigStore;
};

export type BackgroundRefresh = {
  /** When the data on screen was last confirmed current (epoch ms), by any load or refresh. */
  lastUpdated: number | null;
  /** When the last load or refresh finished, whether or not it succeeded (paces auto-refresh). */
  lastAttempt: number | null;
  refreshing: boolean;
  /** Why the last background refresh didn't update the data, if it didn't. */
  error: string | null;
  /** Sites whose last load or refresh failed, still shown with older data. */
  lagging: readonly LaggingSite[];
};

/** `shown` updated with a fresh load (merged per site; see mergeBySite). */
function withFresh(
  shown: Shown | null,
  fresh: LoadResult,
  scopeKey: string,
  config: DominoConfig,
  now: number,
): { next: Shown; lagging: readonly LaggingSite[] } {
  const base = shown?.scopeKey === scopeKey ? shown : null;
  const merged = mergeBySite(base, fresh, now);
  const freshSites = Object.entries(merged.ages)
    .filter(([, at]) => at === now)
    .map(([id]) => id);
  const next: Shown = {
    result: merged.result,
    scopeKey,
    // Confirmed by this load unless every site failed and kept what the cache had.
    origin: freshSites.length > 0 || !base ? "network" : base.origin,
    ages: merged.ages,
    fingerprints: { ...base?.fingerprints, ...fingerprintsOf(config, freshSites) },
  };
  return { next, lagging: merged.lagging };
}

/** Which sites a credential change affects: those using a token, or every OAuth site. */
type CredentialChange = Readonly<{ secretRef: string } | { oauth: true }>;

/**
 * New credentials can reach different tickets (or fix a failing site) without changing config,
 * so after one the affected sites' tickets are forgotten (the backend drops their cached copies)
 * and the scope is loaded again.
 */
class ReloadingStore implements ConfigStore {
  constructor(
    private readonly store: ConfigStore,
    private readonly credentialsChanged: (change: CredentialChange) => void,
  ) {}
  load(): Promise<DominoConfig> {
    return this.store.load();
  }
  save(config: DominoConfig): Promise<DominoConfig> {
    return this.store.save(config);
  }
  fileStatus(): Promise<ConfigFileStatus> {
    return this.store.fileStatus();
  }
  reloadFile(): Promise<DominoConfig> {
    return this.store.reloadFile();
  }
  revealFile(): Promise<void> {
    return this.store.revealFile();
  }
  health(siteId: string): Promise<HealthStatus> {
    return this.store.health(siteId);
  }
  secretStatus(secretRef: string): Promise<boolean> {
    return this.store.secretStatus(secretRef);
  }
  oauthStatus(): Promise<OAuthStatus> {
    return this.store.oauthStatus();
  }
  async setSecret(secretRef: string, value: string): Promise<void> {
    await this.store.setSecret(secretRef, value);
    this.credentialsChanged({ secretRef });
  }
  async oauthConnect(): Promise<string[]> {
    const sites = await this.store.oauthConnect();
    this.credentialsChanged({ oauth: true });
    return sites;
  }
  oauthCancel(): Promise<void> {
    return this.store.oauthCancel();
  }
  async oauthDisconnect(): Promise<void> {
    await this.store.oauthDisconnect();
    this.credentialsChanged({ oauth: true });
  }
}

/** App state: config, site selection, scope -> load -> graph. UI components get Graph, never raw data. */
export function useDomino(store: ConfigStore, source: JiraSource, cache: TicketCache): Domino {
  const [config, setConfig] = useState<DominoConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [configFile, setConfigFile] = useState<ConfigFileStatus | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [scope, setScope] = useState<Scope>(() => ({ mode: "jql", jql: loadQuery() }));
  const [load, setLoad] = useState<LoadState>({ status: "idle" });
  const [health, setHealth] = useState<Record<string, HealthStatus>>({});
  const [credentialEpoch, setCredentialEpoch] = useState(0);
  const [reloadTick, setReloadTick] = useState(0);
  const loader = useMemo(() => new MultiSiteLoader(source), [source]);
  const prevEnabled = useRef<Set<string> | null>(null);
  const [background, setBackground] = useState<BackgroundRefresh>({
    lastUpdated: null,
    lastAttempt: null,
    refreshing: false,
    error: null,
    lagging: [],
  });
  // Bumped by every foreground load, so a background refresh started before it is discarded.
  const loadGeneration = useRef(0);
  const refreshInFlight = useRef(false);
  // Scopes seen this session, for switching back instantly (checked against config before use).
  const remembered = useRef<ReadonlyMap<string, Shown>>(new Map());
  // When each scope was last written to the disk cache.
  const writtenAt = useRef(new Map<string, number>());

  useEffect(() => {
    store.load().then(setConfig, (e: unknown) => {
      setConfigError(errorMessage(e));
    });
    store.fileStatus().then(setConfigFile, () => {
      /* only explains a broken file; the config itself loaded or reported its own error */
    });
  }, [store]);

  // Keep the selection in sync with config: drop disabled/removed sites, select newly enabled ones.
  useEffect(() => {
    if (!config) return;
    const enabled = new Set(config.sites.filter((s) => s.enabled).map((s) => s.id));
    const prev = prevEnabled.current;
    prevEnabled.current = enabled;
    setSelected((cur) => {
      if (!prev) return config.defaultSiteIds.filter((id) => enabled.has(id));
      const added = [...enabled].filter((id) => !prev.has(id));
      return [...cur.filter((id) => enabled.has(id)), ...added];
    });
  }, [config]);

  const selectedSites = useMemo(() => (config ? selectedSitesOf(config.sites, selected) : []), [config, selected]);

  // The latest values, read by effects and by refresh() when it runs (possibly from a timer).
  const latest = useRef({ config, selectedSites, scope, load });
  latest.current = { config, selectedSites, scope, load };

  /** Remembers a scope's tickets in memory and, for successful loads, in the disk cache. */
  const keep = useCallback(
    (shown: Shown, cfg: DominoConfig, now: number, changed: boolean) => {
      if (shown.result.kind !== "ok") return;
      remembered.current = rememberScope(remembered.current, shown);
      const last = writtenAt.current.get(shown.scopeKey);
      if (!changed && last !== undefined && now - last < DISK_REWRITE_MS) return;
      writtenAt.current.set(shown.scopeKey, now);
      cache.put(shown.scopeKey, shown.result, shown.ages, cfg).catch((e: unknown) => {
        console.warn("Couldn't cache the tickets:", errorMessage(e));
      });
    },
    [cache],
  );

  // Load again only when something the result depends on changes (see loadKeyOf), not on every
  // new config or scope object: saving Settings unchanged, or renaming a site, keeps the data.
  const loadKey = config ? loadKeyOf(config, selectedSites, scope) : null;
  useEffect(() => {
    const { config: cfg, selectedSites: sites, scope: sc } = latest.current;
    if (!cfg || loadKey === null) return;
    loadGeneration.current++; // every scope change, including "nothing selected", invalidates an in-flight refresh
    if (sites.length === 0) {
      setLoad({ status: "idle" });
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    const scopeKey = scopeKeyOf(sites, sc);
    // Meanwhile show this scope as last seen this session, or else whatever is on screen (the
    // cache may replace that below), minus any site no longer configured the same way.
    const inMemory = pruneShown(remembered.current.get(scopeKey) ?? null, cfg);
    setLoad((prev) => ({
      status: "loading",
      scopeKey,
      shown: inMemory ?? pruneShown(shownOf(prev), cfg),
      progress: pendingProgress(sites),
    }));
    if (!inMemory) {
      void cache.get(scopeKey).then((cached) => {
        if (cancelled || !cached) return;
        const fromCache = pruneShown(
          {
            ...cached,
            origin: "cache",
            fingerprints: fingerprintsOf(
              cfg,
              cached.result.data.map((d) => d.siteId),
            ),
          },
          cfg,
        );
        // Only while still loading this scope, and nothing of it is on screen yet.
        setLoad((prev) =>
          fromCache && prev.status === "loading" && prev.scopeKey === scopeKey && prev.shown?.scopeKey !== scopeKey
            ? { ...prev, shown: fromCache }
            : prev,
        );
      });
    }
    const onSiteDone = (siteId: string, outcome: "loaded" | "failed"): void => {
      if (cancelled) return;
      setLoad((prev) =>
        prev.status === "loading" && prev.scopeKey === scopeKey
          ? { ...prev, progress: withSiteDone(prev.progress, siteId, outcome) }
          : prev,
      );
    };
    loader.load(sc, sites, cfg.sites, { onSiteDone, signal: controller.signal }).then(
      (result) => {
        if (cancelled) return;
        const now = Date.now();
        const before = shownOf(latest.current.load);
        const { next, lagging } = withFresh(before, result, scopeKey, cfg, now);
        setLoad({ status: "done", ...next });
        setBackground({ lastUpdated: now, lastAttempt: now, refreshing: false, error: null, lagging });
        keep(next, cfg, now, next.result !== before?.result);
      },
      (e: unknown) => {
        if (cancelled || isAbortError(e)) return;
        setLoad((prev) => ({ status: "failed", scopeKey, message: errorMessage(e), shown: shownOf(prev) }));
        setBackground((b) => ({ ...b, lastAttempt: Date.now() }));
      },
    );
    return (): void => {
      cancelled = true;
      controller.abort(); // a newer load (or leaving) makes this one moot: stop its requests
    };
  }, [loadKey, loader, cache, keep, reloadTick]);

  const refresh = useCallback(async (): Promise<void> => {
    const { config: cfg, selectedSites: sites, scope: sc, load: current } = latest.current;
    if (!cfg || sites.length === 0 || current.status !== "done" || refreshInFlight.current) return;
    const generation = loadGeneration.current;
    const scopeKey = scopeKeyOf(sites, sc);
    const stale = (): boolean => generation !== loadGeneration.current || scopeKey !== current.scopeKey;
    refreshInFlight.current = true;
    setBackground((b) => ({ ...b, refreshing: true }));
    try {
      const fresh = await loader.load(sc, sites, cfg.sites);
      if (stale()) return;
      const now = Date.now();
      const { next, lagging } = withFresh(current, fresh, scopeKey, cfg, now);
      setLoad({ status: "done", ...next });
      setBackground((b) => ({ ...b, lastUpdated: now, lastAttempt: now, error: null, lagging }));
      keep(next, cfg, now, next.result !== current.result);
    } catch (e: unknown) {
      if (!stale()) setBackground((b) => ({ ...b, lastAttempt: Date.now(), error: `Refresh failed: ${errorMessage(e)}` }));
    } finally {
      refreshInFlight.current = false;
      setBackground((b) => ({ ...b, refreshing: false }));
    }
  }, [loader, keep]);

  // Keyed on the result shown, not the load state: a status change, a refresh that only re-dates
  // the sites, or identical data keeps the same graph.
  const result = shownOf(load)?.result ?? null;
  const graph = useMemo(() => {
    if (!config || result?.kind !== "ok") return EMPTY_GRAPH;
    return buildGraph({ sites: config.sites, data: result.data });
  }, [config, result]);

  const loadedSiteCount = result?.kind === "ok" ? result.data.length : 0;

  const saveConfig = useCallback(
    async (next: DominoConfig) => {
      const saved = await store.save(next);
      setConfig(saved);
      setConfigFile((f) => f && { ...f, problem: null }); // saving wrote a good file
      return saved;
    },
    [store],
  );

  const reloadConfigFile = useCallback(async () => {
    try {
      setConfig(await store.reloadFile());
      setConfigFile((f) => f && { ...f, problem: null });
    } catch (e) {
      const problem = errorMessage(e);
      setConfigFile((f) => f && { ...f, problem });
      throw new Error(problem);
    }
  }, [store]);

  /** Re-reads config the backend may have changed on its own (e.g. discovered cloudIds). */
  const refreshConfig = useCallback(async () => {
    setConfig(await store.load());
  }, [store]);

  const reload = useCallback(() => {
    setReloadTick((t) => t + 1);
  }, []);

  // Their tickets may belong to the previous account, which fingerprints (address, auth type)
  // can't tell: forget them here as the backend does on disk, so a failing new credential shows
  // an error rather than the old account's tickets.
  const credentialsChanged = useCallback(
    (change: CredentialChange) => {
      const sites = latest.current.config?.sites ?? [];
      const affected = new Set(
        sites
          .filter((s) =>
            "oauth" in change ? s.auth.type === "oauth3lo" : s.auth.type === "apiToken" && s.auth.secretRef === change.secretRef,
          )
          .map((s) => s.id),
      );
      const isStale = (siteId: string): boolean => affected.has(siteId);
      remembered.current = withoutSitesInMemory(remembered.current, isStale);
      setLoad((prev) => withoutSitesInLoad(prev, isStale));
      setCredentialEpoch((n) => n + 1);
      reload();
    },
    [reload],
  );
  const credentialStore = useMemo(() => new ReloadingStore(store, credentialsChanged), [store, credentialsChanged]);

  const clearCache = useCallback(async () => {
    remembered.current = new Map();
    writtenAt.current.clear();
    await cache.clear();
  }, [cache]);

  const applyScope = useCallback(
    (next: Scope, siteIds?: readonly string[]) => {
      const { config: cfg, selectedSites: sites, scope: cur, load: current } = latest.current;
      const nextSites = cfg && siteIds ? selectedSitesOf(cfg.sites, siteIds) : sites;
      if (sites.length > 0 && scopeKeyOf(nextSites, next) === scopeKeyOf(sites, cur)) {
        if (current.status === "done") void refresh();
        else reload();
        return;
      }
      if (siteIds) setSelected([...siteIds]);
      setScope(next);
    },
    [refresh, reload],
  );

  const testConnection = useCallback(
    async (siteId: string) => {
      setHealth((h) => ({ ...h, [siteId]: { state: "checking" } }));
      const res = await store.health(siteId);
      setHealth((h) => ({ ...h, [siteId]: res }));
    },
    [store],
  );

  return {
    config,
    configError,
    configFile,
    reloadConfigFile,
    credentialEpoch,
    selected,
    setSelected,
    selectedSites,
    scope,
    setScope,
    applyScope,
    load,
    graph,
    loadedSiteCount,
    reload,
    refresh,
    background,
    saveConfig,
    refreshConfig,
    clearCache,
    health,
    testConnection,
    store: credentialStore,
  };
}
