import { ReactFlowProvider } from "@xyflow/react";
import { prefersReducedMotion } from "./lib/motion";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { collapseEpics, summaryUid } from "./graph/collapse";
import { computeInsights, downstreamOpen, isHighlightScope, type Highlight, type HighlightScope, type Insights } from "./graph/insights";
import { myIssues } from "./graph/mine";
import { linkPreview, step, type LinkPreview, type Move, type Trail, type TraverseLayout } from "./graph/traverse";
import { hasIssueFilters, NO_ISSUE_FILTERS, passesIssueFilters, visibleSubgraph } from "./graph/visible";
import { configStore, jiraSource, notify, openExternal } from "./platform";
import { DEFAULT_REFRESH_MINUTES, parseRefreshMinutes, REFRESH_MINUTES_KEY } from "./state/refresh";
import { useAutoRefresh } from "./state/useAutoRefresh";
import { useDomino } from "./state/useDomino";
import { useMyself } from "./state/useMyself";
import { useUnblockedNotifications } from "./state/useUnblockedNotifications";
import { DEFAULT_ESTIMATE_SETTINGS, ESTIMATE_SETTINGS_KEY, parseEstimateSettings } from "./state/estimateSettings";
import { oneOf, usePersistentState } from "./state/storage";
import { mergeViews, parseSavedViews, SAVED_VIEWS_KEY, upsertView, type SavedView } from "./state/savedViews";
import { saveQuery, scopeKeyOf } from "./state/useDomino";
import { useChanges } from "./state/useChanges";
import { useStatusHistory } from "./state/useStatusHistory";
import { Canvas, lanesFor, useFocusNode, type Filters, type ViewOptions } from "./ui/Canvas";
import { ChangesPanel } from "./ui/ChangesPanel";
import { ErrorBanner } from "./ui/ErrorBanner";
import { FilterPanel } from "./ui/FilterPanel";
import { FinishFirst } from "./ui/InsightsBar";
import { BrandMark } from "./ui/BrandMark";
import { IssueDetail, type IssueDetailData } from "./ui/IssueDetail";
import { Glance } from "./ui/Glance";
import { SidebarSection } from "./ui/SidebarSection";
import { QuickFind } from "./ui/QuickFind";
import { Freshness, RefreshButton } from "./ui/Refresh";
import { ScopeInputs } from "./ui/ScopeInputs";
import { SavedViewsMenu } from "./ui/SavedViewsMenu";
import { SiteSelector } from "./ui/SiteSelector";
import { FOLD_MS, localToday } from "./ui/timeline/timelineLayout";
import { isViewMode, ViewToggle, type ViewMode } from "./ui/ViewToggle";
import { screenLayout } from "./ui/traverseLayout";
import { WarningsPanel } from "./ui/WarningsPanel";
import { Icon } from "./ui/Icon";

// Split out of the startup bundle: the timeline loads on first switch to it, Settings on first open.
const Timeline = lazy(() => import("./ui/timeline/Timeline").then((m) => ({ default: m.Timeline })));
const SettingsDialog = lazy(() => import("./ui/Settings/SettingsDialog").then((m) => ({ default: m.SettingsDialog })));

const DEFAULT_FILTERS: Filters = {
  blocks: true,
  relates: false,
  duplicates: false,
  crossSite: true,
  issues: NO_ISSUE_FILTERS,
  hideImplied: true,
};
const DEFAULT_VIEW: ViewOptions = { groupBy: "none", highlight: "none", highlightScope: "all", collapseEpics: false };
const parseViewMode = oneOf(isViewMode);
const GLANCE_SCOPE_KEY = "domino.glanceScope";
const NOTIFY_UNBLOCKED_KEY = "domino.notifyUnblocked";
const parseBool = (raw: unknown): boolean | undefined => (typeof raw === "boolean" ? raw : undefined);
const parseGlanceScope = oneOf(isHighlightScope);

/**
 * Focus a timeline row by uid (the graph view uses React Flow's viewport instead), centring it, or
 * with `nearest` (following links) scrolling only as far as needed. Returns whether it was found.
 */
