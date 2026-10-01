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
