import { useCallback, useEffect, useMemo, useState } from "react";
import { diffSnapshot, parseSnapshot, takeSnapshot, type Changes, type Snapshot } from "../graph/changes";
import type { Insights } from "../graph/insights";
import type { Graph } from "../graph/types";
import { readStored, writeStored } from "./storage";

const SNAPSHOTS_KEY = "domino.snapshots";
/** Scopes remembered; the least recently seen are dropped first. */
const MAX_SCOPES = 12;

type Store = Record<string, Snapshot>;

const parseStore = (raw: unknown): Store | undefined => {
  if (!raw || typeof raw !== "object") return undefined;
  const out: Store = {};
  for (const [k, v] of Object.entries(raw)) {
    const s = parseSnapshot(v);
    if (s) out[k] = s;
  }
  return out;
};

function saveSnapshot(scopeKey: string, snap: Snapshot) {
  const store = readStored(SNAPSHOTS_KEY, parseStore, {});
  const kept = Object.entries({ ...store, [scopeKey]: snap })
    .sort(([, a], [, b]) => b.takenAt.localeCompare(a.takenAt))
    .slice(0, MAX_SCOPES);
  writeStored(SNAPSHOTS_KEY, Object.fromEntries(kept));
}

/**
 * Changes in this scope since the user last marked it seen. The first visit to a scope records
 * a baseline (once aging is known, so it isn't reported as new later) and reports nothing.
 */
export function useChanges(scopeKey: string | null, graph: Graph, insights: Insights, ready: boolean, hasAging: boolean) {
  // Tagged with its scope so switching scopes never compares against another scope's baseline.
  const [baseline, setBaseline] = useState<{ scopeKey: string; snap: Snapshot } | null>(null);

  useEffect(() => {
    if (!scopeKey || !ready) return;
    const stored = readStored(SNAPSHOTS_KEY, parseStore, {})[scopeKey];
    if (stored) {
      setBaseline({ scopeKey, snap: stored });
    } else if (hasAging) {
      const snap = takeSnapshot(graph, insights, true);
      saveSnapshot(scopeKey, snap);
      setBaseline({ scopeKey, snap });
    }
  }, [scopeKey, ready, hasAging, graph, insights]);

  const changes: Changes | null = useMemo(
    () => (baseline && ready && baseline.scopeKey === scopeKey ? diffSnapshot(baseline.snap, graph, insights, hasAging) : null),
    [baseline, ready, scopeKey, graph, insights, hasAging],
  );

  const markSeen = useCallback(() => {
    if (!scopeKey) return;
    const snap = takeSnapshot(graph, insights, hasAging);
    saveSnapshot(scopeKey, snap);
    setBaseline({ scopeKey, snap });
  }, [scopeKey, graph, insights, hasAging]);

  return { changes, markSeen };
}
