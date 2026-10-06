import { isOneOf } from "../lib/guards";
import { entryEnd, type TimelineEntry } from "./schedule";
import type { GraphNode, StatusCategory } from "./types";

/** What tickets can be sorted by. "natural" keeps each view's own order (dependencies, start date). */
export const SORT_KEYS = [
  "natural",
  "priority",
  "status",
  "key",
  "assignee",
  "points",
  "due",
  "finish",
  "unblocks",
  "blockers",
  "release",
] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export const isSortKey = isOneOf(SORT_KEYS);

/** A sort and whether it's reversed from the key's natural direction. */
export type SortBy = Readonly<{ key: SortKey; reversed: boolean }>;
export const NATURAL_SORT: SortBy = { key: "natural", reversed: false };

export type SortGroup = "Ticket" | "Dates" | "Impact" | "Release";

/** How each key reads in the UI: its label, its group, and its order in words (natural, then reversed). */
export const SORT_INFO: Readonly<
  Record<Exclude<SortKey, "natural">, Readonly<{ label: string; group: SortGroup; order: readonly [string, string] }>>
> = {
  priority: { label: "Priority", group: "Ticket", order: ["Most severe first", "Least severe first"] },
  status: { label: "Status", group: "Ticket", order: ["To Do first", "Done first"] },
  key: { label: "Key", group: "Ticket", order: ["A→Z", "Z→A"] },
  assignee: { label: "Assignee", group: "Ticket", order: ["A→Z", "Z→A"] },
  points: { label: "Story points", group: "Ticket", order: ["Largest first", "Smallest first"] },
  due: { label: "Due date", group: "Dates", order: ["Soonest first", "Latest first"] },
  finish: { label: "Forecast finish", group: "Dates", order: ["Soonest first", "Latest first"] },
  unblocks: { label: "Unblocks most", group: "Impact", order: ["Most first", "Fewest first"] },
  blockers: { label: "Most blockers", group: "Impact", order: ["Most first", "Fewest first"] },
  release: { label: "Release", group: "Release", order: ["Soonest first", "Latest first"] },
};

/** The current order in words, e.g. "Most severe first". */
export const orderText = (sort: SortBy): string => (sort.key === "natural" ? "" : SORT_INFO[sort.key].order[sort.reversed ? 1 : 0]);

/** A stored sort, or the natural order when it's missing or malformed. */
export function parseSortBy(raw: unknown): SortBy {
  if (!raw || typeof raw !== "object") return NATURAL_SORT;
  const r: Partial<Record<keyof SortBy, unknown>> = raw;
  return isSortKey(r.key) ? { key: r.key, reversed: r.reversed === true } : NATURAL_SORT;
}

/** What some keys need beyond the ticket itself. */
export type SortContext = Readonly<{
  openBlockers: ReadonlyMap<string, number>;
  /** Open work downstream of each ticket (see `downstreamOpen`). */
  downstream: ReadonlyMap<string, ReadonlySet<string>>;
  /** The schedule forecast (see `useForecast`). */
  forecast: ReadonlyMap<string, TimelineEntry>;
}>;

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
/** Issue keys and names in reading order: CORE-9 before CORE-10. */
export const naturalCompare = (a: string, b: string): number => collator.compare(a, b);

const STATUS_ORDER: Readonly<Record<StatusCategory, number>> = { todo: 0, inprogress: 1, done: 2, unknown: 3 };

type Value = number | string;

/** Sorts after any real "YYYY-MM-DD" date. */
const UNDATED = "9999-12-31";

/**
 * Each key's value for a ticket, in its natural direction (smaller sorts first), or undefined when
 * the ticket has none (no due date, no priority, ...). "Most first" keys are negated.
 */
function valueOf(key: Exclude<SortKey, "natural">, n: GraphNode, ctx: SortContext): Value | undefined {
  switch (key) {
    case "priority":
      // Ranked by the site's own order; a named priority whose order didn't load comes after those.
      return n.priority ? (n.priority.rank ?? Number.MAX_SAFE_INTEGER) : undefined;
    case "status":
      return STATUS_ORDER[n.statusCategory];
    case "key":
      return n.key;
    case "assignee":
      return n.assigneeName;
    case "points":
      return n.storyPoints === undefined ? undefined : -n.storyPoints;
    case "due":
      return n.dates?.due;
    case "finish": {
      const entry = ctx.forecast.get(n.uid);
      return entry && entryEnd(entry);
    }
    case "unblocks":
      return -(ctx.downstream.get(n.uid)?.size ?? 0);
    case "blockers":
      return -(ctx.openBlockers.get(n.uid) ?? 0);
    case "release": {
      const upcoming = (n.releases ?? []).filter((r) => !r.released);
      if (upcoming.length === 0) return undefined;
      // Dated releases by date; an undated one after every date.
      const dates = upcoming.map((r) => r.date ?? UNDATED);
      return dates.reduce((a, b) => (b < a ? b : a));
    }
  }
}

const compareValues = (a: Value, b: Value): number =>
  typeof a === "number" && typeof b === "number" ? a - b : naturalCompare(String(a), String(b));

/**
 * Orders tickets by `sort`: out-of-scope tickets last, then tickets missing the value last
 * (whichever direction), then the value, then the key. Null for the natural order, which each
 * view keeps as it is.
 */
export function ticketComparator(sort: SortBy, ctx: SortContext): ((a: GraphNode, b: GraphNode) => number) | null {
  if (sort.key === "natural") return null;
  const key = sort.key;
  const direction = sort.reversed ? -1 : 1;
  return (a, b) => {
    if (a.ghost !== b.ghost) return a.ghost ? 1 : -1;
    const va = valueOf(key, a, ctx);
    const vb = valueOf(key, b, ctx);
    if (va === undefined || vb === undefined) {
      if (va !== vb) return va === undefined ? 1 : -1;
    } else {
      const byValue = compareValues(va, vb);
      if (byValue !== 0) return direction * byValue;
    }
    return naturalCompare(a.key, b.key) || a.uid.localeCompare(b.uid);
  };
}
