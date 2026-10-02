import { ReactFlowProvider } from "@xyflow/react";
import { prefersReducedMotion } from "./lib/motion";
import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { summaryUid } from "./graph/collapse";
import { computeInsights, type Highlight, type HighlightScope } from "./graph/insights";
import { myIssues } from "./graph/mine";
import { configStore, jiraSource, openExternal } from "./platform";
import { DEFAULT_REFRESH_MINUTES, parseRefreshMinutes, REFRESH_MINUTES_KEY } from "./state/refresh";
import { useAutoRefresh } from "./state/useAutoRefresh";
import { useDomino } from "./state/useDomino";
import { useMyself } from "./state/useMyself";
import { DEFAULT_ESTIMATE_SETTINGS, ESTIMATE_SETTINGS_KEY, parseEstimateSettings } from "./state/estimateSettings";
import { oneOf, usePersistentState } from "./state/storage";
import { parseSavedViews, SAVED_VIEWS_KEY, upsertView, type SavedView } from "./state/savedViews";
import { saveQuery, scopeKeyOf } from "./state/useDomino";
import { useChanges } from "./state/useChanges";
import { useStatusHistory } from "./state/useStatusHistory";
import { Canvas, lanesFor, useFocusNode, type Filters, type ViewOptions } from "./ui/Canvas";
import { ChangesPanel } from "./ui/ChangesPanel";
import { ErrorBanner } from "./ui/ErrorBanner";
import { FilterPanel } from "./ui/FilterPanel";
import { FinishFirst, InsightTiles } from "./ui/InsightsBar";
import { BrandMark } from "./ui/BrandMark";
import { MyGlance } from "./ui/MyGlance";
import { SidebarSection } from "./ui/SidebarSection";
import { QuickFind } from "./ui/QuickFind";
import { Freshness, RefreshButton } from "./ui/Refresh";
import { ScopeInputs } from "./ui/ScopeInputs";
import { SavedViewsMenu } from "./ui/SavedViewsMenu";
import { SiteSelector } from "./ui/SiteSelector";
import { FOLD_MS, localToday } from "./ui/timeline/timelineLayout";
import { isViewMode, ViewToggle, type ViewMode } from "./ui/ViewToggle";
import { WarningsPanel } from "./ui/WarningsPanel";
import { Icon } from "./ui/Icon";

// Split out of the startup bundle: the timeline loads on first switch to it, Settings on first open.
const Timeline = lazy(() => import("./ui/timeline/Timeline").then((m) => ({ default: m.Timeline })));
const SettingsDialog = lazy(() => import("./ui/Settings/SettingsDialog").then((m) => ({ default: m.SettingsDialog })));

const DEFAULT_FILTERS: Filters = { blocks: true, relates: false, duplicates: false, crossSite: true };
const DEFAULT_VIEW: ViewOptions = { groupBy: "none", highlight: "none", highlightScope: "all", collapseEpics: false };
const parseViewMode = oneOf(isViewMode);

/** Focus a timeline row by uid (the graph view uses React Flow's viewport instead). Returns whether it was found. */
function focusTimelineRow(uid: string): boolean {
  const el = document.querySelector<HTMLElement>(`[data-tl-uid="${CSS.escape(uid)}"]`);
  el?.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
  el?.focus({ preventScroll: true });
  return el !== null;
}

const COLLAPSED_LANES_KEY = "domino.timeline.collapsedLanes";
/** Remembered collapsed lanes; capped so ids from long-gone scopes don't pile up. */
const MAX_COLLAPSED_LANES = 200;
const parseLaneIds = (raw: unknown): string[] | undefined =>
  Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string").slice(-MAX_COLLAPSED_LANES) : undefined;

/** `g` / `t` switch between Graph and Timeline when focus isn't in a text field. */
function useViewHotkeys(setViewMode: (m: ViewMode) => void): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target instanceof HTMLElement && e.target.matches("input, textarea, select, [contenteditable]")) return;
      if (e.key === "g") setViewMode("graph");
      if (e.key === "t") setViewMode("timeline");
    };
    window.addEventListener("keydown", onKey);
    return (): void => {
      window.removeEventListener("keydown", onKey);
    };
  }, [setViewMode]);
}

export function App(): ReactElement {
  return (
    <ReactFlowProvider>
      <Shell />
    </ReactFlowProvider>
  );
}

