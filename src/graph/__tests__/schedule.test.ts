import { describe, expect, it } from "vitest";
import { defined, getOrThrow } from "../../lib/guards";
import { buildGraph } from "../buildGraph";
import {
  addWorkdays,
  computeTimeline,
  durationDays,
  projectSchedule,
  workdaysBetween,
  type ScheduleOptions,
  type StatusChange,
} from "../schedule";
import { BLOCKS, data, issue, link, site } from "./helpers";
import type { RawIssue, RawIssueChangeLog, RawStatusCategoryKey } from "../../data/jiraTypes";
import type { Graph } from "../types";

const A = site("a");
// 2026-10-05 is a Monday.
const opts = (o: Partial<ScheduleOptions> = {}): ScheduleOptions => ({
  planStart: "2026-10-05",
  today: "2026-10-05",
  daysPerPoint: 1,
  defaultDays: 2,
  ...o,
});

function pointed(key: string, points: number | null, cat: RawStatusCategoryKey = "new", resolved?: string): RawIssue {
  const i = issue(key, cat);
  i.fields.customfield_10016 = points;
  if (resolved) i.fields.resolutiondate = `${resolved}T15:00:00.000+0000`;
  return i;
}

/** A blocks B blocks C ... built from issues in order. */
function chainGraph(issues: RawIssue[]): Graph {
  for (let i = 0; i < issues.length - 1; i++) link(`c${i}`, BLOCKS, issues[i], issues[i + 1]);
  return buildGraph({ sites: [A], data: [data("a", issues)] });
}

const history = (entries: Record<string, StatusChange[]>): Map<string, StatusChange[]> => new Map(Object.entries(entries));

describe("working-day calendar", () => {
  it("skips weekends; a span ends the day after its last workday", () => {
    expect(addWorkdays("2026-10-05", 5)).toBe("2026-10-10"); // Mon..Fri -> ends Sat (bar stops Friday)
    expect(addWorkdays("2026-10-05", 6)).toBe("2026-10-13"); // Mon..next Mon -> ends Tue
    expect(addWorkdays("2026-10-09", 1)).toBe("2026-10-10"); // Fri only
    expect(addWorkdays("2026-10-10", 1)).toBe("2026-10-13"); // Sat rolls to Mon, ends Tue
    expect(workdaysBetween("2026-10-05", "2026-10-12")).toBe(5);
    expect(workdaysBetween("2026-10-12", "2026-10-05")).toBe(-5);
  });

  it("uses points x days/point, or the default for unpointed issues, minimum 1", () => {
    const g = buildGraph({ sites: [A], data: [data("a", [pointed("P-1", 3), pointed("P-2", null), pointed("P-3", 0.2)])] });
    const d = (k: string): number => durationDays(defined(g.nodes.find((n) => n.key === k), "node"), opts({ daysPerPoint: 0.5 }));
    expect([d("P-1"), d("P-2"), d("P-3")]).toEqual([2, 2, 1]);
  });
});

describe("projectSchedule", () => {
  it("starts each issue when its blocker ends", () => {
    const g = chainGraph([pointed("C-1", 2), pointed("C-2", 3), pointed("C-3", 1)]);
    const s = projectSchedule(g, opts());
    expect(s.get("a:C-1")).toEqual({ start: "2026-10-05", end: "2026-10-07" });
    expect(s.get("a:C-2")).toEqual({ start: "2026-10-07", end: "2026-10-10" }); // Wed..Fri
    expect(s.get("a:C-3")).toEqual({ start: "2026-10-12", end: "2026-10-13" }); // dependents start Monday
  });

  it("waits for the latest of several blockers", () => {
    const [x, y, t] = [pointed("X-1", 1), pointed("X-2", 4), pointed("T-1", 1)];
    link("1", BLOCKS, x, t);
    link("2", BLOCKS, y, t);
    const s = projectSchedule(buildGraph({ sites: [A], data: [data("a", [x, y, t])] }), opts());
    expect(getOrThrow(s, "a:T-1").start).toBe(getOrThrow(s, "a:X-2").end);
  });

  it("schedules cycles using the cycle-broken edges", () => {
    const [x, y] = [pointed("Y-1", 1), pointed("Y-2", 1)];
    link("1", BLOCKS, x, y);
    link("2", BLOCKS, y, x);
    const s = projectSchedule(buildGraph({ sites: [A], data: [data("a", [x, y])] }), opts());
    expect(s.size).toBe(2);
  });
});

