import { ReactFlowProvider } from "@xyflow/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { summaryUid } from "./graph/collapse";
import { computeInsights } from "./graph/insights";
import { configStore, jiraSource, openExternal } from "./platform";
import { useDomino } from "./state/useDomino";
import { DEFAULT_ESTIMATE_SETTINGS, ESTIMATE_SETTINGS_KEY, parseEstimateSettings } from "./state/estimateSettings";
import { oneOf, usePersistentState } from "./state/storage";
import { useStatusHistory } from "./state/useStatusHistory";
import { Canvas, useFocusNode, type Filters, type ViewOptions } from "./ui/Canvas";
import { ErrorBanner } from "./ui/ErrorBanner";
import { FilterPanel } from "./ui/FilterPanel";
import { InsightsBar } from "./ui/InsightsBar";
import { QuickFind } from "./ui/QuickFind";
import { ScopeInputs } from "./ui/ScopeInputs";
import { SettingsDialog } from "./ui/Settings/SettingsDialog";
import { SiteSelector } from "./ui/SiteSelector";
import { Timeline } from "./ui/timeline/Timeline";
import { localToday } from "./ui/timeline/timelineLayout";
import { isViewMode, ViewToggle, type ViewMode } from "./ui/ViewToggle";
import { WarningsPanel } from "./ui/WarningsPanel";

const DEFAULT_FILTERS: Filters = { blocks: true, relates: false, duplicates: false, crossSite: true };
const DEFAULT_VIEW: ViewOptions = { groupBy: "none", highlight: "none", collapseEpics: false };
const parseViewMode = oneOf(isViewMode);

/** Focus a timeline row by uid (the graph view uses React Flow's viewport instead). */
function focusTimelineRow(uid: string) {
  const el = document.querySelector<HTMLElement>(`[data-tl-uid="${CSS.escape(uid)}"]`);
  el?.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
  el?.focus({ preventScroll: true });
}

/** `g` / `t` switch between Graph and Timeline when focus isn't in a text field. */
function useViewHotkeys(setViewMode: (m: ViewMode) => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target instanceof HTMLElement && e.target.matches("input, textarea, select, [contenteditable]")) return;
      if (e.key === "g") setViewMode("graph");
      if (e.key === "t") setViewMode("timeline");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setViewMode]);
}

export function App() {
  return (
    <ReactFlowProvider>
      <Shell />
    </ReactFlowProvider>
  );
}