function Shell(): ReactElement {
  const domino = useDomino(configStore, jiraSource);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [view, setView] = useState(DEFAULT_VIEW);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Settings is code-split: mount it on first open, then keep it mounted like before.
  const [settingsEverOpened, setSettingsEverOpened] = useState(false);
  useEffect(() => {
    if (settingsOpen) setSettingsEverOpened(true);
  }, [settingsOpen]);
  const [viewMode, setViewMode] = usePersistentState<ViewMode>("domino.view", parseViewMode, "graph");
  const focusGraphNode = useFocusNode();
  const [collapsedLaneIds, setCollapsedLaneIds] = usePersistentState(COLLAPSED_LANES_KEY, parseLaneIds, []);
  const collapsedLanes = useMemo<ReadonlySet<string>>(() => new Set(collapsedLaneIds), [collapsedLaneIds]);
  const setCollapsedLanes = (next: ReadonlySet<string>): void => {
    setCollapsedLaneIds([...next].slice(-MAX_COLLAPSED_LANES));
  };
  const [refreshMinutes, setRefreshMinutes] = usePersistentState(REFRESH_MINUTES_KEY, parseRefreshMinutes, DEFAULT_REFRESH_MINUTES);
  useAutoRefresh(domino.refresh, refreshMinutes * 60_000, domino.background.lastUpdated);
  const { config, load, graph } = domino;
  // Status history feeds aging in both views and the Timeline; one bulk request per site per load.
  const loadedScopeKey = load.status === "done" ? load.scopeKey : null;
  const history = useStatusHistory(jiraSource, graph, true, loadedScopeKey);
  const [estimates, setEstimates] = usePersistentState(ESTIMATE_SETTINGS_KEY, parseEstimateSettings, DEFAULT_ESTIMATE_SETTINGS);
  const baseInsights = useMemo(
    () =>
      computeInsights(
        graph,
        history.status === "done"
          ? { history: history.history, today: localToday(), daysPerPoint: estimates.daysPerPoint, defaultDays: estimates.defaultDays }
          : undefined,
      ),
    [graph, history, estimates.daysPerPoint, estimates.defaultDays],
  );
  // "Since you last looked" is tracked per scope: the selected sites plus the query or mode.
  const scopeKey = useMemo(
    () => (domino.selectedSites.length ? scopeKeyOf(domino.selectedSites, domino.scope) : null),
    [domino.selectedSites, domino.scope],
  );
  const loaded = load.status === "done" && load.result.kind === "ok";
  // Only compare once the loaded result belongs to the current scope (not the previous one mid-switch).
  const loadedThisScope = loaded && load.scopeKey === scopeKey;
  const { changes, markSeen } = useChanges(scopeKey, graph, baseInsights, loadedThisScope, history.status === "done");
  const myself = useMyself(jiraSource, domino.selectedSites, config?.backend ?? "none", domino.background.lastUpdated);
  const mine = useMemo(() => myIssues(graph.nodes, myself.me), [graph.nodes, myself.me]);
  const insights = useMemo(() => ({ ...baseInsights, changed: changes?.byIssue ?? new Map(), mine }), [baseInsights, changes, mine]);
  /** Highlight from a tile group: `scope` says whose issues it covers. Clicking the active tile again clears it. */
  const highlightFor = (scope: HighlightScope): Highlight => (view.highlightScope === scope ? view.highlight : "none");
  const setHighlight =
    (scope: HighlightScope) =>
    (highlight: Highlight): void => {
      setView({ ...view, highlight, highlightScope: highlight === "none" ? "all" : scope });
    };

  const [savedViews, setSavedViews] = usePersistentState<SavedView[]>(SAVED_VIEWS_KEY, parseSavedViews, []);
  const currentView = (name: string): SavedView => ({
    name,
    siteIds: domino.selected,
    scope: domino.scope,
    filters,
    view,
    mode: viewMode,
  });
  const applyView = (v: SavedView): void => {
    domino.setSelected(v.siteIds);
    if (v.scope.mode === "jql") saveQuery(v.scope.jql);
    domino.setScope(v.scope);
    setFilters(v.filters);
    setView(v.view);
    setViewMode(v.mode);
  };
  const nodesByUid = useMemo(() => new Map(graph.nodes.map((n) => [n.uid, n])), [graph]);
  const [expandedEpics, setExpandedEpics] = useState<ReadonlySet<string>>(new Set());
  const toggleEpic = useCallback((epicUid: string) => {
    setExpandedEpics((cur) => {
      const next = new Set(cur);
      if (!next.delete(epicUid)) next.add(epicUid);
      return next;
    });
  }, []);
  /** In the epic map, an issue inside a collapsed epic is revealed by expanding that epic first. */
  const focusInGraph = (uid: string): void => {
    // A ghost epic with loaded children is drawn as its summary in the epic map.
    const isFoldedGhostEpic =
      view.collapseEpics && nodesByUid.get(uid)?.ghost && !expandedEpics.has(uid) && graph.nodes.some((n) => n.epic?.uid === uid);
    if (isFoldedGhostEpic) return void focusGraphNode(summaryUid(uid));
    const epicUid = nodesByUid.get(uid)?.epic?.uid;
    const hidden = view.collapseEpics && !nodesByUid.get(uid)?.ghost && epicUid && !expandedEpics.has(epicUid);
    if (!hidden) return void focusGraphNode(uid);
    if (epicUid === uid) return void focusGraphNode(summaryUid(epicUid));
    toggleEpic(epicUid);
    // Wait for the re-layout to render the issue, then focus it.
    let tries = 0;
    const retry = (): void => {
      if (!focusGraphNode(uid) && ++tries < 10) setTimeout(retry, 120);
    };
    setTimeout(retry, 120);
  };
  /** In the timeline, an issue inside a collapsed lane is revealed by expanding that lane first. */
  const focusInTimeline = (uid: string): void => {
    const node = nodesByUid.get(uid);
    const laneId = node ? lanesFor(view.groupBy, insights)?.(node).id : undefined;
    if (!laneId || !collapsedLanes.has(laneId)) return void focusTimelineRow(uid);
    const next = new Set(collapsedLanes);
    next.delete(laneId);
    setCollapsedLanes(next);
    // The lane's rows slide out of its header for FOLD_MS; scroll once the target has landed,
    // or the smooth scroll would aim at where the row was mid-animation.
    const settleMs = prefersReducedMotion() ? 0 : FOLD_MS;
    setTimeout(() => {
      requestAnimationFrame(() => {
        focusTimelineRow(uid);
      });
    }, settleMs);
  };
  const focusIssue = viewMode === "graph" ? focusInGraph : focusInTimeline;
  useViewHotkeys(setViewMode);

  const errors = load.status === "done" ? load.result.errors : [];
  const full = graph.nodes.filter((n) => !n.ghost).length;

  return (
    <div className="app">
      <header className="topbar">
        <h1 className="brand">
          <BrandMark /> Domino
        </h1>
        {config && (
          <>
            <SavedViewsMenu
              views={savedViews}
              onApply={applyView}
              onSave={(name) => {
                setSavedViews(upsertView(savedViews, currentView(name)));
              }}
              onDelete={(name) => {
                setSavedViews(savedViews.filter((v) => v.name !== name));
              }}
            />
            <SiteSelector sites={config.sites} selected={domino.selected} onChange={domino.setSelected} />
            {/* Remount when a saved view swaps the scope, so the inputs show it. */}
            <ScopeInputs key={JSON.stringify(domino.scope)} sites={domino.selectedSites} scope={domino.scope} onApply={domino.setScope} />
          </>
        )}
        <QuickFind nodes={graph.nodes} showSite={domino.loadedSiteCount > 1} onPick={focusIssue} />
        <ViewToggle value={viewMode} onChange={setViewMode} />

        <RefreshButton
          refreshing={domino.background.refreshing}
          lastUpdated={domino.background.lastUpdated}
          // With data on screen, refresh in place; otherwise (nothing loaded, or a failed load) load again.
          onRefresh={() => {
            if (load.status === "done") void domino.refresh();
            else domino.reload();
          }}
        />
        <button
          type="button"
          className="icon-btn"
          onClick={() => {
            setSettingsOpen(true);
          }}
          aria-label="Settings"
          title="Settings"
        >
          <Icon name="settings" />
        </button>
      </header>

      {domino.configError && (
        <div className="banner error" role="alert">
          Could not load configuration: {domino.configError}
        </div>
      )}
      {config && <ErrorBanner errors={errors} sites={config.sites} attempted={domino.selectedSites.length} />}

      <main className="workspace">
        <aside className="sidebar" aria-label="Insights, filters and warnings">
          <SidebarSection id="glance" title="At a glance">
            <InsightTiles
              summary={
                load.status === "loading" ? (
                  "Loading…"
                ) : loaded ? (
                  <>
                    {full} issues · {graph.nodes.length - full} outside scope · <Freshness background={domino.background} />
                  </>
                ) : (
                  ""
                )
              }
              insights={insights}
              highlight={highlightFor("all")}
              onHighlight={setHighlight("all")}
              onShowCycle={() => {
                const first = graph.cycles.at(0);
                if (first) focusIssue(first[0]);
              }}
            />
          </SidebarSection>
          {loaded &&
            config &&
            (["assigned", "reported"] as const).map((scope) => (
              <MyGlance
                key={scope}
                scope={scope}
                insights={insights}
                nodes={nodesByUid}
                myself={myself}
                sites={config.sites}
                highlight={highlightFor(scope)}
                onHighlight={setHighlight(scope)}
              />
            ))}
          {changes && (
            <SidebarSection id="changes" title="Since you last looked" badge={changes.byIssue.size}>
              <ChangesPanel
                changes={changes}
                nodes={nodesByUid}
                highlight={highlightFor("all")}
                onHighlight={setHighlight("all")}
                onPick={focusIssue}
                onMarkSeen={() => {
                  markSeen();
                  if (view.highlight === "changed") setView({ ...view, highlight: "none" });
                }}
              />
            </SidebarSection>
          )}
          <SidebarSection id="finish-first" title="Finish first" badge={insights.unblockers.length || undefined}>
            <FinishFirst insights={insights} nodes={nodesByUid} onPick={focusIssue} />
          </SidebarSection>
          {graph.cycles.length > 0 && (
            <SidebarSection id="warnings" title="Warnings" badge={graph.cycles.length} tone="warn">
              <WarningsPanel graph={graph} onFocusNode={focusIssue} />
            </SidebarSection>
          )}
          <SidebarSection id="display" title="Display">
            <FilterPanel filters={filters} onFilters={setFilters} view={view} onView={setView} epicMapAvailable={viewMode === "graph"} />
          </SidebarSection>
          <SidebarSection id="legend" title="Legend" defaultOpen={false}>
            <Legend />
          </SidebarSection>
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
            <Suspense fallback={<div className="canvas-message">Loading timeline…</div>}>
              <Timeline
                graph={graph}
                insights={insights}
                filters={filters}
                view={view}
                history={history}
                settings={estimates}
                onSettings={setEstimates}
                onOpen={openExternal}
                collapsedLanes={collapsedLanes}
                onCollapsedLanes={setCollapsedLanes}
              />
            </Suspense>
          )}
          <CanvasMessage domino={domino} />
        </section>
      </main>

      {settingsEverOpened && (
        <Suspense fallback={null}>
          <SettingsDialog
            domino={domino}
            open={settingsOpen}
            onClose={() => {
              setSettingsOpen(false);
            }}
            refreshMinutes={refreshMinutes}
            onRefreshMinutes={setRefreshMinutes}
          />
        </Suspense>
      )}
    </div>
  );
}

