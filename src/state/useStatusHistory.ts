import { useEffect, useMemo, useState } from "react";
import type { JiraSource } from "../data/JiraSource";
import { loadStatusHistory, type HistoryResult } from "../data/statusHistoryLoader";
import type { Graph } from "../graph/types";

export type HistoryState = { status: "idle" | "loading" } | ({ status: "done" } & HistoryResult);

/**
 * Status history for the loaded graph, fetched only while `enabled`. `scopeKey` names what the
 * graph was loaded for: a refreshed graph of the same scope keeps showing the previous history
 * until its own arrives (so aging doesn't blink off on every refresh); another scope never does.
 */
export function useStatusHistory(source: JiraSource, graph: Graph, enabled: boolean, scopeKey: string | null): HistoryState {
  // Results are tagged with the graph (and scope) they were loaded for.
  const [loaded, setLoaded] = useState<{ graph: Graph; scopeKey: string | null; result: HistoryResult } | null>(null);

  useEffect(() => {
    if (!enabled || graph.nodes.length === 0 || loaded?.graph === graph) return;
    let cancelled = false;
    void loadStatusHistory(source, graph).then((result) => {
      if (!cancelled) setLoaded({ graph, scopeKey, result });
    });
    return (): void => {
      cancelled = true;
    };
  }, [source, graph, enabled, loaded, scopeKey]);

  // A stable object per (result, graph): consumers memoize on it, so a fresh object each render would loop.
  return useMemo<HistoryState>(() => {
    const current = loaded?.graph === graph || (scopeKey !== null && loaded?.scopeKey === scopeKey);
    if (loaded && current) return { status: "done", ...loaded.result };
    return { status: enabled && graph.nodes.length > 0 ? "loading" : "idle" };
  }, [loaded, graph, enabled, scopeKey]);
}
