import type { ReactElement, ReactNode } from "react";
import type { Highlight, Insights } from "../graph/insights";
import type { GraphNode } from "../graph/types";

type Tile = { id: Exclude<Highlight, "none" | "changed">; label: string; count: number; hint: string };

/**
 * The answers Domino exists to give, before any reading: how much is blocked, what can start
 * now, how long the critical chain is, what's aging. Each tile toggles a highlight in the current view.
 * With `only`, the tiles count just those issues (e.g. the signed-in user's).
 */
export function InsightTiles({
  summary,
  insights,
  highlight,
  onHighlight,
  only,
}: {
  /** Load status / counts line, e.g. "12 issues · 6 outside scope · updated 3m ago". */
  summary: ReactNode;
  insights: Insights;
  /** The active highlight for these tiles ("none" when another tile group's highlight is on). */
  highlight: Highlight;
  onHighlight: (h: Highlight) => void;
  only?: ReadonlySet<string>;
}): ReactElement {
  const count = (uids: Iterable<string>): number => (only ? [...uids].filter((u) => only.has(u)).length : [...uids].length);
  const whose = only ? "of these " : "";
  const tiles: Tile[] = [
    { id: "blocked", label: "Blocked", count: count(insights.blocked), hint: `${whose}open issues waiting on an open blocker` },
    { id: "ready", label: "Ready", count: count(insights.ready), hint: `${whose}open issues with nothing in the way` },
    {
      id: "critical",
      label: "Critical path",
      count: count(insights.critical.nodes),
      hint: `${only ? "of these issues" : "issues"} in the longest open blocking chain`,
    },
    {
      id: "aging",
      label: "Aging",
      count: count(insights.aging.keys()),
      hint: `${only ? "of these issues" : "issues"} stuck past twice their estimate, or blocked with no change for a week`,
    },
  ];
  const active = tiles.find((t) => t.id === highlight);
  return (
    <>
      <p className="sb-meta" aria-live="polite">
        {summary}
      </p>
      <div className="insight-tiles">
        {tiles.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`insight insight-${t.id}`}
            aria-pressed={highlight === t.id}
            onClick={() => {
              onHighlight(highlight === t.id ? "none" : t.id);
            }}
            title={`Highlight ${t.count} ${t.hint}`}
          >
            <span className="insight-count">{t.count}</span>
            <span className="insight-label">{t.label}</span>
          </button>
        ))}
      </div>
      <p className="hint" aria-live="polite">
        {active ? `Showing ${active.count} ${active.hint}. Click again to clear.` : "Click a number to highlight those issues."}
      </p>
    </>
  );
}

/** Open issues whose completion unblocks the most open work, biggest first. */
export function FinishFirst({
  insights,
  nodes,
  onPick,
}: {
  insights: Insights;
  nodes: ReadonlyMap<string, GraphNode>;
  /** Focus an issue in the current view (which also traces its blocking chain). */
  onPick: (uid: string) => void;
}): ReactElement {
  if (insights.unblockers.length === 0) return <p className="hint">Nothing open is blocking other open work.</p>;
  return (
    <ol className="finish-first" aria-label="Issues that unblock the most work">
      {insights.unblockers.map((u) => {
        const n = nodes.get(u.uid);
        if (!n) return null;
        const reach = `unblocks ${u.downstream}${u.sites > 1 ? ` on ${u.sites} sites` : ""}`;
        return (
          <li key={u.uid}>
            <button
              type="button"
              onClick={() => {
                onPick(u.uid);
              }}
              title={`${n.key}: ${n.summary}`}
              aria-label={`${n.key}, ${n.summary}, ${reach}, ${n.assigneeName ?? "unassigned"}. Shows it in the current view.`}
            >
              <span className="finish-first-top">
                <span className="card-key">{n.key}</span>
                <span className="finish-first-reach">{reach}</span>
              </span>
              <span className="finish-first-summary">{n.summary}</span>
              <span className="finish-first-who">{n.assigneeName ?? "Unassigned"}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
