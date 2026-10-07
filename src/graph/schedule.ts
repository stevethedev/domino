// Projected vs actual scheduling, as pure functions over the graph.
//
// Days are ISO calendar dates ("YYYY-MM-DD", UTC). Spans are half-open: a task occupying
// Mon..Wed has { start: Mon, end: Thu }. Durations count working days (Mon–Fri).
import { getOrThrow } from "../lib/guards";
import type { Graph, GraphNode, StatusCategory } from "./types";

export type Day = string;
export type Span = { start: Day; end: Day };
export type StatusChange = { at: Day; toCategory: StatusCategory };
export type StatusHistory = ReadonlyMap<string, readonly StatusChange[]>;

export type ScheduleOptions = {
  /** Earliest day unstarted work is projected to begin (usually today). */
  planStart: Day;
  today: Day;
  daysPerPoint: number;
  /** Working days assumed for issues without story points. */
  defaultDays: number;
};

export type Progress =
  /** `startUnknown`: no status history says when it started; `actual` is just its resolved day. */
  | { state: "done"; actual: Span; startUnknown?: true }
  | { state: "started"; actualStart: Day; forecast: Span }
  | { state: "not-started"; forecast: Span }
  /** In progress or done in Jira, but there's no status history to say when it started. */
  | { state: "unknown"; forecast: Span };

export type TimelineEntry = {
  projected: Span;
  progress: Progress;
  /** Working days between projected end and actual/forecast end; positive = late. */
  varianceDays: number;
};

const DAY_MS = 86_400_000;

const parse = (d: Day): number => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
const format = (ms: number): Day => new Date(ms).toISOString().slice(0, 10);
const isWeekend = (ms: number): boolean => [0, 6].includes(new Date(ms).getUTCDay());

/**
 * The viewer's local calendar day for an instant (Jira datetimes, epoch ms), so it lines up with
 * `localToday()`: work moved at 6pm in California belongs to that day, not tomorrow's UTC date.
 * Calendar math elsewhere in this module is pure date arithmetic on these day strings.
 */
