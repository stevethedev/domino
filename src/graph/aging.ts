import { actualStart, durationDays, workdaysBetween, type Day, type StatusHistory } from "./schedule";
import type { Graph } from "./types";

/** Open work that has stopped moving. */
export type Aging =
  /** In progress well past its estimate. */
  | { kind: "stuck"; days: number; estimateDays: number }
  /** Blocked, with no status change for a while. */
  | { kind: "waiting"; days: number };

export type AgingOptions = {
  today: Day;
  daysPerPoint: number;
  defaultDays: number;
  /** Working days without a status change before a blocked issue counts as waiting. */
  waitingDays: number;
  /** In progress for more than this multiple of its estimate counts as stuck. */
  stuckFactor: number;
};

export const AGING_DEFAULTS = { waitingDays: 5, stuckFactor: 2 } as const;

/**
 * Stuck: in progress for more than `stuckFactor` × its estimate, in working days.
 * Waiting: has an open blocker and hasn't changed status (or been created) for `waitingDays`.
 * Stuck wins when both apply; issues without the dates to judge are left out, not guessed.
 * Epics are excluded.
 */
export function computeAging(
  graph: Graph,
  history: StatusHistory,
  openBlockers: ReadonlyMap<string, number>,
  opts: AgingOptions,
): Map<string, Aging> {
  const out = new Map<string, Aging>();
  for (const n of graph.nodes) {
    // Epics span their children's work; they're judged through those issues, not an estimate of their own.
    if (n.ghost || n.statusCategory === "done" || n.epic?.uid === n.uid) continue;
    const changes = history.get(n.uid);
    const started = actualStart(changes);
    if (n.statusCategory === "inprogress" && started) {
      const days = workdaysBetween(started, opts.today);
      const estimateDays = durationDays(n, opts);
      if (days > opts.stuckFactor * estimateDays) {
        out.set(n.uid, { kind: "stuck", days, estimateDays });
        continue;
      }
    }
    if ((openBlockers.get(n.uid) ?? 0) > 0) {
      const since = changes?.at(-1)?.at ?? n.dates?.created;
      if (!since) continue;
      const days = workdaysBetween(since, opts.today);
      if (days >= opts.waitingDays) out.set(n.uid, { kind: "waiting", days });
    }
  }
  return out;
}

/** "stuck 12d" / "waiting 8d". */
export const agingLabel = (a: Aging) => `${a.kind} ${a.days}d`;
