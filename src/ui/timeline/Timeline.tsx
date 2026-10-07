import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { prefersReducedMotion } from "../../lib/motion";
import { blockingChain } from "../../graph/analysis";
import { emphasis, type Insights } from "../../graph/insights";
import { releaseStatuses } from "../../graph/releases";
import type { CardOrder } from "../../graph/layout";
import type { TimelineEntry } from "../../graph/schedule";
import type { Graph } from "../../graph/types";
import { previewOf, type LinkPreview, type Move } from "../../graph/traverse";
import { visibleSubgraph } from "../../graph/visible";
import type { EstimateSettings } from "../../state/estimateSettings";
import { useForecast } from "../../state/useForecast";
import type { HistoryState } from "../../state/useStatusHistory";
import { getOrThrow } from "../../lib/guards";
import { lanesFor, type Filters, type ViewOptions } from "../Canvas";
import { NumberField } from "../NumberField";
import { SortChip } from "../SortChip";
import { flagWidth, releaseX, TimeAxis, TimeGrid, type ReleaseMarker } from "./TimeAxis";
import { arrowAnchors, isViolated, TimelineArrows, type ArrowModel } from "./TimelineArrows";
import {
  dayRange,
  drawnBar,
  FOLD_MS,
  entryEnd,
  isEpicNode,
  isLate,
  LABEL_WIDTH,
  layoutRows,
  rowsMoved,
  type TimelineRowModel,
  PX_PER_DAY,
  SCALES,
  stackFlags,
  summarizeEpics,
  xOf,
} from "./timelineLayout";
import { captureElement } from "../capture";
import { fmtDay } from "../format";
import { ExportMenu } from "../ExportMenu";
import { TimelineLane } from "./TimelineLane";
import { TimelineRow } from "./TimelineRow";

