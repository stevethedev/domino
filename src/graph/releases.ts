// Releases (Jira fix versions) and whether their work is forecast to make the date.
import { addDays, maxDay, type Day, type TimelineEntry } from "./schedule";
import type { Graph, Release } from "./types";

export type ReleaseStatus = Readonly<{
  release: Release;
  /** Loaded issues planned for the release. */
  issues: readonly string[];
  /** Those not done yet. */
  open: readonly string[];
  /** Open issues forecast to finish after the release date (none without a date, or once released). */
  atRisk: readonly string[];
  /** The last day the open work is forecast to finish, if any is open. */
  forecastDone?: Day;
}>;

/** The last working day of an entry's actual or forecast span (spans are half-open). */
export const lastDayOf = (e: TimelineEntry): Day =>
  addDays(e.progress.state === "done" ? e.progress.actual.end : e.progress.forecast.end, -1);

/**
 * Every release the loaded issues are planned for, with its open and at-risk issues. Upcoming
 * releases come first, soonest first (undated ones after), then released ones, latest first.
 */
export function releaseStatuses(graph: Pick<Graph, "nodes">, timeline: ReadonlyMap<string, TimelineEntry>): ReleaseStatus[] {
  const byRelease = new Map<string, { release: Release; issues: string[] }>();
  for (const n of graph.nodes) {
    for (const r of n.releases ?? []) {
      const entry = byRelease.get(r.uid) ?? { release: r, issues: [] };
      entry.issues.push(n.uid);
      byRelease.set(r.uid, entry);
    }
  }
  const categoryOf = new Map(graph.nodes.map((n) => [n.uid, n.statusCategory]));
  const statuses = [...byRelease.values()].map(({ release, issues }): ReleaseStatus => {
    const open = issues.filter((uid) => categoryOf.get(uid) !== "done");
    const finishes = open.flatMap((uid) => {
      const entry = timeline.get(uid);
      return entry ? [{ uid, last: lastDayOf(entry) }] : [];
    });
    const date = release.date;
    const atRisk = date && !release.released ? finishes.filter((f) => f.last > date).map((f) => f.uid) : [];
    return { release, issues, open, atRisk, forecastDone: finishes.length > 0 ? maxDay(...finishes.map((f) => f.last)) : undefined };
  });
  return statuses.sort((a, b) => compareReleases(a.release, b.release));
}

/** Upcoming releases soonest first, then upcoming undated ones, then released ones latest first. */
function compareReleases(a: Release, b: Release): number {
  const group = (r: Release): number => (r.released ? 2 : r.date ? 0 : 1);
  const byDate = (x = "", y = ""): number => x.localeCompare(y);
  const dates = a.released ? byDate(b.date, a.date) : byDate(a.date, b.date);
  return group(a) - group(b) || dates || a.name.localeCompare(b.name);
}
