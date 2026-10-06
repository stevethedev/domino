import type { CardOrder, Lane, LaneFn } from "../../graph/layout";
import { addDays, daysBetween, entryEnd, maxDay, minDay, type Day, type Span, type TimelineEntry } from "../../graph/schedule";
import type { GraphNode } from "../../graph/types";
import { isOneOf } from "../../lib/guards";

export type Scale = "day" | "week" | "month";
export const SCALES: readonly Scale[] = ["day", "week", "month"];
export const isScale = isOneOf(SCALES);

export const PX_PER_DAY: Record<Scale, number> = { day: 28, week: 11, month: 4 };
export const LABEL_WIDTH = 320;
export const ROW_HEIGHT = 40;
export const LANE_HEIGHT = 30;
/** How long a lane takes to fold or unfold; matches `--fold-ms` in timeline.css (via --duration-base). */
export const FOLD_MS = 200;

/** `folded`: the row's lane is collapsed; it stays mounted at the header's y (hidden) so folding can animate. */
export type TimelineRowModel = { kind: "row"; node: GraphNode; entry: TimelineEntry; y: number; folded: boolean };
export type TimelineLaneModel = {
  kind: "lane";
  lane: Lane;
  y: number;
  count: number;
  collapsed: boolean;
  /** Issues in the lane forecast to finish late (epic rows summarize others, so they don't count). */
  late: number;
};
export type TimelineItem = TimelineRowModel | TimelineLaneModel;
/** A row before placement: every row, including those inside collapsed lanes. */
export type TimelineRowData = { node: GraphNode; entry: TimelineEntry };

export const isLate = (r: TimelineRowData): boolean => !r.node.ghost && !isEpicNode(r.node) && r.entry.varianceDays > 0;

export { entryEnd };

function entryStart(e: TimelineEntry): Day {
  const p = e.progress;
  const starts = [e.projected.start, p.state === "done" ? p.actual.start : p.state === "started" ? p.actualStart : p.forecast.start];
  return minDay(...starts);
}

/**
 * Rows grouped into lanes (or one unlabeled lane), each lane sorted by projected start so
 * dependency arrows mostly run down and to the right. Lanes order by their earliest start,
 * with catch-all lanes last. With `order` (the user's sort), rows follow it instead (start date
 * breaks ties) and lanes order by their first row under it. A collapsed lane takes only its header's height; its rows come back
 * `folded` at the header's y. Returns items with their y offsets, the total height, and every
 * row (collapsed or not) for date ranges and counts.
 */
export function layoutRows(
  nodes: readonly GraphNode[],
  timeline: ReadonlyMap<string, TimelineEntry>,
  laneOf: LaneFn | undefined,
  collapsed: ReadonlySet<string> = new Set(),
  order?: CardOrder,
): { items: TimelineItem[]; height: number; all: TimelineRowData[] } {
  type Row = TimelineRowData;
  const lanes = new Map<string, { lane: Lane; rows: Row[] }>();
  for (const node of nodes) {
    const entry = timeline.get(node.uid);
    if (!entry) continue;
    const lane = laneOf?.(node) ?? { id: "all", label: "" };
    const group = lanes.get(lane.id);
    if (group) group.rows.push({ node, entry });
    else lanes.set(lane.id, { lane, rows: [{ node, entry }] });
  }
  const startOf = (r: Row): Day => r.entry.projected.start;
  // Ghosts have no loaded dates, so they go last instead of sorting by an invented start.
  const byStart = (a: Row, b: Row): number =>
    Number(a.node.ghost) - Number(b.node.ghost) || startOf(a).localeCompare(startOf(b)) || a.node.uid.localeCompare(b.node.uid);
  const byRow = (a: Row, b: Row): number => (order ? order(a.node, b.node) : 0) || byStart(a, b);
  const byFirstRow = (a: Row, b: Row): number => (order ? order(a.node, b.node) : startOf(a).localeCompare(startOf(b)));
  const ordered = [...lanes.values()]
    .map((l) => ({ ...l, rows: [...l.rows].sort(byRow) }))
    .sort(
      (a, b) => Number(!!a.lane.last) - Number(!!b.lane.last) || byFirstRow(a.rows[0], b.rows[0]) || a.lane.id.localeCompare(b.lane.id),
    );

  const items: TimelineItem[] = [];
  let y = 0;
  for (const { lane, rows } of ordered) {
    const isCollapsed = !!laneOf && collapsed.has(lane.id);
    if (laneOf) {
      items.push({ kind: "lane", lane, y, count: rows.length, collapsed: isCollapsed, late: rows.filter(isLate).length });
      y += LANE_HEIGHT;
    }
    for (const { node, entry } of rows) {
      items.push({ kind: "row", node, entry, y: isCollapsed ? y - LANE_HEIGHT : y, folded: isCollapsed });
      if (!isCollapsed) y += ROW_HEIGHT;
    }
  }
  return { items, height: y, all: ordered.flatMap((l) => l.rows) };
}

