import type { ReactElement } from "react";
import { LANE_HEIGHT, type TimelineLaneModel } from "./timelineLayout";
import { Icon } from "../Icon";

/** A swimlane header: a disclosure toggle for the lane's rows, its title (epic lanes link to Jira) and counts. */
export function TimelineLane({
  item,
  onToggle,
  onOpen,
}: {
  item: TimelineLaneModel;
  onToggle: () => void;
  onOpen: (url: string) => void;
}): ReactElement {
  const { lane, count, collapsed, late } = item;
  const url = lane.url;
  const counts = `${count} ${count === 1 ? "issue" : "issues"}${late ? `, ${late} late` : ""}`;
  return (
    <div className={`tl-lane${collapsed ? " collapsed" : ""}`} style={{ top: item.y, height: LANE_HEIGHT }}>
      <div className="tl-lane-title">
        <button
          type="button"
          className="tl-lane-toggle"
          aria-expanded={!collapsed}
          onClick={onToggle}
          aria-label={`${lane.label}, ${counts}`}
          title={collapsed ? "Show issues" : "Hide issues"}
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
          · {count} {count === 1 ? "issue" : "issues"}
          {late > 0 && <span className="tl-lane-late"> · {late} late</span>}
        </span>
      </div>
    </div>
  );
}