function focusTimelineRow(uid: string, moveFocus = true, nearest = false): boolean {
  const el = document.querySelector<HTMLElement>(`[data-tl-uid="${CSS.escape(uid)}"]`);
  el?.scrollIntoView({ block: nearest ? "nearest" : "center", inline: "nearest", behavior: "smooth" });
  if (moveFocus) el?.focus({ preventScroll: true });
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
  const [notifyUnblocked, setNotifyUnblocked] = usePersistentState(NOTIFY_UNBLOCKED_KEY, parseBool, false);
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
  const insights = useMemo<Insights>(
    () => ({ ...baseInsights, changed: changes?.byIssue ?? new Map(), mine }),
    [baseInsights, changes, mine],
  );
  useUnblockedNotifications(notifyUnblocked, loadedScopeKey, graph, insights.blocked, mine.assigned, notify);
  /** Highlight from a tile group: `scope` says whose issues it covers. Clicking the active tile again clears it. */
  const highlightFor = (scope: HighlightScope): Highlight => (view.highlightScope === scope ? view.highlight : "none");
  const setHighlight =
    (scope: HighlightScope) =>
    (highlight: Highlight): void => {
      setView({ ...view, highlight, highlightScope: highlight === "none" ? "all" : scope });
    };
  /** Whose issues "At a glance" counts; remembered per viewer. */
  const [glanceScope, setGlanceScope] = usePersistentState<HighlightScope>(GLANCE_SCOPE_KEY, parseGlanceScope, "all");

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
    // Show the tile group the view's highlight belongs to, so its tile is pressed and can clear it.
    if (v.view.highlight !== "none" && v.view.highlight !== "changed") setGlanceScope(v.view.highlightScope);
    setViewMode(v.mode);
  };
  const nodesByUid = useMemo(() => new Map(graph.nodes.map((n) => [n.uid, n])), [graph]);
  const loadedIssues = useMemo(() => graph.nodes.filter((n) => !n.ghost), [graph]);
  /** Issues the filters leave on screen (implied-link hiding never removes an issue). */
  const drawnUids = useMemo(
    () => new Set(visibleSubgraph(graph, { ...filters, hideImplied: false }).nodes.map((n) => n.uid)),
    [graph, filters],
  );
  /** Issues clearing the issue filters would put on screen (link filters can still hide a ghost). */
  const revealableUids = useMemo(
    () => new Set(visibleSubgraph(graph, { ...filters, issues: NO_ISSUE_FILTERS, hideImplied: false }).nodes.map((n) => n.uid)),
    [graph, filters],
  );
  const hiddenIssueCount = useMemo(
    () => loadedIssues.filter((n) => !passesIssueFilters(n, filters.issues)).length,
    [loadedIssues, filters.issues],
  );
  const [expandedEpics, setExpandedEpics] = useState<ReadonlySet<string>>(new Set());
  const toggleEpic = useCallback((epicUid: string) => {
    setExpandedEpics((cur) => {
      const next = new Set(cur);
      if (!next.delete(epicUid)) next.add(epicUid);
      return next;
    });
  }, []);
  /** In the epic map, an issue inside a collapsed epic is revealed by expanding that epic first. */
  const focusInGraph = (uid: string, moveFocus = true, follow = false): void => {
    // A ghost epic with loaded children is drawn as its summary in the epic map.
    const isFoldedGhostEpic =
      view.collapseEpics && nodesByUid.get(uid)?.ghost && !expandedEpics.has(uid) && graph.nodes.some((n) => n.epic?.uid === uid);
    if (isFoldedGhostEpic) return void focusGraphNode(summaryUid(uid), moveFocus, follow);
    const epicUid = nodesByUid.get(uid)?.epic?.uid;
    const hidden = view.collapseEpics && !nodesByUid.get(uid)?.ghost && epicUid && !expandedEpics.has(epicUid);
    if (!hidden) return void focusGraphNode(uid, moveFocus, follow);
    if (epicUid === uid) return void focusGraphNode(summaryUid(epicUid), moveFocus, follow);
    toggleEpic(epicUid);
    // Wait for the re-layout to render the issue, then focus it.
    let tries = 0;
    const retry = (): void => {
      if (!focusGraphNode(uid, moveFocus, follow) && ++tries < 10) setTimeout(retry, 120);
    };
    setTimeout(retry, 120);
  };
  /** In the timeline, an issue inside a collapsed lane is revealed by expanding that lane first. */
  const focusInTimeline = (uid: string, moveFocus = true, follow = false): void => {
    const node = nodesByUid.get(uid);
    const laneId = node ? lanesFor(view.groupBy, insights)?.(node).id : undefined;
    if (!laneId || !collapsedLanes.has(laneId)) return void focusTimelineRow(uid, moveFocus, follow);
    const next = new Set(collapsedLanes);
    next.delete(laneId);
    setCollapsedLanes(next);
    // The lane's rows slide out of its header for FOLD_MS; scroll once the target has landed,
    // or the smooth scroll would aim at where the row was mid-animation.
    const settleMs = prefersReducedMotion() ? 0 : FOLD_MS;
    setTimeout(() => {
      requestAnimationFrame(() => {
        focusTimelineRow(uid, moveFocus, follow);
      });
    }, settleMs);
  };
  const focusInView = viewMode === "graph" ? focusInGraph : focusInTimeline;
  // The issue open in the details panel. It closes by itself if the issue leaves the loaded graph.
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  // Opening an issue moves focus into the panel; following links with the arrow keys doesn't.
  const [detailFocusRequest, setDetailFocusRequest] = useState(0);
  const selectIssue = useCallback((uid: string) => {
    setSelectedUid(uid);
    setDetailFocusRequest((n) => n + 1);
  }, []);
  const downstream = useMemo(() => downstreamOpen(graph), [graph]);
  const selectedNode = selectedUid ? nodesByUid.get(selectedUid) : undefined;
  const detail: IssueDetailData | null = selectedNode
    ? {
        node: selectedNode,
        graph,
        unblocks: downstream.get(selectedNode.uid)?.size ?? 0,
        openBlockers: insights.openBlockers.get(selectedNode.uid) ?? 0,
        aging: insights.aging.get(selectedNode.uid),
        changes: insights.changed.get(selectedNode.uid) ?? [],
        history: history.status === "done" ? history.history.get(selectedNode.uid) : undefined,
      }
    : null;
  /** Closing returns focus to the card or row the panel was showing, so keyboard users aren't lost. */
  const closeDetail = (): void => {
    const uid = selectedUid;
    setSelectedUid(null);
    if (uid) document.querySelector<HTMLElement>(`[data-uid="${CSS.escape(uid)}"], [data-tl-uid="${CSS.escape(uid)}"]`)?.focus();
  };
  // How many links "Hide implied links" removes from what's drawn (counted even while it's off),
  // on the graph actually drawn: the epic map has its own, combined links.
  const drawnGraph = useMemo(
    () => (viewMode === "graph" && view.collapseEpics ? collapseEpics(graph, insights, expandedEpics).graph : graph),
    [viewMode, view.collapseEpics, graph, insights, expandedEpics],
  );
  const impliedLinkCount = useMemo(() => visibleSubgraph(drawnGraph, { ...filters, hideImplied: true }).implied, [drawnGraph, filters]);
  /** Arrow keys on a card or row follow the drawn blocking links (see `step`); an open details panel follows along. */
  const trail = useRef<Trail | null>(null);
  /** Where the drawn issues are right now, over the links drawn (read at key press, not render). */
  const layoutNow = (): TraverseLayout => screenLayout(visibleSubgraph(drawnGraph, filters).edges);
  const traverse = (uid: string, move: Move): boolean => {
    const result = step(uid, move, trail.current, layoutNow());
    if (!result) return false;
    trail.current = result.trail;
    if (selectedUid) setSelectedUid(result.target);
    focusInView(result.target, true, true);
    return true;
  };
  // Cards are memoized: hand them a stable function that calls the latest `traverse`.
  const latestTraverse = useRef(traverse);
  latestTraverse.current = traverse;
  const onTraverse = useCallback((uid: string, move: Move) => latestTraverse.current(uid, move), []);
  /** While a card or row has keyboard focus, the cards its ← and → would reach are marked. */
  const [preview, setPreview] = useState<LinkPreview>(null);
  const previewFrom = (el: Element): LinkPreview => {
    const uid = el.getAttribute("data-uid") ?? el.getAttribute("data-tl-uid");
    if (!uid || !el.matches(":focus-visible")) return null;
    return linkPreview(uid, trail.current, layoutNow());
  };
  const latestPreviewFrom = useRef(previewFrom);
  latestPreviewFrom.current = previewFrom;
  useEffect(() => {
    const onFocusIn = (e: FocusEvent): void => {
      setPreview(e.target instanceof Element ? latestPreviewFrom.current(e.target) : null);
    };
    const onFocusOut = (e: FocusEvent): void => {
      if (e.relatedTarget === null) setPreview(null);
    };
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    return (): void => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, []);
  // A new picture (filters, epic map, view) moves the cards: drop the preview until focus moves.
  useEffect(() => {
    setPreview(null);
  }, [drawnGraph, filters, viewMode]);
  /**
   * An issue the issue filters keep off screen (filtered itself, or a ghost whose only links go to
   * filtered issues) is revealed by clearing them first, as collapsed lanes are expanded.
   * `moveFocus: false` moves the view without taking keyboard focus (used from the details panel).
   */
  const focusIssue = (uid: string, moveFocus = true): void => {
    const node = nodesByUid.get(uid);
    // Clear the issue filters only when that would actually draw it; otherwise leave them alone.
    if (!node || drawnUids.has(uid) || !hasIssueFilters(filters.issues) || !revealableUids.has(uid)) {
      focusInView(uid, moveFocus);
      return;
    }
    setFilters({ ...filters, issues: NO_ISSUE_FILTERS });
    // Layout runs off the main thread: wait until the issue (or the epic card or lane row it sits
    // in) is on screen, then focus it once; the focus helpers handle collapsed epics and lanes.
    const epicUid = node.epic?.uid;
    const selectors = [`[data-id="${CSS.escape(uid)}"]`, `[data-tl-uid="${CSS.escape(uid)}"]`];
    if (epicUid) selectors.push(`[data-id="${CSS.escape(summaryUid(epicUid))}"]`);
    let tries = 0;
    const whenDrawn = (): void => {
      if (document.querySelector(selectors.join(","))) focusInView(uid, moveFocus);
      else if (++tries < 25) setTimeout(whenDrawn, 80);
    };
    setTimeout(whenDrawn, 80);
  };
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
              onImport={(imported) => {
                setSavedViews(mergeViews(savedViews, imported));
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
            <Glance
              scope={glanceScope}
              loaded={loaded}
              onScope={(scope) => {
                setGlanceScope(scope);
                // An active tile highlight follows the switch (Blocked stays Blocked, for the new scope),
                // so there's always a pressed tile that clears it. "Changed" belongs to its own panel.
                if (view.highlight !== "none" && view.highlight !== "changed") setView({ ...view, highlightScope: scope });
              }}
              everyoneSummary={
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
              nodes={nodesByUid}
              myself={myself}
              sites={config?.sites ?? []}
              highlightFor={highlightFor}
              onHighlight={(scope, h) => {
                setHighlight(scope)(h);
              }}
            />
          </SidebarSection>
          {graph.cycles.length > 0 && (
            <SidebarSection id="warnings" title="Warnings" badge={graph.cycles.length} tone="warn">
              <WarningsPanel graph={graph} onFocusNode={focusIssue} />
            </SidebarSection>
          )}
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
          <SidebarSection id="display" title="Display" badge={hiddenIssueCount || undefined} badgeLabel="issues hidden by filters">
            <FilterPanel
              filters={filters}
              onFilters={setFilters}
              view={view}
              onView={setView}
              epicMapAvailable={viewMode === "graph"}
              issues={loadedIssues}
              impliedLinks={impliedLinkCount}
            />
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
              selectedUid={selectedUid}
              onSelect={selectIssue}
              onTraverse={onTraverse}
              linkPreview={preview}
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
                selectedUid={selectedUid}
                onSelect={selectIssue}
                onTraverse={onTraverse}
                linkPreview={preview}
              />
            </Suspense>
          )}
          <CanvasMessage domino={domino} />
          {detail && (
            <IssueDetail
              data={detail}
              onSelect={(uid) => {
                selectIssue(uid);
                focusIssue(uid, false); // keep keyboard focus in the panel
              }}
              onOpen={openExternal}
              onClose={closeDetail}
              focusRequest={detailFocusRequest}
            />
          )}
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
            notifyUnblocked={notifyUnblocked}
            onNotifyUnblocked={setNotifyUnblocked}
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
      <p className="hint">Hover or focus a card to trace its blockers. Enter or click shows its details; ⌘/Ctrl+click opens it in Jira.</p>
      <p className="hint">
        <kbd>/</kbd> find · <kbd>g</kbd> graph · <kbd>t</kbd> timeline
      </p>
    </>
  );
}