/** Header flags that end at `right` (px) and are `width` wide; see `stackFlags`. */
export type Flag = Readonly<{ id: string; right: number; width: number }>;

/** Space kept between flags on one header line, in px. */
const FLAG_GAP = 4;

/**
 * Header lines for flags that would overlap: each flag takes the first line (0 = top) where it
 * clears the flag before it, working left to right. Returns each flag's line.
 */
export function stackFlags(flags: readonly Flag[]): Map<string, number> {
  const lineEnds: number[] = []; // right edge of the last flag on each line
  const lines = new Map<string, number>();
  for (const f of [...flags].sort((a, b) => a.right - b.right)) {
    const left = f.right - f.width;
    const free = lineEnds.findIndex((end) => end + FLAG_GAP <= left);
    const line = free === -1 ? lineEnds.length : free;
    lineEnds[line] = f.right;
    lines.set(f.id, line);
  }
  return lines;
}

/** First and last day shown: everything drawn, plus today and the plan start, with padding. */
export function dayRange(entries: readonly TimelineEntry[], extra: readonly Day[]): { start: Day; end: Day } {
  const starts = [...entries.map(entryStart), ...extra];
  const ends = [...entries.map(entryEnd), ...extra];
  return { start: addDays(minDay(...starts), -3), end: addDays(maxDay(...ends), 7) };
}

export type Tick = { day: Day; label: string; major: boolean };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

/** Axis ticks for a scale: every day, every Monday, or every 1st of the month. */
export function ticks(range: { start: Day; end: Day }, scale: Scale): Tick[] {
  const out: Tick[] = [];
  for (let d = range.start; d <= range.end; d = addDays(d, 1)) {
    const date = new Date(`${d}T00:00:00Z`);
    const dom = date.getUTCDate();
    const month = MONTHS[date.getUTCMonth()];
    if (scale === "day") out.push({ day: d, label: `${WEEKDAYS[date.getUTCDay()]} ${dom}`, major: dom === 1 || d === range.start });
    else if (scale === "week" && date.getUTCDay() === 1) out.push({ day: d, label: `${month} ${dom}`, major: dom <= 7 });
    else if (scale === "month" && dom === 1) out.push({ day: d, label: `${month} ${date.getUTCFullYear()}`, major: true });
  }
  return out;
}

export const xOf = (rangeStart: Day, day: Day, scale: Scale): number => daysBetween(rangeStart, day) * PX_PER_DAY[scale];

/** "+3d late", "2d early", "on track". */
export function varianceLabel(days: number): string {
  if (days === 0) return "on track";
  return days > 0 ? `+${days}d late` : `${-days}d early`;
}

/** Today's local calendar date, matching what the user sees on their clock. */
export const localToday = (): Day => new Date().toLocaleDateString("en-CA");

export type EpicSummary = { projected: Span; work: Span; children: number };

/** The solid/dotted bar a row draws: actual for done, actual start to forecast end when started, else the forecast. */
export const workSpan = (e: TimelineEntry): Span => {
  const p = e.progress;
  if (p.state === "done") return p.actual;
  if (p.state === "started") return { start: p.actualStart, end: p.forecast.end };
  return p.forecast;
};

/** For each epic with loaded children: the envelope of the children's projected and actual/forecast spans. */
export function summarizeEpics(nodes: readonly GraphNode[], timeline: ReadonlyMap<string, TimelineEntry>): Map<string, EpicSummary> {
  const children = new Map<string, TimelineEntry[]>();
  for (const n of nodes) {
    const e = timeline.get(n.uid);
    if (!n.epic || n.epic.uid === n.uid || !e) continue;
    children.set(n.epic.uid, [...(children.get(n.epic.uid) ?? []), e]);
  }
  const envelope = (spans: Span[]): Span => ({ start: minDay(...spans.map((s) => s.start)), end: maxDay(...spans.map((s) => s.end)) });
  return new Map(
    [...children].map(([uid, es]) => [
      uid,
      { projected: envelope(es.map((e) => e.projected)), work: envelope(es.map(workSpan)), children: es.length },
    ]),
  );
}

export const isEpicNode = (n: GraphNode): boolean => n.epic?.uid === n.uid;

/**
 * What a row actually draws, for anchoring arrows: an epic with loaded children draws its
 * children's envelope; an epic without them, like a ghost, draws no bar, so it has no position.
 */
export function drawnBar(
  node: GraphNode,
  entry: TimelineEntry,
  summary: EpicSummary | undefined,
): { entry: TimelineEntry; positionless: boolean } {
  if (summary)
    return {
      entry: { ...entry, projected: summary.projected, progress: { state: "not-started", forecast: summary.work } },
      positionless: false,
    };
  return { entry, positionless: node.ghost || isEpicNode(node) };
}