function CanvasMessage({ domino }: { domino: ReturnType<typeof useDomino> }): ReactElement | null {
  const { load, selectedSites, graph } = domino;
  let msg: React.ReactNode = null;
  if (selectedSites.length === 0 && domino.config) msg = "Select at least one site, or add one in Settings (the gear button, top right).";
  else if (load.status === "failed") msg = `Loading failed: ${load.message}`;
  else if (load.status === "done" && load.result.kind === "overCap")
    msg = (
      <>
        <strong>Too many issues ({load.result.count}+).</strong> Domino shows at most 300. Narrow the scope with a tighter JQL, an epic, or
        a smaller depth.
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

function Legend(): ReactElement {
  return (
    <>
      <ul className="legend-list">
        <li>
          <span className="swatch status-todo" aria-hidden="true" /> To Do
        </li>
        <li>
          <span className="swatch status-inprogress" aria-hidden="true" /> In Progress
        </li>
        <li>
          <span className="swatch status-done" aria-hidden="true" /> Done
        </li>
        <li>
          <span className="legend legend-cycle" aria-hidden="true" /> Blocking cycle
        </li>
        <li>
          <span className="legend legend-critical" aria-hidden="true" /> Critical path
        </li>
        <li>
          <span className="swatch ghost-swatch" aria-hidden="true" /> Outside scope
        </li>
      </ul>
      <p className="hint">Hover or focus a card to trace its blockers. Enter or click opens it in Jira.</p>
      <p className="hint">
        <kbd>/</kbd> find · <kbd>g</kbd> graph · <kbd>t</kbd> timeline
      </p>
    </>
  );
}
