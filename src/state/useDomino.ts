import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ConfigStore } from "../config/ConfigStore";
import type { DominoConfig, HealthStatus, SiteConfig } from "../config/types";
import { errorMessage } from "../data/errors";
import type { JiraSource } from "../data/JiraSource";
import { DEFAULT_PRESET_ID, presetById } from "../data/jqlPresets";
import { MultiSiteLoader, type LoadResult, type Scope } from "../data/MultiSiteLoader";
import { readStored, writeStored } from "./storage";
import { buildGraph } from "../graph/buildGraph";
import type { Graph } from "../graph/types";

export type LoadState =
  | { status: "idle" }
  | { status: "loading" }
  /** `scopeKey` identifies what was loaded, so consumers never pair a result with a newer scope. */
  | { status: "done"; result: LoadResult; scopeKey: string }
  | { status: "failed"; message: string };

const QUERY_KEY = "domino.query";
const asString = (raw: unknown) => (typeof raw === "string" ? raw : undefined);

/** The last-run top-bar query, remembered per viewer. */
const loadQuery = () => readStored(QUERY_KEY, asString, presetById(DEFAULT_PRESET_ID).jql);
export const saveQuery = (q: string) => writeStored(QUERY_KEY, q);

/** Stable identity of a scope: the selected sites plus the query or mode. */
export const scopeKeyOf = (sites: readonly SiteConfig[], scope: Scope) =>
  JSON.stringify({ sites: sites.map((s) => s.id).sort(), scope });

const EMPTY_GRAPH: Graph = { nodes: [], edges: [], cycles: [], cycleEdgeIds: new Set(), brokenEdgeIds: new Set() };

/** App state: config, site selection, scope -> load -> graph. UI components get Graph, never raw data. */
export function useDomino(store: ConfigStore, source: JiraSource) {
  const [config, setConfig] = useState<DominoConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [scope, setScope] = useState<Scope>(() => ({ mode: "jql", jql: loadQuery() }));
  const [load, setLoad] = useState<LoadState>({ status: "idle" });
  const [health, setHealth] = useState<Record<string, HealthStatus>>({});
  const [reloadTick, setReloadTick] = useState(0);
  const loader = useMemo(() => new MultiSiteLoader(source), [source]);
  const prevEnabled = useRef<Set<string> | null>(null);

  useEffect(() => {
    store.load().then(setConfig, (e) => setConfigError(errorMessage(e)));
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

  const selectedSites = useMemo(
    () => (config ? config.sites.filter((s) => s.enabled && selected.includes(s.id)) : []),
    [config, selected],
  );

  useEffect(() => {
    if (!config) return;
    if (selectedSites.length === 0) {
      setLoad({ status: "idle" });
      return;
    }
    let cancelled = false;
    setLoad({ status: "loading" });
    const scopeKey = scopeKeyOf(selectedSites, scope);
    loader.load(scope, selectedSites, config.sites).then(
      (result) => !cancelled && setLoad({ status: "done", result, scopeKey }),
      (e) => !cancelled && setLoad({ status: "failed", message: errorMessage(e) }),
    );
    return () => {
      cancelled = true;
    };
  }, [config, selectedSites, scope, loader, reloadTick]);

  const graph = useMemo(() => {
    if (!config || load.status !== "done" || load.result.kind !== "ok") return EMPTY_GRAPH;
    return buildGraph({ sites: config.sites, data: load.result.data });
  }, [config, load]);

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
  const refreshConfig = useCallback(async () => setConfig(await store.load()), [store]);

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
    load,
    graph,
    loadedSiteCount,
    reload: () => setReloadTick((t) => t + 1),
    saveConfig,
    refreshConfig,
    health,
    testConnection,
    store,
  };
}

export type Domino = ReturnType<typeof useDomino>;