export function Timeline({
  graph,
  insights,
  filters,
  view,
  history,
  settings,
  onSettings,
  onOpen,
  collapsedLanes,
  onCollapsedLanes,
  selectedUid,
  onSelect,
  onTraverse,
  linkPreview,
  stale,
  order,
  onClearSort,
}: {
  graph: Graph;
  insights: Insights;
  filters: Filters;
  view: ViewOptions;
  history: HistoryState;
  settings: EstimateSettings;
  onSettings: (s: EstimateSettings) => void;
  onOpen: (url: string) => void;
  /** Lane ids folded to their header (per viewer; ids are unique across grouping modes). */
  collapsedLanes: ReadonlySet<string>;
  onCollapsedLanes: (next: ReadonlySet<string>) => void;
  /** The issue open in the details panel, if any. */
  selectedUid: string | null;
  onSelect: (uid: string) => void;
  onTraverse: (uid: string, move: Move) => boolean;
  /** Where the focused row's ← and → would go. */
  linkPreview: LinkPreview;
  /** Another scope is loading: these rows are the previous scope's, out of reach. */
  stale: boolean;
  /** The user's sort (see `ticketComparator`); null keeps rows by start date. */
  order: CardOrder | null;
  /** Back to the natural order (the sort chip's ✕). */
  onClearSort: () => void;
}): ReactElement {
  const [hovered, setHovered] = useState<string | null>(null);
  const setSettings = (patch: Partial<EstimateSettings>): void => {
    onSettings({ ...settings, ...patch });
  };

  const { today, opts, timeline } = useForecast(graph, history, settings);
  const epics = useMemo(() => summarizeEpics(graph.nodes, timeline), [graph.nodes, timeline]);
  const releases = useMemo(() => releaseStatuses(graph, timeline), [graph, timeline]);
  /** Release names each issue is forecast to miss. */
  const missedReleases = useMemo(() => {
    const out = new Map<string, string[]>();
    for (const s of releases) for (const uid of s.atRisk) out.set(uid, [...(out.get(uid) ?? []), s.release.name]);
    return out;
  }, [releases]);
  // Epics are placed by their children's envelope, so rows and the date range follow the real work.
  const placed = useMemo(() => {
    const out = new Map<string, TimelineEntry>(timeline);
    for (const [uid, s] of epics) {
      const own = timeline.get(uid);
      if (own) out.set(uid, { ...own, projected: s.projected }); // an epic outside the graph has no row to place
    }
    return out;
  }, [timeline, epics]);

  const { nodes, edges } = useMemo(() => visibleSubgraph(graph, filters), [graph, filters]);
  const { items, height, all } = useMemo(
    () => layoutRows(nodes, placed, lanesFor(view.groupBy, insights), collapsedLanes, order ?? undefined),
    [nodes, placed, view.groupBy, insights, collapsedLanes, order],
  );
  // Rows on screen; folded rows (in collapsed lanes) stay mounted only so folding can animate.
  const rows = items.filter((i): i is TimelineRowModel => i.kind === "row" && !i.folded);
  const lanes = items.filter((i) => i.kind === "lane");
  // Rows slide whenever they move (lane folds, sort changes, refreshed data), but arrows jump to
  // their final positions: hide the arrows until the rows land. A layout effect, so arrows never
  // paint early.
  const [settling, setSettling] = useState(false);
  // Bumped on every move; the timer below restarts with it. Kept out of the detecting effect,
  // which also re-runs for rebuilt-but-unmoved rows and would cancel a pending timer.
  const [moves, setMoves] = useState(0);
  const rowPositions = useMemo(() => new Map(items.flatMap((i) => (i.kind === "row" ? [[i.node.uid, i.y] as const] : []))), [items]);
  const prevPositions = useRef(rowPositions);
  useLayoutEffect(() => {
    const moved = rowsMoved(prevPositions.current, rowPositions);
    prevPositions.current = rowPositions;
    if (!moved || prefersReducedMotion()) return;
    setSettling(true);
    setMoves((n) => n + 1);
  }, [rowPositions]);
  useEffect(() => {
    if (moves === 0) return;
    const timer = setTimeout(() => {
      setSettling(false);
    }, FOLD_MS);
    return (): void => {
      clearTimeout(timer);
    };
  }, [moves]);
  const toggleLane = (id: string): void => {
    const next = new Set(collapsedLanes);
    if (!next.delete(id)) next.add(id);
    onCollapsedLanes(next);
  };
  const allCollapsed = lanes.length > 0 && lanes.every((l) => l.collapsed);
  const setAllCollapsed = (collapse: boolean): void => {
    const next = new Set(collapsedLanes);
    for (const l of lanes) {
      if (collapse) next.add(l.lane.id);
      else next.delete(l.lane.id);
    }
    onCollapsedLanes(next);
  };
  // The date range covers every row, collapsed or not, so folding a lane never shifts the chart.
  const range = useMemo(() => {
    if (!all.length) return null;
    // Ghost rows draw nothing, so their computed (invented) dates don't widen the chart.
    const dated = all.filter((r) => !r.node.ghost);
    return dayRange(
      dated.map((r) => r.entry),
      [
        today,
        opts.planStart,
        ...dated.flatMap((r) => (r.node.dates?.due ? [r.node.dates.due] : [])),
        // Upcoming releases stretch the chart so their markers show; past ones only if already in range.
        ...releases.flatMap((s) => (s.release.date && !s.release.released ? [s.release.date] : [])),
      ],
    );
  }, [all, today, opts.planStart, releases]);
  const multiSite = new Set(graph.nodes.map((n) => n.siteId)).size > 1;
  const releaseMarkers = useMemo((): ReleaseMarker[] => {
    if (!range) return [];
    const siteLabel = (siteId: string): string => graph.nodes.find((n) => n.siteId === siteId)?.siteLabel ?? siteId;
    const markers = releases.flatMap((s) => {
      const { uid, name, date, released, siteId } = s.release;
      if (!date || date < range.start || date > range.end) return [];
      const where = multiSite ? ` (${siteLabel(siteId)})` : "";
      const state = released
        ? "released"
        : `${s.open.length} open${s.atRisk.length ? `, ${s.atRisk.length} forecast to finish after it` : ", on track"}`;
      const label = `${name}${s.atRisk.length ? ` · ${s.atRisk.length} at risk` : ""}`;
      return [{ uid, label, date, released, atRisk: s.atRisk.length, title: `${name}${where}: ${fmtDay(date)}, ${state}` }];
    });
    // Flags close together stack onto extra header lines instead of covering each other.
    const lines = stackFlags(
      markers.map((m) => ({ id: m.uid, right: releaseX(range.start, m.date, settings.scale), width: flagWidth(m.label) })),
    );
    return markers.map((m) => ({ ...m, line: lines.get(m.uid) ?? 0 }));
  }, [releases, range, graph.nodes, multiSite, settings.scale]);
  const releaseLines = releaseMarkers.length ? Math.max(...releaseMarkers.map((m) => m.line)) + 1 : 0;

  const chain = useMemo(() => (hovered ? blockingChain(graph, hovered) : null), [graph, hovered]);
  const emphasized = useMemo(
    () => emphasis(view.highlight, insights, view.highlightScope),
    [view.highlight, view.highlightScope, insights],
  );
  const criticalEdges = view.highlight === "critical" ? (emphasized?.edges ?? new Set<string>()) : new Set<string>();

  const rowY = new Map(rows.map((r) => [r.node.uid, r.y]));
  const rowByUid = new Map(rows.map((r) => [r.node.uid, r]));
  const drawn = (r: TimelineRowModel): ReturnType<typeof drawnBar> =>
    drawnBar(r.node, getOrThrow(timeline, r.node.uid), epics.get(r.node.uid));
  const arrows: ArrowModel[] = edges
    .filter((e) => e.kind === "blocks" && !graph.brokenEdgeIds.has(e.id))
    .flatMap((e) => {
      const [source, target] = [rowByUid.get(e.source), rowByUid.get(e.target)];
      if (!source || !target) return [];
      const [from, to] = [drawn(source), drawn(target)];
      if (from.positionless && to.positionless) return []; // nothing real to connect
      const ghostEnd = from.positionless ? "blocker" : to.positionless ? "blocked" : null;
      return [
        {
          edge: e,
          ...arrowAnchors(from.entry, to.entry, ghostEnd),
          violated: isViolated(getOrThrow(timeline, e.source), getOrThrow(timeline, e.target)),
          inCycle: graph.cycleEdgeIds.has(e.id),
          critical: criticalEdges.has(e.id),
          // As in the graph, a highlight never fades a cycle.
          dimmed: chain ? !chain.edges.has(e.id) : emphasized ? !criticalEdges.has(e.id) && !graph.cycleEdgeIds.has(e.id) : false,
        },
      ];
    });

  const late = all.filter(isLate).length;
  const chartWidth = range ? xOf(range.start, range.end, settings.scale) + PX_PER_DAY[settings.scale] : 0;
  const lastBarX = range
    ? Math.max(0, ...all.filter((r) => !r.node.ghost).map((r) => xOf(range.start, entryEnd(r.entry), settings.scale)))
    : 0;

  // Exports render the whole chart (labels, axis, bars, arrows) at full size, including what's
  // scrolled out of view.
  const exportTimeline = captureElement(
    () => document.querySelector<HTMLElement>(".timeline .tl-inner"),
    (inner) => ({ width: inner.scrollWidth, height: inner.scrollHeight }),
  );

  return (
    <div className="timeline">
      <div className="tl-toolbar" role="toolbar" aria-label="Timeline settings">
        <fieldset className="segmented">
          <legend className="sr-only">Scale</legend>
          {SCALES.map((s) => (
            <label key={s} className={settings.scale === s ? "active" : ""}>
              <input
                type="radio"
                name="tl-scale"
                value={s}
                checked={settings.scale === s}
                onChange={() => {
                  setSettings({ scale: s });
                }}
              />
              {s[0].toUpperCase() + s.slice(1)}
            </label>
          ))}
        </fieldset>
        <label className="field" title="Unstarted work is projected to begin no earlier than this day">
          <span className="field-label">Unstarted from</span>
          <input
            type="date"
            value={opts.planStart}
            onChange={(e) => {
              setSettings({ planStart: e.target.value || null });
            }}
          />
        </label>
        {settings.planStart && (
          <button
            type="button"
            className="link-btn"
            onClick={() => {
              setSettings({ planStart: null });
            }}
          >
            Reset to today
          </button>
        )}
        <label className="field">
          <span className="field-label">Days / point</span>
          <NumberField
            min={0.25}
            step={0.25}
            value={settings.daysPerPoint}
            onCommit={(daysPerPoint) => {
              setSettings({ daysPerPoint });
            }}
          />
        </label>
        <label className="field">
          <span className="field-label">Unpointed</span>
          <NumberField
            min={1}
            step={1}
            integer
            value={settings.defaultDays}
            onCommit={(defaultDays) => {
              setSettings({ defaultDays });
            }}
          />
          <span className="muted small">days</span>
        </label>
        <ul className="tl-legend" aria-label="Legend">
          <li>
            <span className="tl-key tl-projected" aria-hidden="true" /> Projected
          </li>
          <li>
            <span className="tl-key tl-actual" aria-hidden="true" /> Actual
          </li>
          <li>
            <span className="tl-key tl-forecast" aria-hidden="true" /> Forecast
          </li>
          <li>
            <span className="tl-due" aria-hidden="true">
              ◆
            </span>{" "}
            Due
          </li>
        </ul>
        {lanes.length > 1 && (
          <button
            type="button"
            className="link-btn"
            onClick={() => {
              setAllCollapsed(!allCollapsed);
            }}
          >
            {allCollapsed ? "Expand all" : "Collapse all"}
          </button>
        )}
        {range && <ExportMenu name="timeline" capture={exportTimeline} />}
        <SortChip sort={view.sort} onClear={onClearSort} />
        <span className="status-text" aria-live="polite">
          {history.status === "loading" ? "Loading status history…" : `${late} over estimate`}
        </span>
      </div>
      {history.status === "done" && history.errors.length > 0 && (
        <div className="banner error" role="alert">
          {history.errors.map((e) => `${e.siteId}: ${e.message}`).join(" · ")}. Actual dates are missing for those issues.
        </div>
      )}

      {
        range ? (
          <div className="tl-scroll">
            <div className="tl-inner" style={{ width: LABEL_WIDTH + Math.max(chartWidth, lastBarX + 140) }}>
              <div className={`tl-axis${releaseLines ? " with-releases" : ""}`} style={{ "--release-lines": releaseLines }}>
                <div className="tl-corner">Issue</div>
                <TimeAxis range={range} scale={settings.scale} today={today} releases={releaseMarkers} />
              </div>
              <div className={`tl-body${settling ? " settling" : ""}`} style={{ height }}>
                <div className="tl-chart" style={{ left: LABEL_WIDTH }}>
                  <TimeGrid range={range} scale={settings.scale} today={today} height={height} releases={releaseMarkers} />
                  <TimelineArrows
                    arrows={arrows}
                    rowY={rowY}
                    rangeStart={range.start}
                    scale={settings.scale}
                    width={chartWidth + 200}
                    height={height}
                  />
                </div>
                {items.map((item) =>
                  item.kind === "lane" ? (
                    <TimelineLane
                      key={item.lane.id}
                      item={item}
                      onToggle={() => {
                        toggleLane(item.lane.id);
                      }}
                      onOpen={onOpen}
                    />
                  ) : (
                    <TimelineRow
                      key={item.node.uid}
                      row={item}
                      epic={isEpicNode(item.node) ? (epics.get(item.node.uid) ?? "empty") : undefined}
                      rangeStart={range.start}
                      scale={settings.scale}
                      today={today}
                      flags={{
                        dimmed: chain ? !chain.nodes.has(item.node.uid) : emphasized ? !emphasized.nodes.has(item.node.uid) : false,
                        critical: view.highlight === "critical" && (emphasized?.nodes.has(item.node.uid) ?? false),
                        ready: view.highlight === "ready" && (emphasized?.nodes.has(item.node.uid) ?? false),
                        aging: insights.aging.get(item.node.uid),
                        change: insights.changed.get(item.node.uid)?.[0],
                        preview: previewOf(linkPreview, item.node.uid),
                        missedReleases: missedReleases.get(item.node.uid),
                        stale,
                      }}
                      selected={item.node.uid === selectedUid}
                      onSelect={onSelect}
                      onOpen={onOpen}
                      onHover={setHovered}
                      onTraverse={onTraverse}
                    />
                  ),
                )}
              </div>
            </div>
          </div>
        ) : null /* the app's canvas message says why it's empty */
      }
    </div>
  );
}