function Shell() {
  const domino = useDomino(configStore, jiraSource);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [view, setView] = useState(DEFAULT_VIEW);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [viewMode, setViewMode] = usePersistentState<ViewMode>("domino.view", parseViewMode, "graph");
  const focusGraphNode = useFocusNode();
  const { config, load, graph } = domino;
  // Status history feeds aging in both views and the Timeline; one bulk request per site per load.
  const history = useStatusHistory(jiraSource, graph, true);
  const [estimates, setEstimates] = usePersistentState(ESTIMATE_SETTINGS_KEY, parseEstimateSettings, DEFAULT_ESTIMATE_SETTINGS);
  const insights = useMemo(
    () =>
      computeInsights(
        graph,
        history.status === "done"
          ? { history: history.history, today: localToday(), daysPerPoint: estimates.daysPerPoint, defaultDays: estimates.defaultDays }
          : undefined,
      ),
    [graph, history, estimates.daysPerPoint, estimates.defaultDays],
  );
  const nodesByUid = useMemo(() => new Map(graph.nodes.map((n) => [n.uid, n])), [graph]);
  const [expandedEpics, setExpandedEpics] = useState<ReadonlySet<string>>(new Set());
  const toggleEpic = useCallback(
    (epicUid: string) =>
      setExpandedEpics((cur) => {
        const next = new Set(cur);
        if (!next.delete(epicUid)) next.add(epicUid);
        return next;
      }),
    [],
  );
  /** In the epic map, an issue inside a collapsed epic is revealed by expanding that epic first. */
  const focusInGraph = (uid: string) => {
    const epicUid = nodesByUid.get(uid)?.epic?.uid;
    const hidden = view.collapseEpics && !nodesByUid.get(uid)?.ghost && epicUid && !expandedEpics.has(epicUid);
    if (!hidden) return void focusGraphNode(uid);
    if (epicUid === uid) return void focusGraphNode(summaryUid(epicUid));
    toggleEpic(epicUid);
    // Wait for the re-layout to render the issue, then focus it.
    let tries = 0;
    const retry = () => !focusGraphNode(uid) && ++tries < 10 && setTimeout(retry, 120);
    setTimeout(retry, 120);
  };
  const focusIssue = viewMode === "graph" ? focusInGraph : focusTimelineRow;
  useViewHotkeys(setViewMode);

  const errors = load.status === "done" ? load.result.errors : [];
  const full = graph.nodes.filter((n) => !n.ghost).length;

  return (
    <div className="app">
      <header className="topbar">
        <h1 className="brand">
          <span aria-hidden="true">▣▣</span> Domino
        </h1>
        {config && (
          <>
            <SiteSelector sites={config.sites} selected={domino.selected} onChange={domino.setSelected} />
            <ScopeInputs sites={domino.selectedSites} scope={domino.scope} onApply={domino.setScope} />
          </>
        )}
        <QuickFind nodes={graph.nodes} showSite={domino.loadedSiteCount > 1} onPick={focusIssue} />
        <ViewToggle value={viewMode} onChange={setViewMode} />

        <button type="button" className="icon-btn" onClick={domino.reload} aria-label="Reload" title="Reload">
          ↻
        </button>
        <button type="button" className="icon-btn" onClick={() => setSettingsOpen(true)} aria-label="Settings" title="Settings">
          ⚙
        </button>
      </header>

      {domino.configError && (
        <div className="banner error" role="alert">
          Could not load configuration: {domino.configError}
        </div>
      )}
      {config && <ErrorBanner errors={errors} sites={config.sites} attempted={domino.selectedSites.length} />}

      <main className="workspace">
        <aside className="sidebar" aria-label="Filters and warnings">
          <InsightsBar
            nodes={nodesByUid}
            onPick={focusIssue}
            summary={
              load.status === "loading"
                ? "Loading…"
                : load.status === "done" && load.result.kind === "ok"
                  ? `${full} issues · ${graph.nodes.length - full} outside scope`
                  : ""
            }
            insights={insights}
            highlight={view.highlight}
            onHighlight={(highlight) => setView({ ...view, highlight })}
            onShowCycle={() => graph.cycles[0] && focusIssue(graph.cycles[0][0])}
          />
          <FilterPanel filters={filters} onFilters={setFilters} view={view} onView={setView} epicMapAvailable={viewMode === "graph"} />
          <WarningsPanel graph={graph} onFocusNode={focusIssue} />
          <Legend />
        </aside>
        <section className="canvas" aria-label={viewMode === "graph" ? "Dependency graph" : "Timeline"}>
          {viewMode === "graph" ? (
            <Canvas
              graph={graph}
              insights={insights}
              filters={filters}
              view={view}
              showSiteBadges={domino.loadedSiteCount > 1}
              expandedEpics={expandedEpics}
              onToggleEpic={toggleEpic}
            />
          ) : (
            <Timeline
              graph={graph}
              insights={insights}
              filters={filters}
              view={view}
              history={history}
              settings={estimates}
              onSettings={setEstimates}
              onOpen={openExternal}
            />
          )}
          <CanvasMessage domino={domino} />
        </section>
      </main>

      <SettingsDialog domino={domino} open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}

function CanvasMessage({ domino }: { domino: ReturnType<typeof useDomino> }) {
  const { load, selectedSites, graph } = domino;
  let msg: React.ReactNode = null;
  if (selectedSites.length === 0 && domino.config) msg = "Select at least one site, or add one in Settings (⚙).";
  else if (load.status === "failed") msg = `Loading failed: ${load.message}`;
  else if (load.status === "done" && load.result.kind === "overCap")
    msg = (
      <>
        <strong>Too many issues ({load.result.count}+).</strong> Domino shows at most 300. Narrow the scope with a tighter JQL, an epic, or a smaller depth.
      </>
    );
  else if (load.status === "done" && load.result.kind === "ok" && graph.nodes.length === 0 && load.result.errors.length === 0)
    msg = "No issues match this scope.";
  if (!msg) return null;
  return (
    <div className="canvas-message" role="status">
      {msg}
    </div>
  );
}

function Legend() {
  return (
    <section className="panel" aria-labelledby="legend-h">
      <h2 id="legend-h">Legend</h2>
      <ul className="legend-list">
        <li><span className="swatch status-todo" aria-hidden="true" /> To Do</li>
        <li><span className="swatch status-inprogress" aria-hidden="true" /> In Progress</li>
        <li><span className="swatch status-done" aria-hidden="true" /> Done</li>
        <li><span className="legend legend-cycle" aria-hidden="true" /> Blocking cycle</li>
        <li><span className="legend legend-critical" aria-hidden="true" /> Critical path</li>
        <li><span className="swatch ghost-swatch" aria-hidden="true" /> Outside scope</li>
      </ul>
      <p className="hint">Hover or focus a card to trace its blockers. Enter or click opens it in Jira.</p>
      <p className="hint">
        <kbd>/</kbd> find · <kbd>g</kbd> graph · <kbd>t</kbd> timeline
      </p>
    </section>
  );
}
