import { useEffect, useRef } from "react";
import type { Graph } from "../graph/types";
import { newlyUnblocked, unblockedMessage } from "../graph/unblocked";

/**
 * Notifies when a load or refresh unblocks the signed-in user's issues. Compares only when the
 * loaded data actually changed (`graph` identity: identical refreshes keep the same graph) and only
 * within one scope, so first loads and scope switches never notify. The baseline is kept even while
 * disabled, so turning it on doesn't report stale changes.
 */
export function useUnblockedNotifications(
  enabled: boolean,
  scopeKey: string | null,
  graph: Graph,
  blocked: ReadonlySet<string>,
  mine: ReadonlySet<string>,
  notify: (title: string, body: string) => Promise<void>,
): void {
  const previous = useRef<{ scopeKey: string; graph: Graph; blocked: ReadonlySet<string> } | null>(null);
  useEffect(() => {
    if (!scopeKey || graph.nodes.length === 0) return;
    const prev = previous.current;
    if (prev?.graph === graph) return;
    previous.current = { scopeKey, graph, blocked };
    if (!enabled || prev?.scopeKey !== scopeKey) return;
    const unblocked = newlyUnblocked(prev.blocked, blocked, graph.nodes, mine);
    if (unblocked.length === 0) return;
    const { title, body } = unblockedMessage(unblocked);
    notify(title, body).catch((e: unknown) => {
      console.error("Couldn't show a notification", e);
    });
  }, [enabled, scopeKey, graph, blocked, mine, notify]);
}