export function toDay(value: string | number | Date): Day {
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export const addDays = (d: Day, n: number): Day => format(parse(d) + n * DAY_MS);
export const daysBetween = (a: Day, b: Day): number => Math.round((parse(b) - parse(a)) / DAY_MS);
export const maxDay = (...days: Day[]): Day => days.reduce((a, b) => (b > a ? b : a));

/** The latest day any bar or marker for this entry reaches: its forecast (or actual) finish. */
export function entryEnd(e: TimelineEntry): Day {
  const p = e.progress;
  return maxDay(e.projected.end, p.state === "done" ? p.actual.end : p.forecast.end);
}
export const minDay = (...days: Day[]): Day => days.reduce((a, b) => (b < a ? b : a));

/** The day itself if it's a workday, else the following Monday. */
export function nextWorkday(d: Day): Day {
  let ms = parse(d);
  while (isWeekend(ms)) ms += DAY_MS;
  return format(ms);
}

/** The exclusive end of `n` working days starting at `start` (rolled forward to a workday). */
export function addWorkdays(start: Day, n: number): Day {
  let ms = parse(nextWorkday(start));
  for (let left = n; left > 0; ms += DAY_MS) if (!isWeekend(ms)) left--;
  return format(ms);
}

/** Working days in [a, b); negative when b < a. */
export function workdaysBetween(a: Day, b: Day): number {
  if (b < a) return -workdaysBetween(b, a);
  let count = 0;
  for (let ms = parse(a); ms < parse(b); ms += DAY_MS) if (!isWeekend(ms)) count++;
  return count;
}

export function durationDays(node: GraphNode, opts: Pick<ScheduleOptions, "daysPerPoint" | "defaultDays">): number {
  const raw = node.storyPoints !== undefined && node.storyPoints > 0 ? node.storyPoints * opts.daysPerPoint : opts.defaultDays;
  return Math.max(1, Math.ceil(raw));
}

/** Blocks edges that constrain scheduling (cycle-breaking edges excluded), as uid -> blockers. */
function blockersOf(graph: Graph): Map<string, string[]> {
  const byTarget = new Map<string, string[]>();
  for (const e of graph.edges) {
    if (e.kind !== "blocks" || graph.brokenEdgeIds.has(e.id) || e.source === e.target) continue;
    byTarget.set(e.target, [...(byTarget.get(e.target) ?? []), e.source]);
  }
  return byTarget;
}

/** Kahn's algorithm with a sorted queue, so the order is deterministic. Acyclic by construction. */
function topoOrder(graph: Graph, blockers: Map<string, string[]>): string[] {
  const indeg = new Map(graph.nodes.map((n) => [n.uid, blockers.get(n.uid)?.length ?? 0]));
  const dependents = new Map<string, string[]>();
  for (const [target, sources] of blockers) for (const s of sources) dependents.set(s, [...(dependents.get(s) ?? []), target]);
  const queue = graph.nodes
    .filter((n) => indeg.get(n.uid) === 0)
    .map((n) => n.uid)
    .sort();
  const order: string[] = [];
  for (let v = queue.shift(); v !== undefined; v = queue.shift()) {
    order.push(v);
    for (const t of dependents.get(v) ?? []) {
      indeg.set(t, getOrThrow(indeg, t) - 1);
      if (indeg.get(t) === 0) queue.push(t);
    }
    queue.sort();
  }
  return order;
}

/**
 * The baseline each issue is measured against: its estimate (`durationDays`) laid out from when it
 * really started, or, for unstarted work, from when its blockers are projected to finish (never
 * before `planStart`). Started issues are anchored at their own start, so an issue isn't "late"
 * merely because it began after some arbitrary plan date; its variance is overrun plus slip
 * inherited from blockers.
 */
export function projectSchedule(graph: Graph, opts: ScheduleOptions, history: StatusHistory = new Map()): Map<string, Span> {
  const blockers = blockersOf(graph);
  const byUid = new Map(graph.nodes.map((n) => [n.uid, n]));
  const spans = new Map<string, Span>();
  for (const uid of topoOrder(graph, blockers)) {
    const node = getOrThrow(byUid, uid);
    const started = actualStart(history.get(uid));
    // Done with no history: its resolved day is all that's known, and better than an estimate laid out from today.
    const resolved = node.statusCategory === "done" && !started ? node.dates?.resolved : undefined;
    if (resolved) {
      spans.set(uid, { start: resolved, end: addDays(resolved, 1) });
      continue;
    }
    const after = (blockers.get(uid) ?? []).map((b) => getOrThrow(spans, b).end);
    const start = started ?? nextWorkday(maxDay(opts.planStart, ...after));
    spans.set(uid, { start, end: addWorkdays(start, durationDays(node, opts)) });
  }
  return spans;
}

/** First move out of To Do, from the issue's status history. */
export function actualStart(history: readonly StatusChange[] | undefined): Day | undefined {
  return history?.find((c) => c.toCategory !== "todo")?.at;
}

/**
 * Actual/forecast pass: like the projection, but done issues keep their real dates, started
 * issues keep their real start, nothing open is scheduled before today, and blockers' forecasts
 * push their dependents. So a late blocker shows up as forecast slip downstream.
 */
export function computeTimeline(graph: Graph, history: StatusHistory, opts: ScheduleOptions): Map<string, TimelineEntry> {
  const projected = projectSchedule(graph, opts, history);
  const blockers = blockersOf(graph);
  const byUid = new Map(graph.nodes.map((n) => [n.uid, n]));
  const finish = new Map<string, Day>(); // actual or forecast end, for dependents
  const out = new Map<string, TimelineEntry>();

  for (const uid of topoOrder(graph, blockers)) {
    const node = getOrThrow(byUid, uid);
    const planned = getOrThrow(projected, uid);
    const duration = durationDays(node, opts);
    const started = actualStart(history.get(uid));
    const blockersDone = maxDay(opts.today, ...(blockers.get(uid) ?? []).map((b) => getOrThrow(finish, b)));
    let progress: Progress;

    if (node.statusCategory === "done") {
      const resolved = node.dates?.resolved;
      const end = resolved ? addDays(resolved, 1) : undefined;
      if (started && end) progress = { state: "done", actual: { start: started, end: maxDay(end, addDays(started, 1)) } };
      // No history: what's known is the day it was resolved, not an estimate laid out from today.
      else if (resolved && end) progress = { state: "done", actual: { start: resolved, end }, startUnknown: true };
      else progress = { state: "unknown", forecast: planned };
    } else if (started) {
      const remaining = Math.max(1, duration - workdaysBetween(started, opts.today));
      progress = { state: "started", actualStart: started, forecast: { start: opts.today, end: addWorkdays(opts.today, remaining) } };
    } else if (node.statusCategory === "inprogress") {
      const start = nextWorkday(opts.today);
      progress = { state: "unknown", forecast: { start, end: addWorkdays(start, duration) } };
    } else {
      const start = nextWorkday(blockersDone);
      progress = { state: "not-started", forecast: { start, end: addWorkdays(start, duration) } };
    }

    const end = progress.state === "done" ? progress.actual.end : progress.forecast.end;
    // Done work never holds up what it blocks: with no dates at all, count it as finished by today.
    finish.set(uid, node.statusCategory === "done" && progress.state === "unknown" ? opts.today : end);
    out.set(uid, { projected: planned, progress, varianceDays: workdaysBetween(planned.end, end) });
  }
  return out;
}

/** For when status history hasn't loaded: one shared empty history, so cached forecasts are reused. */
export const NO_HISTORY: StatusHistory = new Map();

// The timeline and the sidebar's release forecasts ask for the same schedule; share it per graph
// and history (dropped with them), keyed by the options.
const timelines = new WeakMap<Graph, WeakMap<StatusHistory, Map<string, ReadonlyMap<string, TimelineEntry>>>>();

/** `computeTimeline`, computed once per graph, history and options. */
export function timelineFor(graph: Graph, history: StatusHistory, opts: ScheduleOptions): ReadonlyMap<string, TimelineEntry> {
  const byHistory = timelines.get(graph) ?? new WeakMap<StatusHistory, Map<string, ReadonlyMap<string, TimelineEntry>>>();
  timelines.set(graph, byHistory);
  const byOpts = byHistory.get(history) ?? new Map<string, ReadonlyMap<string, TimelineEntry>>();
  byHistory.set(history, byOpts);
  const key = JSON.stringify(opts);
  const hit = byOpts.get(key);
  if (hit) return hit;
  const result = computeTimeline(graph, history, opts);
  byOpts.set(key, result);
  return result;
}
