import { ReactFlowProvider } from "@xyflow/react";
import { prefersReducedMotion } from "./lib/motion";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { collapseEpics, summaryUid } from "./graph/collapse";
import { computeInsights, isHighlightScope, type Highlight, type HighlightScope, type Insights } from "./graph/insights";
import { myIssues } from "./graph/mine";
import type { GraphNode } from "./graph/types";
import { lastDayOf, releaseStatuses } from "./graph/releases";
import { linkPreview, step, type LinkPreview, type Move, type Trail, type TraverseLayout } from "./graph/traverse";
import { hasIssueFilters, NO_ISSUE_FILTERS, passesIssueFilters, visibleSubgraph } from "./graph/visible";
import { configStore, jiraSource, notify, openExternal, ticketCache } from "./platform";
import { DEFAULT_REFRESH_MINUTES, parseRefreshMinutes, REFRESH_MINUTES_KEY } from "./state/refresh";
import { useAutoRefresh } from "./state/useAutoRefresh";
import { useDomino } from "./state/useDomino";
import { loadViewOf, scopeLabel, type LoadView } from "./state/loadView";
import { errorMessage } from "./data/errors";
import { failureText, otherScopeFailureText } from "./state/refresh";
import { useMyself } from "./state/useMyself";
import { useUnblockedNotifications } from "./state/useUnblockedNotifications";
import { DEFAULT_ESTIMATE_SETTINGS, ESTIMATE_SETTINGS_KEY, parseEstimateSettings } from "./state/estimateSettings";
import { oneOf, usePersistentState } from "./state/storage";
import { NATURAL_SORT, parseSortBy, ticketComparator } from "./graph/sort";
import {
  mergeViews,
  parseSavedViews,
  SAVED_VIEWS_KEY,
  upsertView,
  viewNotice,
  viewSites,
  type EpicFolds,
  type SavedView,
} from "./state/savedViews";
import { saveQuery, selectedSitesOf } from "./state/useDomino";
import { scopeKeyOf } from "./state/scopeKey";
import { useChanges } from "./state/useChanges";
import { useStatusHistory } from "./state/useStatusHistory";
import { useForecast } from "./state/useForecast";
import { useAppUpdate } from "./state/useAppUpdate";
import { epicLaneId, foldedEpicUids, withEpicFolds } from "./graph/layout";
import { Canvas, lanesFor, useFocusNode, type Filters, type ViewOptions } from "./ui/Canvas";
import { ChangesPanel } from "./ui/ChangesPanel";
import { ErrorBanner } from "./ui/ErrorBanner";
import { FilterPanel } from "./ui/FilterPanel";
import { FinishFirst } from "./ui/InsightsBar";
import { ReleasesPanel } from "./ui/ReleasesPanel";
import { UpdateBanner } from "./ui/UpdateBanner";
import { BrandMark } from "./ui/BrandMark";
import { IssueDetail, type IssueDetailData } from "./ui/IssueDetail";
import { ConfigProblemBanner } from "./ui/ConfigProblemBanner";
import { noSitesShown } from "./ui/canvasMessage";
import { Toast, type ToastMessage } from "./ui/Toast";
import { focusFirst } from "./ui/focusFirst";
import { Glance } from "./ui/Glance";
import { SidebarSection } from "./ui/SidebarSection";
import { QuickFind } from "./ui/QuickFind";
import { Freshness, RefreshButton } from "./ui/Refresh";
import { LoadingMessage, LoadPill, useInert } from "./ui/LoadStatus";
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
const DEFAULT_VIEW: Omit<ViewOptions, "sort"> = { groupBy: "none", highlight: "none", highlightScope: "all" };
const SORT_KEY = "domino.sortBy";
const NO_FOLDED_EPICS: ReadonlySet<string> = new Set();
const NO_NODES: readonly GraphNode[] = [];
const parseViewMode = oneOf(isViewMode);
const GLANCE_SCOPE_KEY = "domino.glanceScope";
const NOTIFY_UNBLOCKED_KEY = "domino.notifyUnblocked";
const AUTO_UPDATE_CHECK_KEY = "domino.autoUpdateCheck";
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
  const domino = useDomino(configStore, jiraSource, ticketCache);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  // The sort is remembered between launches (the rest of the view only through saved views).
  const [viewRest, setViewRest] = useState(DEFAULT_VIEW);
  const [sort, setSort] = usePersistentState(SORT_KEY, parseSortBy, NATURAL_SORT);
  const view = useMemo<ViewOptions>(() => ({ ...viewRest, sort }), [viewRest, sort]);
  const clearSort = (): void => {
    setSort(NATURAL_SORT);
  };
  const setView = (next: ViewOptions): void => {
    const { sort: nextSort, ...rest } = next;
    setViewRest(rest);
    setSort(nextSort);
  };
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const dismissToast = useCallback((): void => {
    setToast(null);
  }, []);
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
  // Paced from the last attempt too: after a failed update the next one isn't due right away.
  const { lastUpdated, lastAttempt } = domino.background;
  useAutoRefresh(
    domino.refresh,
    refreshMinutes * 60_000,
    lastUpdated === null && lastAttempt === null ? null : Math.max(lastUpdated ?? 0, lastAttempt ?? 0),
  );
  const [notifyUnblocked, setNotifyUnblocked] = usePersistentState(NOTIFY_UNBLOCKED_KEY, parseBool, false);
  const [autoUpdateCheck, setAutoUpdateCheck] = usePersistentState(AUTO_UPDATE_CHECK_KEY, parseBool, true);
  // Dev builds don't check on their own (Check now still works).
  const updates = useAppUpdate(autoUpdateCheck && !import.meta.env.DEV);
  const { config, load, graph } = domino;
  // "Since you last looked" is tracked per scope: the selected sites plus the query or mode.
  const scopeKey = useMemo(
    () => (domino.selectedSites.length ? scopeKeyOf(domino.selectedSites, domino.scope) : null),
    [domino.selectedSites, domino.scope],
  );
  // What's on screen: this scope (possibly cached, updating), the previous one while loading, or nothing.
  const loadView = loadViewOf(load, scopeKey);
  const shownScopeKey = loadView.shown?.scopeKey ?? null;
  // The previous scope's tickets, kept while a new scope loads: faded, and out of reach of
  // pointer, keyboard and screen reader (inert, plus explicit fallbacks where it's unsupported).
  const stale = loadView.stale;
  const inertWhileStale = useInert(stale);
  const shownAges = Object.values(loadView.shown?.ages ?? {});
  const shownAt = shownAges.length > 0 ? Math.min(...shownAges) : null;
  // Status history feeds aging in both views and the Timeline; one bulk request per site per load,
  // made once the load is done (not for cached tickets about to be replaced).
  const history = useStatusHistory(jiraSource, graph, load.status !== "loading", shownScopeKey);
  const [estimates, setEstimates] = usePersistentState(ESTIMATE_SETTINGS_KEY, parseEstimateSettings, DEFAULT_ESTIMATE_SETTINGS);
  // The schedule forecast (shared with the timeline) says which releases' work runs late.
  const forecast = useForecast(graph, history, estimates);
  const releases = useMemo(() => releaseStatuses(graph, forecast.timeline), [graph, forecast.timeline]);
  const atRiskCount = new Set(releases.flatMap((s) => s.atRisk)).size;
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
  const loaded = loadView.shown?.result.kind === "ok";
  // Only compare once the tickets shown belong to the current scope (not the previous one mid-switch).
  const loadedThisScope = loaded && loadView.mode === "current";
  const { changes, markSeen } = useChanges(scopeKey, graph, baseInsights, loadedThisScope, history.status === "done");
  const myself = useMyself(jiraSource, domino.selectedSites, config?.backend ?? "none", domino.background.lastUpdated);
  const mine = useMemo(() => myIssues(graph.nodes, myself.me), [graph.nodes, myself.me]);
  const insights = useMemo<Insights>(
    () => ({ ...baseInsights, changed: changes?.byIssue ?? new Map(), mine }),
    [baseInsights, changes, mine],
  );
  // "Changed" with nothing changed to show (another scope, nothing new) would dim every card with
  // no pressed control left to undo it, so it counts as off until there are changes again.
  const shownView = useMemo(
    () => (view.highlight === "changed" && !changes?.byIssue.size ? { ...view, highlight: "none" as const } : view),
    [view, changes],
  );
  // Only loads confirmed this session: cached tickets from days ago mustn't announce old unblocks.
  const confirmedScopeKey = load.status === "done" && load.origin === "network" ? load.scopeKey : null;
  useUnblockedNotifications(notifyUnblocked, confirmedScopeKey, graph, insights.blocked, mine.assigned, notify);
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
  const currentView = (name: string): SavedView => {
    const epicFolds = currentEpicFolds();
    return {
      name,
      siteIds: domino.selected,
      scope: domino.scope,
      filters,
      view,
      mode: viewMode,
      ...(epicFolds === undefined ? {} : { epicFolds }),
    };
  };
  const applyView = (v: SavedView): void => {
    applyEpicFolds(v);
    // A view shared by someone with other sites: use the sites this config has, keep the current
    // selection (and scope) when it has none of them, and say what couldn't be applied.
    const sites = viewSites(v, config?.sites ?? []);
    if (sites.scopeUsable && sites.siteIds.length > 0) {
      if (v.scope.mode === "jql") saveQuery(v.scope.jql);
      domino.applyScope(v.scope, sites.siteIds);
    }
    const notice = viewNotice(v.name, v.siteIds.length, sites);
    setToast(notice === null ? null : { text: notice });
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
  // Grouped by epic, a collapsed epic lane folds into the epic's summary card in the Graph (the
  // Timeline folds the same lanes to their header), so both views share one set of folds.
  const foldedEpics = useMemo(
    () => (view.groupBy === "epic" ? foldedEpicUids(collapsedLanes) : NO_FOLDED_EPICS),
    [view.groupBy, collapsedLanes],
  );
  const epicUids = useMemo(() => new Set(graph.nodes.flatMap((n) => (!n.ghost && n.epic ? [n.epic.uid] : []))), [graph.nodes]);
  const epicLaneIds = useMemo(() => new Set([...epicUids].map(epicLaneId)), [epicUids]);
  /** What a saved view records about folds: only while grouped by epic, and "all" when every epic is folded. */
  const currentEpicFolds = (): EpicFolds | undefined => {
    if (view.groupBy !== "epic" || epicUids.size === 0) return undefined;
    const folded = [...epicUids].filter((uid) => foldedEpics.has(uid));
    return folded.length === epicUids.size ? "all" : folded;
  };
  // Folding "all" epics needs the view's scope loaded (that's when its epics are known): remember
  // which scope to fold, and fold once it's the loaded one (right away if it already is). The lanes
  // it reads are the current ones at that moment, so other folds are kept.
  const [foldAllOnLoad, setFoldAllOnLoad] = useState<string | null>(null);
  const applyEpicFolds = (v: SavedView): void => {
    if (v.epicFolds === "all") {
      // The same key the load will carry (the Views menu only shows once config has loaded).
      setFoldAllOnLoad(scopeKeyOf(selectedSitesOf(config?.sites ?? [], v.siteIds), v.scope));
    } else if (v.epicFolds) {
      setFoldAllOnLoad(null);
      setCollapsedLanes(withEpicFolds(collapsedLanes, v.epicFolds));
    }
  };
  useEffect(() => {
    if (foldAllOnLoad === null) return;
    // Moved on to another scope before this one loaded: drop the fold, or it would fire whenever
    // the scope comes back. (The requested scope, not the loaded one, which lags behind.)
    if (scopeKey !== foldAllOnLoad) {
      setFoldAllOnLoad(null);
    } else if (loadedThisScope && scopeKey === foldAllOnLoad) {
      setFoldAllOnLoad(null);
      setCollapsedLanes(withEpicFolds(collapsedLanes, epicUids));
    }
  }, [foldAllOnLoad, scopeKey, loadedThisScope, epicUids]);
  const toggleLane = (laneId: string): void => {
    const next = new Set(collapsedLanes);
    if (!next.delete(laneId)) next.add(laneId);
    setCollapsedLanes(next);
  };
  // Cards and lane headers are memoized: hand them a stable function that calls the latest toggle.
  const latestToggleLane = useRef(toggleLane);
  latestToggleLane.current = toggleLane;
  const toggleEpic = useCallback((epicUid: string) => {
    latestToggleLane.current(epicLaneId(epicUid));
  }, []);
  const foldAllEpics = (fold: boolean): void => {
    const next = new Set(collapsedLanes);
    for (const id of epicLaneIds) {
      if (fold) next.add(id);
      else next.delete(id);
    }
    setCollapsedLanes(next);
  };
  /** In the Graph, an issue inside a folded epic is revealed by unfolding that epic first. */
  const focusInGraph = (uid: string, moveFocus = true, follow = false): void => {
    // A ghost epic with loaded children is drawn as its summary while folded.
    const isFoldedGhostEpic = foldedEpics.has(uid) && nodesByUid.get(uid)?.ghost && graph.nodes.some((n) => n.epic?.uid === uid);
    if (isFoldedGhostEpic) return void focusGraphNode(summaryUid(uid), moveFocus, follow);
    const epicUid = nodesByUid.get(uid)?.epic?.uid;
    const hidden = !nodesByUid.get(uid)?.ghost && epicUid && foldedEpics.has(epicUid);
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
  // From the insights, which already traverse the graph for it.
  const downstream = baseInsights.downstream;
  // The user's sort, shared by the Graph (within columns) and the Timeline (rows); null keeps each
  // view's own order. The Graph breaks ties by key; the Timeline by start date (tidier arrows).
  const sortContext = useMemo(
    () => ({ openBlockers: insights.openBlockers, downstream, forecast: forecast.timeline }),
    [insights.openBlockers, downstream, forecast.timeline],
  );
  const order = useMemo(() => ticketComparator(sort, sortContext), [sort, sortContext]);
  const rowOrder = useMemo(() => ticketComparator(sort, sortContext, { ties: "leave" }), [sort, sortContext]);

  const selectedNode = selectedUid ? nodesByUid.get(selectedUid) : undefined;
  const selectedEntry = selectedNode && selectedNode.statusCategory !== "done" ? forecast.timeline.get(selectedNode.uid) : undefined;
  const detail: IssueDetailData | null = selectedNode
    ? {
        node: selectedNode,
        graph,
        unblocks: downstream.get(selectedNode.uid)?.size ?? 0,
        openBlockers: insights.openBlockers.get(selectedNode.uid) ?? 0,
        aging: insights.aging.get(selectedNode.uid),
        changes: insights.changed.get(selectedNode.uid) ?? [],
        history: history.status === "done" ? history.history.get(selectedNode.uid) : undefined,
        releases: (selectedNode.releases ?? []).map((release) => ({
          release,
          misses: releases.some((s) => s.release.uid === release.uid && s.atRisk.includes(selectedNode.uid)),
        })),
        forecastDone: selectedEntry && lastDayOf(selectedEntry),
        // `visibleSubgraph` drops an issue only for the issue filters or, for one outside the scope,
        // because no shown link kind reaches it: so whichever clearing the issue filters doesn't fix.
        hiddenBy: drawnUids.has(selectedNode.uid) ? undefined : revealableUids.has(selectedNode.uid) ? "issue filters" : "link filters",
      }
    : null;
  /** Closing returns focus to the card or row the panel was showing, so keyboard users aren't lost. */
  const closeDetail = (): void => {
    const uid = selectedUid;
    setSelectedUid(null);
    if (!uid) return;
    // Back to its card or row; if a filter or fold has hidden it, to the view's tab stop; with
    // everything filtered out, to the canvas message's Clear filters.
    focusFirst(
      `[data-uid="${CSS.escape(uid)}"], [data-tl-uid="${CSS.escape(uid)}"]`,
      '.canvas [data-uid][tabindex="0"], .canvas [data-tl-uid][tabindex="0"]',
      ".canvas-message button",
    );
  };
  // How many links "Hide implied links" removes from what's drawn (counted even while it's off),
  // on the graph actually drawn: folded epics have their own, combined links.
  const drawnGraph = useMemo(
    () => (viewMode === "graph" && foldedEpics.size > 0 ? collapseEpics(graph, insights, foldedEpics).graph : graph),
    [viewMode, foldedEpics, graph, insights],
  );
  /**
   * The issues actually on screen in this view: as drawn (folded epics included), with a folded
   * epic's summary card standing for its members. For the glance tiles and the "all hidden" message.
   */
  const onScreenUids = useMemo(() => {
    const out = new Set<string>();
    for (const n of visibleSubgraph(drawnGraph, { ...filters, hideImplied: false }).nodes) {
      out.add(n.uid);
      if (n.rollup) for (const m of [n.rollup.epicUid, ...n.rollup.members]) out.add(m);
    }
    return out;
  }, [drawnGraph, filters]);
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
  // A new picture (filters, folded epics, view) moves the cards: drop the preview until focus moves.
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
    if (node && !drawnUids.has(uid) && !revealableUids.has(uid)) {
      // Only the hidden link kinds reach it: clearing issue filters wouldn't draw it, so say why.
      setToast({ text: `${node.key} isn't drawn: only links hidden in Display → Links reach it.` });
      return;
    }
    // Clear the issue filters only when that would actually draw it; otherwise leave them alone.
    if (!node || drawnUids.has(uid) || !hasIssueFilters(filters.issues)) {
      focusInView(uid, moveFocus);
      return;
    }
    const kept = filters.issues;
    setFilters({ ...filters, issues: NO_ISSUE_FILTERS });
    setToast({
      text: `Cleared the Display filters to show ${node.key}.`,
      action: {
        label: "Undo",
        run: () => {
          setFilters((f) => ({ ...f, issues: kept }));
        },
      },
    });
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
                const report = mergeViews(savedViews, imported);
                setSavedViews(report.views);
                return report;
              }}
            />
            <SiteSelector sites={config.sites} selected={domino.selected} onChange={domino.setSelected} />
            {/* Remount when a saved view swaps the scope, so the inputs show it. */}
            <ScopeInputs key={JSON.stringify(domino.scope)} sites={domino.selectedSites} scope={domino.scope} onApply={domino.applyScope} />
          </>
        )}
        <QuickFind nodes={stale ? NO_NODES : graph.nodes} showSite={domino.loadedSiteCount > 1} onPick={focusIssue} />
        <ViewToggle value={viewMode} onChange={setViewMode} />

        <RefreshButton
          refreshing={domino.background.refreshing || load.status === "loading"}
          lastUpdated={domino.background.lastUpdated}
          // With data on screen, refresh in place; otherwise (nothing loaded, or a failed load) load again.
          onRefresh={() => {
            if (load.status === "done") void domino.refresh();
            else if (load.status !== "loading") domino.reload();
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
      {domino.configFile && (
        <ConfigProblemBanner
          status={domino.configFile}
          onReload={domino.reloadConfigFile}
          onReveal={() => {
            domino.store.revealFile().catch((e: unknown) => {
              setToast({ text: errorMessage(e) }); // already says it couldn't show the file
            });
          }}
          onOpenSettings={() => {
            setSettingsOpen(true);
          }}
        />
      )}
      <UpdateBanner updates={updates} />
      {config && (
        <ErrorBanner
          errors={errors}
          // Only sites still selected: a deselected one's failure isn't news.
          lagging={domino.background.lagging.filter((l) => domino.selected.includes(l.siteId))}
          sites={config.sites}
          attempted={domino.selectedSites.length}
          onRetry={domino.reload}
          onOpenSettings={() => {
            setSettingsOpen(true);
          }}
        />
      )}

      <main className="workspace">
        <aside className="sidebar" aria-label="Insights, filters and warnings">
          <div className={stale ? "sidebar-data stale" : "sidebar-data"} ref={inertWhileStale} aria-hidden={stale || undefined}>
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
                  stale ? (
                    `Loading ${scopeLabel(domino.scope)}…`
                  ) : loaded ? (
                    <>
                      {full} issues · {graph.nodes.length - full} outside scope ·{" "}
                      <Freshness background={domino.background} sites={config?.sites ?? []} updating={loadView.busy} shownAt={shownAt} />
                    </>
                  ) : loadView.busy ? (
                    "Loading tickets…"
                  ) : (
                    ""
                  )
                }
                insights={insights}
                nodes={nodesByUid}
                myself={myself}
                sites={config?.sites ?? []}
                highlightFor={highlightFor}
                drawn={hasIssueFilters(filters.issues) ? onScreenUids : undefined}
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
            {releases.length > 0 && (
              <SidebarSection
                id="releases"
                title="Releases"
                badge={atRiskCount || undefined}
                badgeLabel="issues forecast to miss their release"
                tone={atRiskCount ? "warn" : undefined}
              >
                <ReleasesPanel
                  releases={releases}
                  nodes={nodesByUid}
                  today={forecast.today}
                  showSite={domino.loadedSiteCount > 1}
                  onPick={focusIssue}
                />
              </SidebarSection>
            )}
          </div>
          <SidebarSection id="display" title="Display" badge={hiddenIssueCount || undefined} badgeLabel="issues hidden by filters">
            <FilterPanel
              filters={filters}
              onFilters={setFilters}
              view={view}
              onView={setView}
              epicFolds={
                view.groupBy === "epic" && epicLaneIds.size > 0
                  ? {
                      total: epicLaneIds.size,
                      folded: [...epicLaneIds].filter((id) => collapsedLanes.has(id)).length,
                      onFoldAll: foldAllEpics,
                    }
                  : undefined
              }
              issues={loadedIssues}
              impliedLinks={impliedLinkCount}
            />
          </SidebarSection>
          <SidebarSection id="legend" title="Legend" defaultOpen={false}>
            <Legend />
          </SidebarSection>
        </aside>
        <section
          className={detail && !stale ? "canvas has-detail" : "canvas"}
          aria-label={viewMode === "graph" ? "Dependency graph" : "Timeline"}
          aria-busy={loadView.busy}
          // Esc from a card or row: close the details, or else clear the highlight. (The details
          // panel handles its own Esc.)
          onKeyDown={(e) => {
            if (e.key !== "Escape" || e.defaultPrevented) return;
            // Not from a field, menu or dialog: Esc there is that control's own business.
            if (e.target instanceof Element && e.target.closest("input, select, textarea, details, [role=menu], [role=listbox], dialog"))
              return;
            if (selectedUid) closeDetail();
            else if (shownView.highlight !== "none") setView({ ...view, highlight: "none", highlightScope: "all" });
            else return;
            e.preventDefault();
          }}
        >
          <div className={stale ? "canvas-body stale" : "canvas-body"} ref={inertWhileStale} aria-hidden={stale || undefined}>
            {viewMode === "graph" ? (
              <Canvas
                graph={graph}
                insights={insights}
                filters={filters}
                view={shownView}
                showSiteBadges={domino.loadedSiteCount > 1}
                foldedEpics={foldedEpics}
                onToggleEpic={toggleEpic}
                selectedUid={selectedUid}
                onSelect={selectIssue}
                onTraverse={onTraverse}
                linkPreview={preview}
                scopeKey={shownScopeKey}
                stale={stale}
                order={order}
                onClearSort={clearSort}
              />
            ) : (
              <Suspense fallback={<div className="canvas-message">Loading timeline…</div>}>
                <Timeline
                  graph={graph}
                  insights={insights}
                  filters={filters}
                  view={shownView}
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
                  stale={stale}
                  order={rowOrder}
                  onClearSort={clearSort}
                />
              </Suspense>
            )}
          </div>
          <LoadPill
            view={loadView}
            sites={domino.selectedSites}
            scopeLabel={scopeLabel(domino.scope)}
            failureText={
              loadView.failure === null
                ? null
                : loadView.mode === "other"
                  ? otherScopeFailureText(scopeLabel(domino.scope), loadView.failure)
                  : failureText(loadView.failure, shownAt, Date.now())
            }
            onRetry={domino.reload}
          />
          <CanvasMessage
            domino={domino}
            view={loadView}
            onOpenSettings={() => {
              setSettingsOpen(true);
            }}
            hiddenByFilters={loadedIssues.length > 0 && !loadedIssues.some((n) => onScreenUids.has(n.uid)) ? loadedIssues.length : 0}
            onClearFilters={() => {
              setFilters({ ...filters, issues: NO_ISSUE_FILTERS });
              // The message (and this button) goes away: keep focus in reach, on the first filter
              // (or the Display section's toggle while it's folded away).
              focusFirst('[aria-label="Statuses to show"] button', '[data-section="display"] .sb-toggle');
            }}
          />
          <Toast toast={toast} onDismiss={dismissToast} />
          {detail && !stale && (
            <IssueDetail
              data={detail}
              onSelect={(uid) => {
                selectIssue(uid);
                focusIssue(uid, false); // keep keyboard focus in the panel
              }}
              onOpen={openExternal}
              onClose={closeDetail}
              focusRequest={detailFocusRequest}
              onShowHidden={() => {
                // The Show button goes away with the filters: keep focus in the panel, on its title.
                document.getElementById("issue-detail-title")?.focus();
                focusIssue(detail.node.uid, false);
              }}
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
            updates={updates}
            autoUpdateCheck={autoUpdateCheck}
            onAutoUpdateCheck={setAutoUpdateCheck}
          />
        </Suspense>
      )}
    </div>
  );
}