describe("computeTimeline", () => {
  it("done: actual span from first move out of To Do to the resolved day", () => {
    const g = chainGraph([pointed("D-1", 2, "done", "2026-10-08")]);
    const t = computeTimeline(g, history({ "a:D-1": [{ at: "2026-10-05", toCategory: "inprogress" }] }), opts({ today: "2026-10-20" }));
    expect(t.get("a:D-1")).toMatchObject({
      progress: { state: "done", actual: { start: "2026-10-05", end: "2026-10-09" } },
      varianceDays: 2, // projected to end 10-07 (exclusive), really ended 10-09
    });
  });

  it("started: forecast from today for the remaining work; overrun still forecasts at least a day", () => {
    const g = chainGraph([pointed("S-1", 5), pointed("S-2", 2)]);
    const t = computeTimeline(g, history({ "a:S-1": [{ at: "2026-10-05", toCategory: "inprogress" }] }), opts({ today: "2026-10-14" }));
    // 7 workdays elapsed of a 5-day estimate -> 1 more day from today.
    expect(getOrThrow(t, "a:S-1").progress).toEqual({ state: "started", actualStart: "2026-10-05", forecast: { start: "2026-10-14", end: "2026-10-15" } });
    expect(getOrThrow(t, "a:S-1").varianceDays).toBe(3); // projected end 10-12, forecast 10-15
    // The late blocker pushes the dependent's forecast.
    expect(getOrThrow(t, "a:S-2").progress).toEqual({ state: "not-started", forecast: { start: "2026-10-15", end: "2026-10-17" } });
    expect(getOrThrow(t, "a:S-2").varianceDays).toBeGreaterThan(0);
  });

  it("not started: never forecast before today", () => {
    const g = chainGraph([pointed("N-1", 1)]);
    const t = computeTimeline(g, new Map(), opts({ today: "2026-10-21" }));
    expect(getOrThrow(t, "a:N-1").progress).toEqual({ state: "not-started", forecast: { start: "2026-10-21", end: "2026-10-22" } });
  });

  it("measures a started issue from its own start, not the plan start", () => {
    // Unrelated work that began two weeks after the plan start and took exactly its estimate.
    const g = chainGraph([pointed("L-1", 3, "done", "2026-10-21")]);
    const t = computeTimeline(g, history({ "a:L-1": [{ at: "2026-10-19", toCategory: "inprogress" }] }), opts({ today: "2026-10-26" }));
    expect(getOrThrow(t, "a:L-1").projected).toEqual({ start: "2026-10-19", end: "2026-10-22" });
    expect(getOrThrow(t, "a:L-1").varianceDays).toBe(0);
  });

  it("unstarted work inherits slip from a late blocker", () => {
    const g = chainGraph([pointed("I-1", 2), pointed("I-2", 1)]);
    // I-1 started on time but is still open well past its 2-day estimate.
    const t = computeTimeline(g, history({ "a:I-1": [{ at: "2026-10-05", toCategory: "inprogress" }] }), opts({ today: "2026-10-12", planStart: "2026-10-12" }));
    expect(getOrThrow(t, "a:I-2").projected.start).toBe("2026-10-12"); // blocker's projected end is past: from planStart
    expect(getOrThrow(t, "a:I-2").varianceDays).toBe(1); // forecast waits for I-1's forecast finish (10-13)
  });

  it("on track is zero variance, early is negative", () => {
    const g = chainGraph([pointed("O-1", 3, "done", "2026-10-06")]);
    const t = computeTimeline(g, history({ "a:O-1": [{ at: "2026-10-05", toCategory: "inprogress" }] }), opts({ today: "2026-10-20" }));
    expect(getOrThrow(t, "a:O-1").varianceDays).toBe(-1); // projected end 10-08, actual 10-07
  });

  it("in progress or done without history is 'unknown', not invented", () => {
    const g = chainGraph([pointed("U-1", 1, "indeterminate"), pointed("U-2", 1, "done")]);
    const t = computeTimeline(g, new Map(), opts());
    expect(getOrThrow(t, "a:U-1").progress.state).toBe("unknown");
    expect(getOrThrow(t, "a:U-2").progress.state).toBe("unknown");
  });
});

import { toStatusHistory } from "../history";

describe("toStatusHistory", () => {
  it("doesn't trip over items without toString (an inherited Object.prototype member)", () => {
    const g = chainGraph([pointed("H-1", 1)]);
    // Parsed from JSON like real payloads: the item has no own `toString`, only the inherited method.
    // oxlint-disable-next-line typescript/no-unsafe-assignment -- no typed literal can omit `toString`: RawChangeItem's string field clashes with Object#toString.
    const logs: RawIssueChangeLog[] = JSON.parse('[{ "issueId": "H-1", "changeHistories": [{ "created": "2026-10-05T10:00:00.000+0000", "items": [{ "fieldId": "status", "to": "999" }] }] }]');
    expect(() => toStatusHistory(logs, [], g.nodes, "a")).not.toThrow();
    expect(toStatusHistory(logs, [], g.nodes, "a").size).toBe(0); // unknown status: dropped
  });
});

import { toDay } from "../schedule";

describe("toDay", () => {
  it("buckets an instant by the viewer's local calendar day, matching localToday()", () => {
    // Node re-reads TZ when it changes; typed locally since the app's tsconfig has no Node types.
    const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
    const tz = env.TZ;
    env.TZ = "America/Los_Angeles";
    try {
      // 6pm Oct 1 in California is already Oct 2 in UTC.
      expect(toDay("2026-10-02T01:00:00.000+0000")).toBe("2026-10-01");
      expect(toDay("2026-10-01T18:00:00.000-0700")).toBe("2026-10-01");
    } finally {
      if (tz === undefined) delete env.TZ;
      else env.TZ = tz;
    }
  });
});
