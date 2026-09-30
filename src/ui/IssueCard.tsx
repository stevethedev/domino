import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { memo } from "react";
import type { GraphNode, StatusCategory } from "../graph/types";

export type IssueNodeData = {
  node: GraphNode;
  openBlockers: number;
  showSite: boolean;
  dimmed: boolean;
  highlight: "critical" | "ready" | "both" | null;
  onOpen: (url: string) => void;
  onHover: (uid: string | null) => void;
};
export type IssueFlowNode = Node<IssueNodeData, "issue">;

const STATUS_LABEL: Record<StatusCategory, string> = {
  todo: "To Do",
  inprogress: "In Progress",
  done: "Done",
  unknown: "Unknown",
};

const TYPE_GLYPH: Record<string, string> = { Epic: "E", Story: "S", Task: "T", Bug: "B", "Sub-task": "s", Subtask: "s" };

function firstName(name?: string) {
  return name?.split(/\s+/)[0] ?? "Unassigned";
}

function initials(name?: string) {
  if (!name) return "?";
  const parts = name.split(/\s+/).filter(Boolean);
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

export const IssueCard = memo(function IssueCard({ data }: NodeProps<IssueFlowNode>) {
  const { node: n, openBlockers, showSite, dimmed, highlight, onOpen, onHover } = data;
  const status = n.statusCategory;
  const label = [
    n.key,
    n.summary,
    `status ${n.statusName}`,
    showSite || n.ghost ? `site ${n.siteLabel}` : null,
    openBlockers ? `${openBlockers} open blocker${openBlockers === 1 ? "" : "s"}` : null,
    n.ghost ? "outside scope" : null,
    highlight === "critical" || highlight === "both" ? "on critical path" : null,
    highlight === "ready" || highlight === "both" ? "ready to start" : null,
  ]
    .filter(Boolean)
    .join(", ");
  const glyph = TYPE_GLYPH[n.issueType] ?? n.issueType[0]?.toUpperCase() ?? "?";

  return (
    <div
      className={`card status-${status}${n.ghost ? " ghost" : ""}${dimmed ? " dimmed" : ""}${highlight ? ` hl-${highlight}` : ""}`}
      role="link"
      tabIndex={0}
      aria-label={`${label}. Opens in browser.`}
      data-uid={n.uid}
      onClick={() => onOpen(n.url)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(n.url);
        }
      }}
      onMouseEnter={() => onHover(n.uid)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(n.uid)}
      onBlur={() => onHover(null)}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <div className="card-row1">
        <span className={`type-icon type-${n.issueType.toLowerCase()}`} title={n.issueType} aria-hidden="true">
          {glyph}
        </span>
        <span className="card-key">{n.key}</span>
        <span className={`pill pill-${status}`}>{n.ghost && status === "unknown" ? "Unknown" : n.statusName || STATUS_LABEL[status]}</span>
        {(showSite || n.ghost) && (
          <span className="site-badge" style={{ "--site": n.siteColor ?? "#6b7280" }} title={`Site: ${n.siteLabel}`}>
            {n.siteLabel}
          </span>
        )}
      </div>
      <div className="card-summary" title={n.summary}>
        {n.summary}
      </div>
      <div className="card-row3">
        {n.ghost ? (
          <span className="outside">Outside scope</span>
        ) : (
          <>
            <span className="assignee">
              {n.assigneeAvatarUrl ? (
                <img className="avatar" src={n.assigneeAvatarUrl} alt="" width={20} height={20} />
              ) : (
                <span className="avatar" aria-hidden="true">
                  {initials(n.assigneeName)}
                </span>
              )}
              {firstName(n.assigneeName)}
            </span>
            {n.storyPoints !== undefined && <span className="points">{n.storyPoints} pts</span>}
          </>
        )}
        {openBlockers > 0 && (
          <span className="blockers" title={`${openBlockers} open blocker${openBlockers === 1 ? "" : "s"}`}>
            ⚠ {openBlockers} blocker{openBlockers === 1 ? "" : "s"}
          </span>
        )}
        {(highlight === "ready" || highlight === "both") && <span className="tag-ready">Ready</span>}
      </div>
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  );
});

export type SiteGroupData = { label: string; color?: string; url?: string; onOpen: (url: string) => void };
export type SiteGroupNode = Node<SiteGroupData, "siteGroup">;

export const SiteGroup = memo(function SiteGroup({ data }: NodeProps<SiteGroupNode>) {
  return (
    <div className="site-group" style={{ "--site": data.color ?? "#6b7280" }}>
      {data.url ? (
        <button
          type="button"
          className="site-group-label lane-link"
          onClick={() => data.onOpen(data.url!)}
          title="Open epic in Jira"
          aria-label={`Epic ${data.label}. Opens in browser.`}
        >
          {data.label} ↗
        </button>
      ) : (
        <div className="site-group-label">{data.label}</div>
      )}
    </div>
  );
});
