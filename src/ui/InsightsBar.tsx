import type { Highlight, Insights } from "../graph/insights";

type Tile = { id: Exclude<Highlight, "none">; label: string; count: number; hint: string };

/**
 * The answers Domino exists to give, before any reading: how much is blocked, what can start
 * now, how long the critical chain is. Each tile toggles a highlight in the current view.
 */
export function InsightsBar({
  summary,
  insights,
  highlight,
  onHighlight,
  onShowCycle,
}: {
  /** Load status / counts line, e.g. "12 issues · 6 outside scope". */
  summary: string;
  insights: Insights;
  highlight: Highlight;
  onHighlight: (h: Highlight) => void;
  onShowCycle: () => void;
}) {
  const tiles: Tile[] = [
    { id: "blocked", label: "Blocked", count: insights.blocked.size, hint: "open issues waiting on an open blocker" },
    { id: "ready", label: "Ready", count: insights.ready.size, hint: "open issues with nothing in the way" },
    { id: "critical", label: "Critical path", count: insights.critical.nodes.length, hint: "issues in the longest open blocking chain" },
  ];
  const active = tiles.find((t) => t.id === highlight);
  return (
    <section className="panel insights" aria-labelledby="insights-h">
      <h2 id="insights-h">At a glance</h2>
      <p className="insights-summary" aria-live="polite">
        {summary}
      </p>
      <div className="insight-tiles">
        {tiles.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`insight insight-${t.id}`}
            aria-pressed={highlight === t.id}
            onClick={() => onHighlight(highlight === t.id ? "none" : t.id)}
            title={`Highlight ${t.count} ${t.hint}`}
          >
            <span className="insight-count">{t.count}</span>
            <span className="insight-label">{t.label}</span>
          </button>
        ))}
        <button
          type="button"
          className="insight insight-cycles"
          disabled={insights.cycleCount === 0}
          onClick={onShowCycle}
          title={insights.cycleCount ? "Show the first blocking cycle" : "No blocking cycles"}
        >
          <span className="insight-count">{insights.cycleCount}</span>
          <span className="insight-label">{insights.cycleCount === 1 ? "Cycle" : "Cycles"}</span>
        </button>
      </div>
      <p className="hint" aria-live="polite">
        {active ? `Showing ${active.count} ${active.hint}. Click again to clear.` : "Click a number to highlight those issues."}
      </p>
    </section>
  );
}
