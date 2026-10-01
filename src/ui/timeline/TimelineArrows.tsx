import { memo } from "react";
import type { Day, TimelineEntry } from "../../graph/schedule";
import type { GraphEdge } from "../../graph/types";
import { ROW_HEIGHT, xOf, type Scale } from "./timelineLayout";

export type ArrowModel = { edge: GraphEdge; violated: boolean; inCycle: boolean; critical: boolean; dimmed: boolean };

/** True when the blocked issue started before its blocker finished. */
export function isViolated(blocker: TimelineEntry, blocked: TimelineEntry): boolean {
  const started = blocked.progress.state === "done" ? blocked.progress.actual.start : blocked.progress.state === "started" ? blocked.progress.actualStart : undefined;
  if (!started) return false;
  return blocker.progress.state === "done" ? started < blocker.progress.actual.end : true;
}

/** Finish-to-start elbow connectors from blocker's projected end to blocked's projected start. */
export const TimelineArrows = memo(function TimelineArrows({
  arrows,
  rowY,
  timeline,
  rangeStart,
  scale,
  width,
  height,
}: {
  arrows: readonly ArrowModel[];
  rowY: ReadonlyMap<string, number>;
  timeline: ReadonlyMap<string, TimelineEntry>;
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
      {arrows.map(({ edge, violated, inCycle, critical, dimmed }) => {
        const y1 = rowY.get(edge.source);
        const y2 = rowY.get(edge.target);
        if (y1 === undefined || y2 === undefined) return null;
        const x1 = xOf(rangeStart, timeline.get(edge.source)!.projected.end, scale);
        const x2 = xOf(rangeStart, timeline.get(edge.target)!.projected.start, scale);
        const [ya, yb] = [y1 + ROW_HEIGHT / 2, y2 + ROW_HEIGHT / 2];
        const d =
          x2 >= x1 + 12
            ? `M${x1},${ya} H${x1 + 6} V${yb} H${x2}`
            : `M${x1},${ya} h6 V${(ya + yb) / 2} H${x2 - 6} V${yb} H${x2}`; // route around when the target starts earlier
        const kind = violated || inCycle ? "violated" : critical ? "critical" : "edge";
        return (
          <path
            key={edge.id}
            d={d}
            className={`tl-arrow ${kind}${dimmed ? " dimmed" : ""}${edge.crossSite ? " cross-site" : ""}`}
            markerEnd={`url(#tl-arrow-${kind})`}
          />
        );
      })}
    </svg>
  );
});