function CanvasMessage({
  domino,
  view,
  onOpenSettings,
  hiddenByFilters,
  onClearFilters,
}: {
  domino: ReturnType<typeof useDomino>;
  view: LoadView;
  onOpenSettings: () => void;
  /** How many loaded issues there are when the Display filters hide every one of them (else 0). */
  hiddenByFilters: number;
  onClearFilters: () => void;
}): ReactElement | null {
  const { load, selectedSites, graph } = domino;
  let msg: React.ReactNode = null;
  if (selectedSites.length === 0 && domino.config) {
    const why = noSitesShown(domino.config.sites);
    msg =
      why === "none selected" ? (
        "Select at least one site in Sites, top left."
      ) : (
        <>
          {why === "none" ? "No Jira sites yet." : "All your sites are turned off."}{" "}
          <button type="button" className="link-btn" onClick={onOpenSettings}>
            {why === "none" ? "Add one in Settings" : "Turn one on in Settings"}
          </button>
        </>
      );
  } else if (view.mode === "empty" && view.busy) msg = <LoadingMessage sites={selectedSites} progress={view.progress} />;
  // With tickets still on screen, the pill reports the failure instead.
  else if (load.status === "failed" && !view.shown) {
    msg = (
      <>
        Loading failed: {load.message}{" "}
        <button type="button" className="link-btn" onClick={domino.reload}>
          Retry
        </button>
      </>
    );
  } else if (load.status === "done" && load.result.kind === "overCap")
    msg = (
      <>
        <strong>Too many issues ({load.result.count}+).</strong> Domino shows at most 300. Narrow the scope with a tighter JQL, an epic, or
        a smaller depth.
      </>
    );
  else if (load.status === "done" && load.result.kind === "ok" && graph.nodes.length === 0 && load.result.errors.length === 0)
    msg = "No issues match this scope.";
  else if (hiddenByFilters > 0 && !view.busy) {
    msg = (
      <>
        {hiddenByFilters === 1 ? "The one issue is" : `All ${hiddenByFilters} issues are`} hidden by the Display filters.{" "}
        <button type="button" className="link-btn" onClick={onClearFilters}>
          Clear filters
        </button>
      </>
    );
  }
  if (!msg) return null;
  return (
    <div className="canvas-message" role="status">
      <div>{msg}</div>
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
