import { memo, type ReactElement } from "react";
import { addDays, maxDay, type Day, type Span } from "../../graph/schedule";
import type { GraphNode } from "../../graph/types";
import type { Aging } from "../../graph/aging";
import type { ChangeKind } from "../../graph/changes";
import { AgingBadge, agingDescription, ChangeTag, TypeIcon } from "../IssueCard";
import { entryEnd, PX_PER_DAY, varianceLabel, xOf, type EpicSummary, type Scale, type TimelineRowModel } from "./timelineLayout";

const fmt = (d: Day): string =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
/** Spans are half-open; people read the last day inclusively. */
const spanText = (s: Span): string => `${fmt(s.start)} – ${fmt(addDays(s.end, -1))}`;

export type RowFlags = { dimmed: boolean; critical: boolean; ready: boolean; aging?: Aging; change?: ChangeKind };

function describe(node: GraphNode, row: TimelineRowModel): string {
  const p = row.entry.progress;
  const parts = [`${node.key}, ${node.summary}`, `status ${node.statusName}`, `projected ${spanText(row.entry.projected)}`];
  if (p.state === "done") parts.push(`actual ${spanText(p.actual)}`);
  if (p.state === "started") parts.push(`started ${fmt(p.actualStart)}, forecast finish ${fmt(addDays(p.forecast.end, -1))}`);
  if (p.state === "not-started") parts.push(`not started, forecast ${spanText(p.forecast)}`);
  if (p.state === "unknown") parts.push("start date unknown");
  if (node.dates?.due) parts.push(`due ${fmt(node.dates.due)}`);
  if (p.state !== "unknown") parts.push(varianceLabel(row.entry.varianceDays));
  if (node.ghost) parts.push("outside scope");
  return `${parts.join(", ")}. Opens in browser.`;
}

function describeEpic(node: GraphNode, epic: EpicSummary | "empty"): string {
  if (epic === "empty") return `Epic ${node.key}, ${node.summary}, no child issues in scope. Opens in browser.`;
  return `Epic ${node.key}, ${node.summary}, ${epic.children} issues, projected ${spanText(epic.projected)}, work ${spanText(epic.work)}. Opens in browser.`;
}

function Bar({ span, start, scale, className }: { span: Span; start: Day; scale: Scale; className: string }): ReactElement {
  const left = xOf(start, span.start, scale);
  const width = Math.max(xOf(start, span.end, scale) - left, PX_PER_DAY[scale] / 2);
  return <div className={className} style={{ left, width }} />;
}

export const TimelineRow = memo(function TimelineRow({
  row,
  epic,
  rangeStart,
  scale,
  today,
  flags,
  onOpen,
  onHover,
}: {
  row: TimelineRowModel;
  /** Set for epics: a summary over their loaded children, or "empty" when none are loaded. */
  epic?: EpicSummary | "empty";
  rangeStart: Day;
  scale: Scale;
  today: Day;
  flags: RowFlags;
  onOpen: (url: string) => void;
  onHover: (uid: string | null) => void;
}) {
  const { node, entry } = row;
  const p = entry.progress;
  const finish = p.state === "done" ? p.actual.end : p.forecast.end;
  const due = node.dates?.due;
  const pastDue = due !== undefined && finish > addDays(due, 1);
  const late = entry.varianceDays > 0;
  const badgeLeft = xOf(rangeStart, entryEnd(entry), scale) + 6;

  return (
    <div
      className={`tl-row status-${node.statusCategory}${node.ghost ? " ghost" : ""}${flags.dimmed ? " dimmed" : ""}${flags.critical ? " critical" : ""}${row.folded ? " folded" : ""}`}
      style={{ top: row.y }}
      role="link"
      // A folded row (collapsed lane) is only kept for the fold animation: out of reach until shown.
      tabIndex={row.folded ? -1 : 0}
      aria-hidden={row.folded || undefined}
      aria-label={epic ? describeEpic(node, epic) : `${describe(node, row)}${flags.aging ? ` ${agingDescription(flags.aging)}.` : ""}`}
      data-tl-uid={node.uid}
      onClick={() => {
        onOpen(node.url);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(node.url);
        }
      }}
      onMouseEnter={() => {
        onHover(node.uid);
      }}
      onMouseLeave={() => {
        onHover(null);
      }}
      onFocus={() => {
        onHover(node.uid);
      }}
      onBlur={() => {
        onHover(null);
      }}
    >
      <div className="tl-label">
        <TypeIcon type={node.issueType} />
        <span className="card-key">{node.key}</span>
        <span className="tl-summary" title={node.summary}>
          {node.summary}
        </span>
        <span className={`pill pill-${node.statusCategory}`}>{node.statusName}</span>
        {flags.ready && <span className="tag-ready">Ready</span>}
        {flags.aging && <AgingBadge aging={flags.aging} />}
        {flags.change && <ChangeTag change={flags.change} />}
      </div>
      {epic ? (
        <div className="tl-track">
          {epic === "empty" ? (
            <span className="tl-variance" style={{ left: 8 }}>
              no child issues in scope
            </span>
          ) : (
            <>
              <Bar span={epic.projected} start={rangeStart} scale={scale} className="tl-bar tl-epic-projected" />
              <Bar span={epic.work} start={rangeStart} scale={scale} className="tl-bar tl-epic-work" />
              <span className="tl-variance" style={{ left: xOf(rangeStart, maxDay(epic.projected.end, epic.work.end), scale) + 6 }}>
                {epic.children} {epic.children === 1 ? "issue" : "issues"}
              </span>
            </>
          )}
        </div>
      ) : (
        <div className="tl-track">
          {node.ghost ? (
            <span className="tl-ghost-note">Outside scope · dates not loaded</span>
          ) : (
            <Bar span={entry.projected} start={rangeStart} scale={scale} className="tl-bar tl-projected" />
          )}
          {p.state === "done" && <Bar span={p.actual} start={rangeStart} scale={scale} className="tl-bar tl-actual" />}
          {p.state === "started" && (
            <>
              <Bar
                span={{ start: p.actualStart, end: maxEnd(p.actualStart, today) }}
                start={rangeStart}
                scale={scale}
                className="tl-bar tl-actual"
              />
              <Bar span={p.forecast} start={rangeStart} scale={scale} className="tl-bar tl-forecast" />
            </>
          )}
          {(p.state === "not-started" || p.state === "unknown") && !node.ghost && (
            <Bar span={p.forecast} start={rangeStart} scale={scale} className="tl-bar tl-forecast" />
          )}
          {due && (
            <span
              className={`tl-due${pastDue ? " past" : ""}`}
              style={{ left: xOf(rangeStart, due, scale) + PX_PER_DAY[scale] / 2 }}
              title={`Due ${fmt(due)}${pastDue ? " (forecast misses it)" : ""}`}
            >
              ◆
            </span>
          )}
          {!node.ghost && p.state !== "unknown" && (
            <span className={`tl-variance${late ? " late" : entry.varianceDays < 0 ? " early" : ""}`} style={{ left: badgeLeft }}>
              {p.state === "done" ? `done, ${varianceLabel(entry.varianceDays)}` : varianceLabel(entry.varianceDays)}
            </span>
          )}
          {p.state === "unknown" && !node.ghost && (
            <span className="tl-variance" style={{ left: badgeLeft }}>
              start unknown
            </span>
          )}
        </div>
      )}
    </div>
  );
});

/** The actual bar for a started issue runs through today (at least one day). */
const maxEnd = (start: Day, today: Day): Day => (addDays(today, 1) > start ? addDays(today, 1) : addDays(start, 1));
