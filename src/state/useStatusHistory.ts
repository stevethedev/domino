import { useEffect, useState } from "react";
import type { JiraSource } from "../data/JiraSource";
import { loadStatusHistory, type HistoryResult } from "../data/statusHistoryLoader";
import type { Graph } from "../graph/types";

export type HistoryState = { status: "idle" | "loading" } | ({ status: "done" } & HistoryResult);

/** Status history for the loaded graph, fetched only while `enabled` (the Timeline view is open). */
export function useStatusHistory(source: JiraSource, graph: Graph, enabled: boolean): HistoryState {
  const [state, setState] = useState<HistoryState>({ status: "idle" });
  const [loadedFor, setLoadedFor] = useState<Graph | null>(null);

  useEffect(() => {
    if (!enabled || loadedFor === graph || graph.nodes.length === 0) return;
    let cancelled = false;
    setState({ status: "loading" });
    loadStatusHistory(source, graph).then((res) => {
      if (cancelled) return;
      setState({ status: "done", ...res });
      setLoadedFor(graph);
    });
    return () => {
      cancelled = true;
    };
  }, [source, graph, enabled, loadedFor]);

  return state;
}
