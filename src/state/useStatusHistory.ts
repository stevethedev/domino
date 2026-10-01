import { useEffect, useMemo, useState } from "react";
import type { JiraSource } from "../data/JiraSource";
import { loadStatusHistory, type HistoryResult } from "../data/statusHistoryLoader";
import type { Graph } from "../graph/types";

export type HistoryState = { status: "idle" | "loading" } | ({ status: "done" } & HistoryResult);

/** Status history for the loaded graph, fetched only while `enabled` (the Timeline view is open). */
export function useStatusHistory(source: JiraSource, graph: Graph, enabled: boolean): HistoryState {
  // Results are tagged with the graph they were loaded for, so a new graph never sees stale history.
  const [loaded, setLoaded] = useState<{ graph: Graph; result: HistoryResult } | null>(null);

  useEffect(() => {
    if (!enabled || graph.nodes.length === 0 || loaded?.graph === graph) return;
    let cancelled = false;
    loadStatusHistory(source, graph).then((result) => !cancelled && setLoaded({ graph, result }));
    return () => {
      cancelled = true;
    };
  }, [source, graph, enabled, loaded]);

  // A stable object per (result, graph): consumers memoize on it, so a fresh object each render would loop.
  return useMemo<HistoryState>(
    () => (loaded?.graph === graph ? { status: "done", ...loaded.result } : { status: enabled && graph.nodes.length > 0 ? "loading" : "idle" }),
    [loaded, graph, enabled],
  );
}
