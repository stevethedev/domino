import type { Lane, LaneFn } from "../../graph/layout";
import { addDays, daysBetween, maxDay, minDay, type Day, type Span, type TimelineEntry } from "../../graph/schedule";
import type { GraphNode } from "../../graph/types";
import { isOneOf } from "../../lib/guards";

export type Scale = "day" | "week" | "month";
export const SCALES: readonly Scale[] = ["day", "week", "month"];
export const isScale = isOneOf(SCALES);

export const PX_PER_DAY: Record<Scale, number> = { day: 28, week: 11, month: 4 };
export const LABEL_WIDTH = 320;
export const ROW_HEIGHT = 40;
export const LANE_HEIGHT = 30;

export type TimelineRowModel = { kind: "row"; node: GraphNode; entry: TimelineEntry; y: number };
export type TimelineLaneModel = { kind: "lane"; lane: Lane; y: number; count: number };
export type TimelineItem = TimelineRowModel | TimelineLaneModel;

/** The latest day any bar or marker for this entry reaches. */
export function entryEnd(e: TimelineEntry): Day {
  const p = e.progress;
  return maxDay(e.projected.end, p.state === "done" ? p.actual.end : p.forecast.end);
}

function entryStart(e: TimelineEntry): Day {
  const p = e.progress;
  const starts = [e.projected.start, p.state === "done" ? p.actual.start : p.state === "started" ? p.actualStart : p.forecast.start];
  return minDay(...starts);
}

/**
 * Rows grouped into lanes (or one unlabeled lane), each lane sorted by projected start so
 * dependency arrows mostly run down and to the right. Lanes order by their earliest start,
 * with catch-all lanes last. Returns items with their y offsets and the total height.
 */
export function layoutRows(
  nodes: readonly GraphNode[],
  timeline: ReadonlyMap<string, TimelineEntry>,
  laneOf: LaneFn | undefined,
): { items: TimelineItem[]; height: number } {
  const lanes = new Map<string, { lane: Lane; rows: GraphNode[] }>();
  for (const n of nodes) {
    if (!timeline.has(n.uid)) continue;
    const lane = laneOf?.(n) ?? { id: "all", label: "" };
    const entry = lanes.get(lane.id) ?? lanes.set(lane.id, { lane, rows: [] }).get(lane.id)!;
    entry.rows.push(n);
  }
  const startOf = (n: GraphNode) => timeline.get(n.uid)!.projected.start;
  // Ghosts have no loaded dates, so they go last instead of sorting by an invented start.
  const byStart = (a: GraphNode, b: GraphNode) =>
    Number(a.ghost) - Number(b.ghost) || startOf(a).localeCompare(startOf(b)) || a.uid.localeCompare(b.uid);
  const ordered = [...lanes.values()]
    .map((l) => ({ ...l, rows: [...l.rows].sort(byStart) }))
    .sort((a, b) => Number(!!a.lane.last) - Number(!!b.lane.last) || startOf(a.rows[0]).localeCompare(startOf(b.rows[0])) || a.lane.id.localeCompare(b.lane.id));

  const items: TimelineItem[] = [];
  let y = 0;
  for (const { lane, rows } of ordered) {
    if (laneOf) {
      items.push({ kind: "lane", lane, y, count: rows.length });
      y += LANE_HEIGHT;
    }
    for (const node of rows) {
      items.push({ kind: "row", node, entry: timeline.get(node.uid)!, y });
      y += ROW_HEIGHT;
    }
  }
  return { items, height: y };
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

export const xOf = (rangeStart: Day, day: Day, scale: Scale) => daysBetween(rangeStart, day) * PX_PER_DAY[scale];

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
    [...children].map(([uid, es]) => [uid, { projected: envelope(es.map((e) => e.projected)), work: envelope(es.map(workSpan)), children: es.length }]),
  );
}

export const isEpicNode = (n: GraphNode) => n.epic?.uid === n.uid;
