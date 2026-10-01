import { describe, expect, it } from "vitest";
import type { TimelineEntry } from "../../../graph/schedule";
import { isViolated } from "../TimelineArrows";

const span = { start: "2026-10-05", end: "2026-10-07" };
const started: TimelineEntry = { projected: span, progress: { state: "started", actualStart: "2026-10-05", forecast: span }, varianceDays: 0 };

describe("isViolated", () => {
  it("is not a violation when the blocker's real dates are unknown", () => {
    const unknownBlocker: TimelineEntry = { projected: span, progress: { state: "unknown", forecast: span }, varianceDays: 0 };
    expect(isViolated(unknownBlocker, started)).toBe(false);
  });

  it("is a violation when work started before an open blocker finished", () => {
    const openBlocker: TimelineEntry = { projected: span, progress: { state: "not-started", forecast: span }, varianceDays: 0 };
    expect(isViolated(openBlocker, started)).toBe(true);
  });
});

import { arrowAnchors } from "../TimelineArrows";

describe("arrowAnchors", () => {
  const projected = { start: "2026-09-07", end: "2026-09-10" };

  it("leaves from the end of the bar you see (forecast/actual), not the projected outline", () => {
    const blocker: TimelineEntry = { projected, progress: { state: "started", actualStart: "2026-09-07", forecast: { start: "2026-10-01", end: "2026-10-03" } }, varianceDays: 15 };
    const blocked: TimelineEntry = { projected: { start: "2026-09-10", end: "2026-09-12" }, progress: { state: "not-started", forecast: { start: "2026-10-03", end: "2026-10-06" } }, varianceDays: 15 };
    // Finish-to-start: the dependent's forecast starts exactly where the blocker's forecast ends.
    expect(arrowAnchors(blocker, blocked, null)).toEqual({ from: "2026-10-03", to: "2026-10-03", stub: null });
  });

  it("uses actual dates for done and started work", () => {
    const done: TimelineEntry = { projected, progress: { state: "done", actual: { start: "2026-09-08", end: "2026-09-15" } }, varianceDays: 3 };
    const started: TimelineEntry = { projected, progress: { state: "started", actualStart: "2026-09-16", forecast: { start: "2026-10-01", end: "2026-10-02" } }, varianceDays: 0 };
    expect(arrowAnchors(done, started, null)).toEqual({ from: "2026-09-15", to: "2026-09-16", stub: null });
  });

  it("uses a short stub at the known end when one side is a ghost (its dates aren't loaded)", () => {
    const ghost: TimelineEntry = { projected, progress: { state: "unknown", forecast: { start: "2026-10-01", end: "2026-10-03" } }, varianceDays: 0 };
    const started: TimelineEntry = { projected, progress: { state: "started", actualStart: "2026-09-16", forecast: { start: "2026-10-01", end: "2026-10-02" } }, varianceDays: 0 };
    expect(arrowAnchors(ghost, started, "blocker")).toEqual({ from: "2026-09-16", to: "2026-09-16", stub: "from" });
    expect(arrowAnchors(started, ghost, "blocked")).toEqual({ from: "2026-10-02", to: "2026-10-02", stub: "to" });
  });
});
