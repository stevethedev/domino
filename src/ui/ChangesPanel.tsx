import { CHANGE_LABEL, type ChangeKind, type Changes } from "../graph/changes";
import type { Highlight } from "../graph/insights";
import type { GraphNode } from "../graph/types";

const ORDER: readonly ChangeKind[] = ["blocked", "unblocked", "done", "aging", "new", "moved"];
const MAX_LISTED = 8;

function since(iso: string): string {
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** What changed in this scope since it was last marked as seen. */
export function ChangesPanel({
  changes,
  nodes,
  highlight,
  onHighlight,
  onPick,
  onMarkSeen,
}: {
  changes: Changes | null;
  nodes: ReadonlyMap<string, GraphNode>;
  highlight: Highlight;
  onHighlight: (h: Highlight) => void;
  onPick: (uid: string) => void;
  onMarkSeen: () => void;
}) {
  if (!changes) return null;
  const total = changes.byIssue.size;
  // Most actionable first: newly blocked, then unblocked, done, aging, new, moved.
  const listed = [...changes.byIssue]
    .sort(([, a], [, b]) => ORDER.indexOf(a[0]) - ORDER.indexOf(b[0]))
    .slice(0, MAX_LISTED);
  return (
    <>
      <p className="sb-meta" title={new Date(changes.since).toLocaleString()}>
        Marked seen {since(changes.since)}
      </p>
      {total === 0 && changes.newLinks === 0 && changes.leftScope === 0 ? (
        <p className="hint">Nothing has changed in this scope.</p>
      ) : (
        <>
          <button
            type="button"
            className="change-summary"
            aria-pressed={highlight === "changed"}
            onClick={() => onHighlight(highlight === "changed" ? "none" : "changed")}
            title="Highlight changed issues"
          >
            {ORDER.filter((k) => changes.counts[k] > 0).map((k) => (
              <span key={k} className={`chg chg-${k}`}>
                {changes.counts[k]} {CHANGE_LABEL[k].toLowerCase()}
              </span>
            ))}
            {changes.newLinks > 0 && <span className="chg">+{changes.newLinks} {changes.newLinks === 1 ? "link" : "links"}</span>}
            {changes.leftScope > 0 && <span className="chg">{changes.leftScope} left scope</span>}
          </button>
          {listed.length > 0 && (
            <ul className="change-list">
              {listed.map(([uid, kinds]) => {
                const n = nodes.get(uid);
                if (!n) return null;
                return (
                  <li key={uid}>
                    <button type="button" onClick={() => onPick(uid)} aria-label={`${n.key}, ${n.summary}: ${kinds.map((k) => CHANGE_LABEL[k]).join(", ")}`}>
                      <span className="card-key">{n.key}</span>
                      <span className={`chg chg-${kinds[0]}`}>{CHANGE_LABEL[kinds[0]]}</span>
                      <span className="change-summary-text">{n.summary}</span>
                    </button>
                  </li>
                );
              })}
              {total > listed.length && <li className="muted small">and {total - listed.length} more (highlight to see all)</li>}
            </ul>
          )}
        </>
      )}
      <button type="button" className="mark-seen" onClick={onMarkSeen}>
        Mark as seen
      </button>
    </>
  );
}
