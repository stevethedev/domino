import { describe, expect, it } from "vitest";
import type { TimelineEntry } from "../../../graph/schedule";
import { isViolated } from "../TimelineArrows";

const span = { start: "2026-10-05", end: "2026-10-07" };
const started: TimelineEntry = {
  projected: span,
  progress: { state: "started", actualStart: "2026-10-05", forecast: span },
  varianceDays: 0,
};

describe("isViolated", () => {
  it("is not a violation when the blocked issue's start is unknown (done with no history)", () => {
    const resolvedOnly: TimelineEntry = {
      projected: span,
      progress: { state: "done", actual: span, startUnknown: true },
      varianceDays: 0,
    };
    const doneBlocker: TimelineEntry = { projected: span, progress: { state: "done", actual: span }, varianceDays: 0 };
    expect(isViolated(doneBlocker, resolvedOnly)).toBe(false);
    expect(isViolated(resolvedOnly, resolvedOnly)).toBe(false);
  });

  it("is not a violation when the blocker's real dates are unknown", () => {
    const unknownBlocker: TimelineEntry = { projected: span, progress: { state: "unknown", forecast: span }, varianceDays: 0 };
    expect(isViolated(unknownBlocker, started)).toBe(false);
  });

  it("is a violation when work started before an open blocker finished", () => {
    const openBlocker: TimelineEntry = { projected: span, progress: { state: "not-started", forecast: span }, varianceDays: 0 };
    expect(isViolated(openBlocker, started)).toBe(true);
  });
});

import type { GraphNode } from "../../../graph/types";
import { arrowAnchors } from "../TimelineArrows";
import { drawnBar, summarizeEpics } from "../timelineLayout";
import { getOrThrow } from "../../../lib/guards";

describe("arrowAnchors", () => {
  const projected = { start: "2026-09-07", end: "2026-09-10" };

  it("leaves from the end of the bar you see (forecast/actual), not the projected outline", () => {
    const blocker: TimelineEntry = {
      projected,
      progress: { state: "started", actualStart: "2026-09-07", forecast: { start: "2026-10-01", end: "2026-10-03" } },
      varianceDays: 15,
    };
    const blocked: TimelineEntry = {
      projected: { start: "2026-09-10", end: "2026-09-12" },
      progress: { state: "not-started", forecast: { start: "2026-10-03", end: "2026-10-06" } },
      varianceDays: 15,
    };
    // Finish-to-start: the dependent's forecast starts exactly where the blocker's forecast ends.
    expect(arrowAnchors(blocker, blocked, null)).toEqual({ from: "2026-10-03", to: "2026-10-03", stub: null });
  });

  it("uses actual dates for done and started work", () => {
    const done: TimelineEntry = {
      projected,
      progress: { state: "done", actual: { start: "2026-09-08", end: "2026-09-15" } },
      varianceDays: 3,
    };
    const started: TimelineEntry = {
      projected,
      progress: { state: "started", actualStart: "2026-09-16", forecast: { start: "2026-10-01", end: "2026-10-02" } },
      varianceDays: 0,
    };
    expect(arrowAnchors(done, started, null)).toEqual({ from: "2026-09-15", to: "2026-09-16", stub: null });
  });

  it("uses a short stub at the known end when one side is a ghost (its dates aren't loaded)", () => {
    const ghost: TimelineEntry = {
      projected,
      progress: { state: "unknown", forecast: { start: "2026-10-01", end: "2026-10-03" } },
      varianceDays: 0,
    };
    const started: TimelineEntry = {
      projected,
      progress: { state: "started", actualStart: "2026-09-16", forecast: { start: "2026-10-01", end: "2026-10-02" } },
      varianceDays: 0,
    };
    expect(arrowAnchors(ghost, started, "blocker")).toEqual({ from: "2026-09-16", to: "2026-09-16", stub: "from" });
    expect(arrowAnchors(started, ghost, "blocked")).toEqual({ from: "2026-10-02", to: "2026-10-02", stub: "to" });
  });
});

describe("arrow anchors on epic rows", () => {
  const issue = (key: string, epicKey?: string): GraphNode => ({
    uid: key,
    siteId: "a",
    siteLabel: "A",
    key,
    summary: key,
    issueType: epicKey === key ? "Epic" : "Story",
    statusName: "To Do",
    statusCategory: "todo",
    url: "",
    ghost: false,
    ...(epicKey ? { epic: { uid: epicKey, key: epicKey, url: "" } } : {}),
  });
  // The epic's own schedule (a default-length bar at plan start) is not what its row draws.
  const ownSchedule: TimelineEntry = {
    projected: { start: "2026-09-01", end: "2026-09-03" },
    progress: { state: "not-started", forecast: { start: "2026-09-01", end: "2026-09-03" } },
    varianceDays: 0,
  };
  const epic = issue("E", "E");
  const nodes = [epic, issue("C1", "E"), issue("C2", "E"), issue("B"), issue("EMPTY", "EMPTY")];
  const timeline = new Map<string, TimelineEntry>([
    ["E", ownSchedule],
    ["EMPTY", ownSchedule],
    [
      "C1",
      {
        projected: { start: "2026-09-07", end: "2026-09-10" },
        progress: { state: "done", actual: { start: "2026-09-08", end: "2026-09-15" } },
        varianceDays: 3,
      },
    ],
    [
      "C2",
      {
        projected: { start: "2026-09-10", end: "2026-09-14" },
        progress: { state: "started", actualStart: "2026-09-16", forecast: { start: "2026-09-29", end: "2026-10-02" } },
        varianceDays: 12,
      },
    ],
    [
      "B",
      {
        projected: { start: "2026-09-14", end: "2026-09-16" },
        progress: { state: "not-started", forecast: { start: "2026-10-02", end: "2026-10-05" } },
        varianceDays: 13,
      },
    ],
  ]);
  const epics = summarizeEpics(nodes, timeline);
  const drawn = (n: GraphNode): ReturnType<typeof drawnBar> => drawnBar(n, getOrThrow(timeline, n.uid), epics.get(n.uid));
  const [b, empty] = [nodes[3], nodes[4]];

  it("leaves an epic from the end of its children's work, not the epic's own schedule", () => {
    expect(drawn(epic).positionless).toBe(false);
    expect(arrowAnchors(drawn(epic).entry, drawn(b).entry, null)).toEqual({ from: "2026-10-02", to: "2026-10-02", stub: null });
  });

  it("points into an epic at the start of its children's work", () => {
    expect(arrowAnchors(drawn(b).entry, drawn(epic).entry, null)).toEqual({ from: "2026-10-05", to: "2026-09-08", stub: null });
  });

  it("treats an epic with no loaded children as having no position, so its arrow is a stub", () => {
    expect(drawn(empty).positionless).toBe(true);
    expect(arrowAnchors(drawn(empty).entry, drawn(b).entry, "blocker")).toEqual({ from: "2026-10-02", to: "2026-10-02", stub: "from" });
  });
});
