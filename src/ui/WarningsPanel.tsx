import type { Graph } from "../graph/types";

export function WarningsPanel({ graph, onFocusNode }: { graph: Graph; onFocusNode: (uid: string) => void }) {
  if (graph.cycles.length === 0) return null;
  const byUid = new Map(graph.nodes.map((n) => [n.uid, n]));
  const multiSite = new Set(graph.nodes.map((n) => n.siteId)).size > 1;
  const label = (uid: string) => {
    const n = byUid.get(uid);
    if (!n) return uid;
    return multiSite ? `${n.siteLabel}:${n.key}` : n.key;
  };
  return (
    <ul className="warnings-list">
        {graph.cycles.map((cycle) => (
          <li key={cycle.join(">")}>
            <span className="muted">Blocking cycle: </span>
            {cycle.map((uid) => (
              <span key={uid}>
                <button type="button" className="link-btn mono" onClick={() => onFocusNode(uid)}>
                  {label(uid)}
                </button>
                {" → "}
              </span>
            ))}
            <span className="mono muted">{label(cycle[0])}</span>
          </li>
        ))}
    </ul>
  );
}
