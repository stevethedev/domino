import type { ReactElement } from "react";
import type { Day } from "../../graph/schedule";
import { LABEL_WIDTH, LANE_HEIGHT, spanLabel, xOf, type Scale, type TimelineLaneModel } from "./timelineLayout";
import { Icon } from "../Icon";

/** A swimlane header: a disclosure toggle for the lane's rows, its title (epic lanes link to Jira) and counts. */
export function TimelineLane({
  item,
  onToggle,
  onOpen,
  rangeStart,
  scale,
}: {
  item: TimelineLaneModel;
  onToggle: () => void;
  onOpen: (url: string) => void;
  /** The chart's first day and scale, for a folded lane's summary bar (none before there's a range). */
  rangeStart: Day | null;
  scale: Scale;
}): ReactElement {
  const { lane, count, collapsed, late, span } = item;
  const url = lane.url;
  const counts = `${count} ${count === 1 ? "ticket" : "tickets"}${late ? `, ${late} over estimate` : ""}`;
  return (
    <div className={`tl-lane${collapsed ? " collapsed" : ""}`} style={{ top: item.y, height: LANE_HEIGHT }}>
      <div className="tl-lane-title">
        <button
          type="button"
          className="tl-lane-toggle"
          aria-expanded={!collapsed}
          onClick={onToggle}
          // Folded, the summary bar's dates are said here too (the bar itself is decorative).
          aria-label={`${lane.label}, ${counts}${collapsed && span ? `, ${spanLabel(span)}` : ""}`}
          title={collapsed ? "Show tickets" : "Hide tickets"}
        >
          <span className="sb-chevron" aria-hidden="true" />
          {!url && <span className="tl-lane-name">{lane.label}</span>}
        </button>
        {url && (
          <button
            type="button"
            className="link-btn tl-lane-name"
            onClick={() => {
              onOpen(url);
            }}
            aria-label={`Epic ${lane.label}. Opens in browser.`}
          >
            {lane.label} <Icon name="external" />
          </button>
        )}
        <span className="muted small" aria-hidden="true">
          · {count} {count === 1 ? "ticket" : "tickets"}
          {late > 0 && <span className="tl-lane-late"> · {late} over estimate</span>}
        </span>
      </div>
      {/* Folded: its issues' work as one bar, so the lane still says when it happens. */}
      {collapsed && span && rangeStart && (
        <span
          className="tl-lane-span"
          style={{
            left: LABEL_WIDTH + xOf(rangeStart, span.start, scale),
            width: Math.max(4, xOf(span.start, span.end, scale)),
          }}
          title={`${lane.label}: ${spanLabel(span)}`}
          aria-hidden="true"
        />
      )}
    </div>
  );
}
