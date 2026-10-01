import { useMemo, useState } from "react";
import { blockingChain } from "../../graph/analysis";
import { emphasis, type Insights } from "../../graph/insights";
import { computeTimeline, type ScheduleOptions, type TimelineEntry } from "../../graph/schedule";
import type { Graph } from "../../graph/types";
import { visibleSubgraph } from "../../graph/visible";
import type { EstimateSettings } from "../../state/estimateSettings";
import type { HistoryState } from "../../state/useStatusHistory";
import { lanesFor, type Filters, type ViewOptions } from "../Canvas";
import { NumberField } from "../NumberField";
import { TimeAxis, TimeGrid } from "./TimeAxis";
import { arrowAnchors, isViolated, TimelineArrows, type ArrowModel } from "./TimelineArrows";
import {
  dayRange,
  entryEnd,
  isEpicNode,
  LABEL_WIDTH,
  LANE_HEIGHT,
  layoutRows,
  localToday,
  PX_PER_DAY,
  SCALES,
  summarizeEpics,
  xOf,
} from "./timelineLayout";
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
}: {
  graph: Graph;
  insights: Insights;
  filters: Filters;
  view: ViewOptions;
  history: HistoryState;
  settings: EstimateSettings;
  onSettings: (s: EstimateSettings) => void;
  onOpen: (url: string) => void;
}) {
  const [hovered, setHovered] = useState<string | null>(null);
  const setSettings = (patch: Partial<EstimateSettings>) => onSettings({ ...settings, ...patch });

  const today = localToday();
  const historyMap = useMemo(() => (history.status === "done" ? history.history : new Map()), [history]);
  const opts = useMemo<ScheduleOptions>(
    () => ({ planStart: settings.planStart ?? today, today, daysPerPoint: settings.daysPerPoint, defaultDays: settings.defaultDays }),
    [settings, today],
  );
  const timeline = useMemo(() => computeTimeline(graph, historyMap, opts), [graph, historyMap, opts]);
  const epics = useMemo(() => summarizeEpics(graph.nodes, timeline), [graph.nodes, timeline]);
  // Epics are placed by their children's envelope, so rows and the date range follow the real work.
  const placed = useMemo(() => {
    const out = new Map<string, TimelineEntry>(timeline);
    for (const [uid, s] of epics) out.set(uid, { ...timeline.get(uid)!, projected: s.projected });
    return out;
  }, [timeline, epics]);

  const { nodes, edges } = useMemo(() => visibleSubgraph(graph, filters), [graph, filters]);
  const { items, height } = useMemo(() => layoutRows(nodes, placed, lanesFor(view.groupBy, insights)), [nodes, placed, view.groupBy, insights]);
  const rows = items.filter((i) => i.kind === "row");
  const range = useMemo(
    () => {
      if (!rows.length) return null;
      // Ghost rows draw nothing, so their computed (invented) dates don't widen the chart.
      const dated = rows.filter((r) => !r.node.ghost);
      return dayRange(dated.map((r) => r.entry), [today, opts.planStart, ...dated.flatMap((r) => (r.node.dates?.due ? [r.node.dates.due] : []))]);
    },
    [rows, today, opts.planStart],
  );

  const chain = useMemo(() => (hovered ? blockingChain(graph, hovered) : null), [graph, hovered]);
  const emphasized = useMemo(() => emphasis(view.highlight, insights), [view.highlight, insights]);
  const criticalEdges = view.highlight === "critical" ? (emphasized?.edges ?? new Set<string>()) : new Set<string>();

  const rowY = new Map(rows.map((r) => [r.node.uid, r.y]));
  const ghostUids = new Set(rows.filter((r) => r.node.ghost).map((r) => r.node.uid));
  const emptyEpicUids = new Set(rows.filter((r) => isEpicNode(r.node) && !epics.has(r.node.uid)).map((r) => r.node.uid));
  // What each row actually draws: epics draw their children's envelope; an epic without loaded
  // children (like a ghost) draws no bar, so arrows treat it as having no position.
  const drawn = (uid: string): { entry: TimelineEntry; positionless: boolean } => {
    const summary = epics.get(uid);
    if (summary) return { entry: { ...timeline.get(uid)!, projected: summary.projected, progress: { state: "not-started", forecast: summary.work } }, positionless: false };
    return { entry: timeline.get(uid)!, positionless: ghostUids.has(uid) || emptyEpicUids.has(uid) };
  };
  const arrows: ArrowModel[] = edges
    .filter((e) => e.kind === "blocks" && !graph.brokenEdgeIds.has(e.id) && rowY.has(e.source) && rowY.has(e.target))
    .flatMap((e) => {
      const [from, to] = [drawn(e.source), drawn(e.target)];
      if (from.positionless && to.positionless) return []; // nothing real to connect
      const ghostEnd = from.positionless ? "blocker" : to.positionless ? "blocked" : null;
      return [{
        edge: e,
        ...arrowAnchors(from.entry, to.entry, ghostEnd),
        violated: isViolated(timeline.get(e.source)!, timeline.get(e.target)!),
        inCycle: graph.cycleEdgeIds.has(e.id),
        critical: criticalEdges.has(e.id),
        dimmed: chain ? !chain.edges.has(e.id) : emphasized ? !criticalEdges.has(e.id) : false,
      }];
    });

  const late = rows.filter((r) => !r.node.ghost && !isEpicNode(r.node) && r.entry.varianceDays > 0).length;
  const chartWidth = range ? xOf(range.start, range.end, settings.scale) + PX_PER_DAY[settings.scale] : 0;
  const lastBarX = range ? Math.max(0, ...rows.filter((r) => !r.node.ghost).map((r) => xOf(range.start, entryEnd(r.entry), settings.scale))) : 0;

  return (
    <div className="timeline">
      <div className="tl-toolbar" role="toolbar" aria-label="Timeline settings">
        <fieldset className="segmented">
          <legend className="sr-only">Scale</legend>
          {SCALES.map((s) => (
            <label key={s} className={settings.scale === s ? "active" : ""}>
              <input type="radio" name="tl-scale" value={s} checked={settings.scale === s} onChange={() => setSettings({ scale: s })} />
              {s[0].toUpperCase() + s.slice(1)}
            </label>
          ))}
        </fieldset>
        <label className="field" title="Unstarted work is projected to begin no earlier than this day">
          <span className="field-label">Unstarted from</span>
          <input type="date" value={opts.planStart} onChange={(e) => setSettings({ planStart: e.target.value || null })} />
        </label>
        {settings.planStart && (
          <button type="button" className="link-btn" onClick={() => setSettings({ planStart: null })}>
            Reset to today
          </button>
        )}
        <label className="field">
          <span className="field-label">Days / point</span>
          <NumberField min={0.25} step={0.25} value={settings.daysPerPoint} onCommit={(daysPerPoint) => setSettings({ daysPerPoint })} />
        </label>
        <label className="field">
          <span className="field-label">Unpointed</span>
          <NumberField min={1} step={1} integer value={settings.defaultDays} onCommit={(defaultDays) => setSettings({ defaultDays })} />
          <span className="muted small">days</span>
        </label>
        <ul className="tl-legend" aria-label="Legend">
          <li><span className="tl-key tl-projected" aria-hidden="true" /> Projected</li>
          <li><span className="tl-key tl-actual" aria-hidden="true" /> Actual</li>
          <li><span className="tl-key tl-forecast" aria-hidden="true" /> Forecast</li>
          <li><span className="tl-due" aria-hidden="true">◆</span> Due</li>
        </ul>
        <span className="status-text" aria-live="polite">
          {history.status === "loading" ? "Loading status history…" : `${late} late`}
        </span>
      </div>
      {history.status === "done" && history.errors.length > 0 && (
        <div className="banner error" role="alert">
          {history.errors.map((e) => `${e.siteId}: ${e.message}`).join(" · ")}. Actual dates are missing for those issues.
        </div>
      )}

      {range ? (
        <div className="tl-scroll">
          <div className="tl-inner" style={{ width: LABEL_WIDTH + Math.max(chartWidth, lastBarX + 140) }}>
            <div className="tl-axis">
              <div className="tl-corner">Issue</div>
              <TimeAxis range={range} scale={settings.scale} today={today} />
            </div>
            <div className="tl-body" style={{ height }}>
              <div className="tl-chart" style={{ left: LABEL_WIDTH }}>
                <TimeGrid range={range} scale={settings.scale} today={today} height={height} />
                <TimelineArrows arrows={arrows} rowY={rowY} rangeStart={range.start} scale={settings.scale} width={chartWidth + 200} height={height} />
              </div>
              {items.map((item) =>
                item.kind === "lane" ? (
                  <div key={item.lane.id} className="tl-lane" style={{ top: item.y, height: LANE_HEIGHT }}>
                    {item.lane.url ? (
                      <button type="button" className="link-btn" onClick={() => onOpen(item.lane.url!)} aria-label={`Epic ${item.lane.label}. Opens in browser.`}>
                        {item.lane.label} ↗
                      </button>
                    ) : (
                      <span>{item.lane.label}</span>
                    )}
                    <span className="muted small"> · {item.count} {item.count === 1 ? "issue" : "issues"}</span>
                  </div>
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
                      ready: view.highlight === "ready" && insights.ready.has(item.node.uid),
                      aging: insights.aging.get(item.node.uid),
                      change: insights.changed.get(item.node.uid)?.[0],
                    }}
                    onOpen={onOpen}
                    onHover={setHovered}
                  />
                ),
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="canvas-message" role="status">
          Nothing to schedule in this scope.
        </div>
      )}
    </div>
  );
}
