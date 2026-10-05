import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { ConfigStore } from "../config/ConfigStore";
import type { DominoConfig, HealthStatus, SiteConfig } from "../config/types";
import { errorMessage } from "../data/errors";
import type { JiraSource } from "../data/JiraSource";
import { DEFAULT_PRESET_ID, presetById } from "../data/jqlPresets";
import { MultiSiteLoader, type LoadResult, type Scope } from "../data/MultiSiteLoader";
import { mergeBySite, type LaggingSite, type SiteAges } from "./refresh";
import { loadKeyOf, scopeKeyOf } from "./scopeKey";
import { readStored, writeStored } from "./storage";
import { buildGraph } from "../graph/buildGraph";
import type { Graph } from "../graph/types";

export type LoadState =
  | { status: "idle" }
  | { status: "loading" }
  /**
   * `scopeKey` identifies what was loaded, so consumers never pair a result with a newer scope.
   * `ages` says when each site's data was fetched (a site whose refresh failed keeps older data).
   */
  | { status: "done"; result: LoadResult; scopeKey: string; ages: SiteAges }
  | { status: "failed"; message: string };

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

export type Domino = {
  config: DominoConfig | null;
  configError: string | null;
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
  graph: Graph;
  loadedSiteCount: number;
  /** Loads the scope again from scratch (shows "Loading…"). */
  reload: () => void;
  /** Re-fetches the scope in the background, keeping the current graph on screen (see `BackgroundRefresh`). */
  refresh: () => Promise<void>;
  background: BackgroundRefresh;
  saveConfig: (next: DominoConfig) => Promise<DominoConfig>;
  /** Re-reads config the backend may have changed on its own (e.g. discovered cloudIds). */
  refreshConfig: () => Promise<void>;
  health: Record<string, HealthStatus>;
  testConnection: (siteId: string) => Promise<void>;
  store: ConfigStore;
};

export type BackgroundRefresh = {
  /** When the data on screen was last confirmed current (epoch ms), by any load or refresh. */
  lastUpdated: number | null;
  refreshing: boolean;
  /** Why the last background refresh didn't update the data, if it didn't. */
  error: string | null;
  /** Sites whose last refresh failed, still shown with older data. */
  lagging: readonly LaggingSite[];
};

/** App state: config, site selection, scope -> load -> graph. UI components get Graph, never raw data. */
export function useDomino(store: ConfigStore, source: JiraSource): Domino {
  const [config, setConfig] = useState<DominoConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [scope, setScope] = useState<Scope>(() => ({ mode: "jql", jql: loadQuery() }));
  const [load, setLoad] = useState<LoadState>({ status: "idle" });
  const [health, setHealth] = useState<Record<string, HealthStatus>>({});
  const [reloadTick, setReloadTick] = useState(0);
  const loader = useMemo(() => new MultiSiteLoader(source), [source]);
  const prevEnabled = useRef<Set<string> | null>(null);
  const [background, setBackground] = useState<BackgroundRefresh>({ lastUpdated: null, refreshing: false, error: null, lagging: [] });
  // Bumped by every foreground load, so a background refresh started before it is discarded.
  const loadGeneration = useRef(0);
  const refreshInFlight = useRef(false);

  useEffect(() => {
    store.load().then(setConfig, (e: unknown) => {
      setConfigError(errorMessage(e));
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
    setLoad({ status: "loading" });
    const scopeKey = scopeKeyOf(sites, sc);
    loader.load(sc, sites, cfg.sites).then(
      (result) => {
        if (cancelled) return;
        const merged = mergeBySite(null, result, Date.now());
        setLoad({ status: "done", result: merged.result, scopeKey, ages: merged.ages });
        setBackground({ lastUpdated: Date.now(), refreshing: false, error: null, lagging: [] });
      },
      (e: unknown) => {
        if (!cancelled) setLoad({ status: "failed", message: errorMessage(e) });
      },
    );
    return (): void => {
      cancelled = true;
    };
  }, [loadKey, loader, reloadTick]);

  const refresh = useCallback(async (): Promise<void> => {
    const { config: cfg, selectedSites: sites, scope: sc, load: current } = latest.current;
    if (!cfg || sites.length === 0 || current.status !== "done" || refreshInFlight.current) return;
    const generation = loadGeneration.current;
    const scopeKey = scopeKeyOf(sites, sc);
    const stale = (): boolean => generation !== loadGeneration.current || scopeKey !== current.scopeKey;
    refreshInFlight.current = true;
    setBackground((b) => ({ ...b, refreshing: true }));
    try {
      const next = await loader.load(sc, sites, cfg.sites);
      if (stale()) return;
      const now = Date.now();
      const merged = mergeBySite(current, next, now);
      setLoad({ status: "done", result: merged.result, scopeKey, ages: merged.ages });
      setBackground((b) => ({ ...b, lastUpdated: now, error: null, lagging: merged.lagging }));
    } catch (e: unknown) {
      if (!stale()) setBackground((b) => ({ ...b, error: `Refresh failed: ${errorMessage(e)}` }));
    } finally {
      refreshInFlight.current = false;
      setBackground((b) => ({ ...b, refreshing: false }));
    }
  }, [loader]);

  // Keyed on the result, not the load state: a refresh that only updates the sites' ages (or
  // brings identical data) keeps the same graph.
  const result = load.status === "done" ? load.result : null;
  const graph = useMemo(() => {
    if (!config || result?.kind !== "ok") return EMPTY_GRAPH;
    return buildGraph({ sites: config.sites, data: result.data });
  }, [config, result]);

  const loadedSiteCount = load.status === "done" && load.result.kind === "ok" ? load.result.data.length : 0;

  const saveConfig = useCallback(
    async (next: DominoConfig) => {
      const saved = await store.save(next);
      setConfig(saved);
      return saved;
    },
    [store],
  );

  /** Re-reads config the backend may have changed on its own (e.g. discovered cloudIds). */
  const refreshConfig = useCallback(async () => {
    setConfig(await store.load());
  }, [store]);

  const applyScope = useCallback(
    (next: Scope, siteIds?: readonly string[]) => {
      const { config: cfg, selectedSites: sites, scope: cur, load: current } = latest.current;
      const nextSites = cfg && siteIds ? selectedSitesOf(cfg.sites, siteIds) : sites;
      if (sites.length > 0 && scopeKeyOf(nextSites, next) === scopeKeyOf(sites, cur)) {
        if (current.status === "done") void refresh();
        else setReloadTick((t) => t + 1);
        return;
      }
      if (siteIds) setSelected([...siteIds]);
      setScope(next);
    },
    [refresh],
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
    selected,
    setSelected,
    selectedSites,
    scope,
    setScope,
    applyScope,
    load,
    graph,
    loadedSiteCount,
    reload: () => {
      setReloadTick((t) => t + 1);
    },
    refresh,
    background,
    saveConfig,
    refreshConfig,
    health,
    testConnection,
    store,
  };
}
