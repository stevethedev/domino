import { memo, type ReactElement } from "react";
import { fmtDay } from "../format";
import { MOVE_KEYS, type Move, type PreviewKey } from "../../graph/traverse";
import { addDays, maxDay, type Day, type Span } from "../../graph/schedule";
import type { GraphNode } from "../../graph/types";
import type { Aging } from "../../graph/aging";
import { CHANGE_LABEL, type ChangeKind } from "../../graph/changes";
import { AgingBadge, agingDescription, CappedBadges, ChangeTag, ISSUE_DETAIL_ID, TraverseHint, TypeIcon } from "../IssueCard";
import {
  BADGE_ROOM,
  entryEnd,
  PX_PER_DAY,
  varianceLabel,
  xOf,
  type EpicSummary,
  type Scale,
  type TimelineRowModel,
} from "./timelineLayout";

/** Spans are half-open; people read the last day inclusively. */
const spanText = (s: Span): string => `${fmtDay(s.start)} – ${fmtDay(addDays(s.end, -1))}`;

export type RowFlags = {
  dimmed: boolean;
  critical: boolean;
  ready: boolean;
  aging?: Aging;
  change?: ChangeKind;
  /** Set while the focused row's ← (upstream) or → (downstream) would come here. */
  preview?: PreviewKey;
  /** Releases this issue is forecast to finish after. */
  missedReleases?: readonly string[];
  /** Another scope is loading: the row is out of reach (see the faded view in App). */
  stale?: boolean;
};

/** What the variance badge measures, since it isn't the due date. */
const VARIANCE_HINT =
  "Forecast finish against the estimate (story points × Days / point, from when it started or could start), in working days. Due dates are the ◆.";

const missesText = (names: readonly string[]): string =>
  `forecast to miss ${names.length === 1 ? "release" : "releases"} ${names.join(", ")}`;

function describe(node: GraphNode, row: TimelineRowModel): string {
  const p = row.entry.progress;
  const parts = [`${node.key}, ${node.summary}`, `status ${node.statusName}`, `projected ${spanText(row.entry.projected)}`];
  if (p.state === "done")
    parts.push(p.startUnknown ? `resolved ${fmtDay(p.actual.start)}, start date unknown` : `actual ${spanText(p.actual)}`);
  if (p.state === "started") parts.push(`started ${fmtDay(p.actualStart)}, forecast finish ${fmtDay(addDays(p.forecast.end, -1))}`);
  if (p.state === "not-started") parts.push(`not started, forecast ${spanText(p.forecast)}`);
  if (p.state === "unknown") parts.push("start date unknown");
  if (node.dates?.due) parts.push(`due ${fmtDay(node.dates.due)}`);
  if (p.state !== "unknown" && !(p.state === "done" && p.startUnknown)) parts.push(varianceLabel(row.entry.varianceDays));
  if (node.ghost) parts.push("outside scope");
  return `${parts.join(", ")}. Shows details.`;
}

