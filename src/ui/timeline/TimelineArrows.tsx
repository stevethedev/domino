import { memo } from "react";
import type { Day, TimelineEntry } from "../../graph/schedule";
import type { GraphEdge } from "../../graph/types";
import { ROW_HEIGHT, workSpan, xOf, type Scale } from "./timelineLayout";

const ELBOW_PX = 3;
const STUB_PX = 22;

export type ArrowModel = {
  edge: GraphEdge;
  /** Days the arrow leaves from and points at, and which end (if any) is a ghost stub (see arrowAnchors). */
  from: Day;
  to: Day;
  stub: "from" | "to" | null;
  violated: boolean;
  inCycle: boolean;
  critical: boolean;
  dimmed: boolean;
};

/**
 * Finish-to-start anchors on the bars the rows actually draw: from the end of the blocker's work
 * bar to the start of the blocked issue's work bar. For unstarted work the two meet exactly,
 * since a dependent's forecast starts when its blocker's forecast ends. Ghost rows have no
 * loaded dates, so an arrow touching one is a short stub at the known end (`stub` says which
 * side is the ghost) rather than a line to an invented position.
 */
export function arrowAnchors(
  blocker: TimelineEntry,
  blocked: TimelineEntry,
  /** Which end has no drawn position (an arrow between two such ends isn't drawn at all). */
  ghostEnd: "blocker" | "blocked" | null,
): { from: Day; to: Day; stub: "from" | "to" | null } {
  if (ghostEnd === "blocker") {
    const to = workSpan(blocked).start;
    return { from: to, to, stub: "from" };
  }
  if (ghostEnd === "blocked") {
    const from = workSpan(blocker).end;
    return { from, to: from, stub: "to" };
  }
  return { from: workSpan(blocker).end, to: workSpan(blocked).start, stub: null };
}

/** True when the blocked issue started before its blocker finished. */
export function isViolated(blocker: TimelineEntry, blocked: TimelineEntry): boolean {
  const started = blocked.progress.state === "done" ? blocked.progress.actual.start : blocked.progress.state === "started" ? blocked.progress.actualStart : undefined;
  if (!started) return false;
  switch (blocker.progress.state) {
    case "done":
      return started < blocker.progress.actual.end;
    case "unknown":
      return false; // no real dates for the blocker: nothing to compare
    default:
      return true; // the blocker is still open
  }
}

/** Finish-to-start elbow connectors between the anchors computed by arrowAnchors. */
export const TimelineArrows = memo(function TimelineArrows({
  arrows,
  rowY,
  rangeStart,
  scale,
  width,
  height,
}: {
  arrows: readonly ArrowModel[];
  rowY: ReadonlyMap<string, number>;
  rangeStart: Day;
  scale: Scale;
  width: number;
  height: number;
}) {
  return (
    <svg className="tl-arrows" width={width} height={height} aria-hidden="true">
      <defs>
        {["edge", "violated", "critical"].map((k) => (
          <marker key={k} id={`tl-arrow-${k}`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L8,4 L0,8 z" className={`tl-arrowhead ${k}`} />
          </marker>
        ))}
      </defs>
      {arrows.map(({ edge, from, to, stub, violated, inCycle, critical, dimmed }) => {
        const y1 = rowY.get(edge.source);
        const y2 = rowY.get(edge.target);
        if (y1 === undefined || y2 === undefined) return null;
        // Ghost stubs: a short lead-in (or lead-out) instead of a line to an invented date.
        const x1 = xOf(rangeStart, from, scale) - (stub === "from" ? STUB_PX : 0);
        const x2 = xOf(rangeStart, to, scale) + (stub === "to" ? STUB_PX : 0);
        const [ya, yb] = [y1 + ROW_HEIGHT / 2, y2 + ROW_HEIGHT / 2];
        // Turn ELBOW_PX after the bar, before the variance badge that sits 6px past it.
        const d =
          x2 >= x1 + 2 * ELBOW_PX
            ? `M${x1},${ya} H${x1 + ELBOW_PX} V${yb} H${x2}`
            : `M${x1},${ya} h${ELBOW_PX} V${(ya + yb) / 2} H${x2 - 2 * ELBOW_PX} V${yb} H${x2}`; // route around when the target starts earlier
        const kind = violated || inCycle ? "violated" : critical ? "critical" : "edge";
        return (
          <path
            key={edge.id}
            d={d}
            className={`tl-arrow ${kind}${dimmed ? " dimmed" : ""}${edge.crossSite ? " cross-site" : ""}${stub ? " stub" : ""}`}
            markerEnd={`url(#tl-arrow-${kind})`}
          />
        );
      })}
    </svg>
  );
});
