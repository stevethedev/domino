import type { ReactElement } from "react";
import type { Day } from "../../graph/schedule";
import { LABEL_WIDTH, LANE_HEIGHT, laneStop, spanLabel, xOf, type Scale, type TimelineLaneModel } from "./timelineLayout";
import { Icon } from "../Icon";

/**
 * The keys a lane header takes, besides Enter/Space: ← folds an open lane, → unfolds a folded one.
 * Either one when the lane is already that way is still the header's ("stay"): left to the
 * browser, it would pan the chart sideways.
 */
export const laneKey = (key: string, collapsed: boolean): "fold" | "unfold" | "stay" | null => {
  if (key === "ArrowLeft") return collapsed ? "stay" : "fold";
  if (key === "ArrowRight") return collapsed ? "unfold" : "stay";
  return null;
};

/** A key press the timeline's Tab stop may move on (see `roveKey`). */
export type RoveEvent = Readonly<{ key: string; altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }>;

/** A swimlane header: a disclosure toggle for the lane's rows, its title (epic lanes link to Jira) and counts. */
export function TimelineLane({
  item,
  onToggle,
  onOpen,
  onRove,
  onFocusItem,
  tabbable,
  rangeStart,
  scale,
}: {
  item: TimelineLaneModel;
  onToggle: () => void;
  onOpen: (url: string) => void;
  /** ↑ ↓ Home End PgUp PgDn: move the timeline's Tab stop from this header; true when it moved. */
  onRove: (id: string, e: RoveEvent) => boolean;
  /** Focus landed here: it's the timeline's Tab stop now. */
  onFocusItem: (id: string) => void;
  /** Whether this header is the timeline's one Tab stop. */
  tabbable: boolean;
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
          tabIndex={tabbable ? 0 : -1}
          aria-expanded={!collapsed}
          aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Home End PageUp PageDown"
          data-tl-lane={lane.id}
          onClick={onToggle}
          onFocus={() => {
            onFocusItem(laneStop(lane.id));
          }}
          onKeyDown={(e) => {
            // ⌘/Ctrl+Enter opens an epic lane's epic, as on a row (its Jira button isn't a Tab stop).
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && url) {
              e.preventDefault();
              onOpen(url);
              return;
            }
            const action = e.altKey || e.metaKey || e.ctrlKey || e.shiftKey ? null : laneKey(e.key, collapsed);
            if (action) {
              e.preventDefault();
              if (action !== "stay") onToggle();
              return;
            }
            if (onRove(laneStop(lane.id), e)) e.preventDefault();
          }}
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
            // Reached by ⌘/Ctrl+Enter on the header instead, so it isn't a Tab stop of its own.
            tabIndex={-1}
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