function describeEpic(node: GraphNode, epic: EpicSummary | "empty"): string {
  if (epic === "empty") return `Epic ${node.key}, ${node.summary}, no child issues in scope. Shows details.`;
  return `Epic ${node.key}, ${node.summary}, ${epic.children} issues, projected ${spanText(epic.projected)}, work ${spanText(epic.work)}. Shows details.`;
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
  selected,
  onSelect,
  onOpen,
  onHover,
  onTraverse,
}: {
  row: TimelineRowModel;
  /** Set for epics: a summary over their loaded children, or "empty" when none are loaded. */
  epic?: EpicSummary | "empty";
  rangeStart: Day;
  scale: Scale;
  today: Day;
  flags: RowFlags;
  /** Whether this row's issue is open in the details panel. */
  selected: boolean;
  /** Click / Enter: show details. */
  onSelect: (uid: string) => void;
  /** ⌘/Ctrl+click: open in Jira directly. */
  onOpen: (url: string) => void;
  onHover: (uid: string | null) => void;
  /** Arrow keys: follow links to the next row; true when it moved. */
  onTraverse: (uid: string, move: Move) => boolean;
}) {
  const { node, entry } = row;
  const p = entry.progress;
  const finish = p.state === "done" ? p.actual.end : p.forecast.end;
  const due = node.dates?.due;
  const pastDue = due !== undefined && finish > addDays(due, 1);
  const late = entry.varianceDays > 0;
  // Beside the bar, unless the due ◆ sits where the badge would go: then just past the ◆, so the
  // badge never covers the due date (and doesn't drift far from its bar for a distant one).
  const barEndX = xOf(rangeStart, entryEnd(entry), scale);
  const dueEndX = due === undefined ? undefined : xOf(rangeStart, addDays(due, 1), scale);
  const badgeLeft = (dueEndX !== undefined && dueEndX > barEndX && dueEndX - barEndX < BADGE_ROOM ? dueEndX : barEndX) + 6;

  return (
    <div
      className={`tl-row status-${node.statusCategory}${node.ghost ? " ghost" : ""}${flags.dimmed ? " dimmed" : ""}${flags.critical ? " critical" : ""}${row.folded ? " folded" : ""}${selected ? " selected" : ""}${flags.preview ? " traverse-target" : ""}`}
      style={{ top: row.y }}
      role="button"
      aria-expanded={selected}
      aria-controls={selected ? ISSUE_DETAIL_ID : undefined}
      // A folded row (collapsed lane) is only kept for the fold animation: out of reach until shown.
      tabIndex={row.folded || flags.stale ? -1 : 0}
      aria-hidden={row.folded || undefined}
      aria-label={
        epic
          ? describeEpic(node, epic)
          : `${describe(node, row)}${flags.missedReleases ? ` ${missesText(flags.missedReleases)}.` : ""}${flags.aging ? ` ${agingDescription(flags.aging)}.` : ""}`
      }
      aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown"
      data-tl-uid={node.uid}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey) onOpen(node.url);
        else onSelect(node.uid);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          if (e.metaKey || e.ctrlKey) onOpen(node.url);
          else onSelect(node.uid);
          return;
        }
        const move = MOVE_KEYS[e.key];
        if (move && !e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey && onTraverse(node.uid, move)) e.preventDefault();
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
      {/* Two lines, like the cards: key and summary on top, status and badges below, so a busy row
          never pushes its badges into the chart or squeezes the summary away. */}
      <div className="tl-label">
        <TypeIcon type={node.issueType} />
        <div className="tl-label-text">
          <div className="tl-label-title">
            <span className="card-key">{node.key}</span>
            <span className="tl-summary" title={node.summary}>
              {node.summary}
            </span>
          </div>
          <div className="tl-label-badges">
            <span className={`pill pill-${node.statusCategory}`}>{node.statusName}</span>
            <CappedBadges
              badges={[
                flags.missedReleases && {
                  key: "release",
                  label: missesText(flags.missedReleases),
                  el: (
                    <span className="tag-risk" title={missesText(flags.missedReleases)}>
                      Misses {flags.missedReleases[0]}
                      {flags.missedReleases.length > 1 && ` +${flags.missedReleases.length - 1}`}
                    </span>
                  ),
                },
                flags.ready && { key: "ready", label: "Ready", el: <span className="tag-ready">Ready</span> },
                flags.aging && { key: "aging", label: agingDescription(flags.aging), el: <AgingBadge aging={flags.aging} /> },
                flags.change && { key: "change", label: CHANGE_LABEL[flags.change], el: <ChangeTag change={flags.change} /> },
              ]}
            />
          </div>
        </div>
        <TraverseHint direction={flags.preview ?? "activate"} />
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
              title={`Due ${fmtDay(due)}${pastDue ? " (forecast misses it)" : ""}`}
            >
              ◆
            </span>
          )}
          {!node.ghost && p.state !== "unknown" && (
            <span
              className={`tl-variance${late ? " late" : entry.varianceDays < 0 ? " early" : ""}`}
              style={{ left: badgeLeft }}
              title={VARIANCE_HINT}
            >
              {p.state === "done"
                ? p.startUnknown
                  ? "done, start unknown"
                  : `done, ${varianceLabel(entry.varianceDays)}`
                : varianceLabel(entry.varianceDays)}
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
