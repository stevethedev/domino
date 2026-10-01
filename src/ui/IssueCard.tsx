import { Handle, Position, useStore, type Node, type NodeProps } from "@xyflow/react";
import { memo } from "react";
import { agingLabel, type Aging } from "../graph/aging";
import type { Highlight } from "../graph/insights";
import type { GraphNode, StatusCategory } from "../graph/types";

export type IssueNodeData = {
  node: GraphNode;
  openBlockers: number;
  showSite: boolean;
  dimmed: boolean;
  highlight: Exclude<Highlight, "none"> | null;
  aging?: Aging;
  onOpen: (url: string) => void;
  onHover: (uid: string | null) => void;
  /** Set on epic-map summary nodes: activating the card expands the epic instead of opening Jira. */
  onExpand?: () => void;
};
export type IssueFlowNode = Node<IssueNodeData, "issue">;

/** Below this zoom, card text is too small to read, so cards switch to a compact, high-contrast form. */
const COMPACT_BELOW_ZOOM = 0.6;

const STATUS_LABEL: Record<StatusCategory, string> = {
  todo: "To Do",
  inprogress: "In Progress",
  done: "Done",
  unknown: "Unknown",
};

const TYPE_GLYPH: Record<string, string> = { Epic: "E", Story: "S", Task: "T", Bug: "B", "Sub-task": "s", Subtask: "s" };

export function TypeIcon({ type }: { type: string }) {
  return (
    <span className={`type-icon type-${type.toLowerCase()}`} title={type} aria-hidden="true">
      {TYPE_GLYPH[type] ?? type[0]?.toUpperCase() ?? "?"}
    </span>
  );
}

function firstName(name?: string) {
  return name?.split(/\s+/)[0] ?? "Unassigned";
}

function initials(name?: string) {
  if (!name) return "?";
  const parts = name.split(/\s+/).filter(Boolean);
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

function rollupLabel(n: GraphNode): string {
  const r = n.rollup!;
  const parts = [`Epic ${n.key}, ${n.summary}`, `${r.members.length} issues`, `${r.done} done`];
  if (r.blocked) parts.push(`${r.blocked} blocked`);
  if (r.aging) parts.push(`${r.aging} aging`);
  return `${parts.join(", ")}. Expands the epic.`;
}

/** Epic-map summary card: progress across the epic's loaded issues. */
function RollupBody({ node, compact }: { node: GraphNode; compact: boolean }) {
  const r = node.rollup!;
  const total = r.members.length;
  return (
    <>
      <div className="card-row1">
        <TypeIcon type="Epic" />
        <span className="card-key">{node.key}</span>
        <span className={`pill pill-${node.statusCategory}`}>
          {r.done}/{total} done
        </span>
      </div>
      {!compact && (
        <div className="card-summary" title={node.summary}>
          {node.summary}
        </div>
      )}
      <div className="card-row3">
        <span className="rollup-bar" aria-hidden="true">
          <span style={{ width: `${total ? (100 * r.done) / total : 0}%` }} />
        </span>
        {r.blocked > 0 && <span className="blockers">⚠ {r.blocked} blocked</span>}
        {r.aging > 0 && <span className="age age-waiting">⏳ {r.aging}</span>}
        <span className="rollup-expand" aria-hidden="true">
          ⊕ {total}
        </span>
      </div>
    </>
  );
}

export function AgingBadge({ aging }: { aging: Aging }) {
  return (
    <span className={`age age-${aging.kind}`} title={agingDescription(aging)}>
      ⏳ {agingLabel(aging)}
    </span>
  );
}

export const agingDescription = (a: Aging) =>
  a.kind === "stuck"
    ? `stuck: in progress ${a.days} working days against a ${a.estimateDays}-day estimate`
    : `waiting: blocked with no status change for ${a.days} working days`;

const blockerText = (count: number) => `⚠ ${count} blocker${count === 1 ? "" : "s"}`;

/** Zoomed-out card: key, status and blockers only, large enough to read at a glance. */
function CompactBody({
  node,
  statusText,
  openBlockers,
  ready,
  aging,
}: {
  node: GraphNode;
  statusText: string;
  openBlockers: number;
  ready: boolean;
  aging?: Aging;
}) {
  return (
    <>
      <div className="card-row1">
        <TypeIcon type={node.issueType} />
        <span className="card-key">{node.key}</span>
      </div>
      <div className="card-row3">
        <span className={`pill pill-${node.statusCategory}`}>{statusText}</span>
        {openBlockers > 0 && <span className="blockers">{blockerText(openBlockers)}</span>}
        {ready && <span className="tag-ready">Ready</span>}
        {aging && <AgingBadge aging={aging} />}
      </div>
    </>
  );
}

export const IssueCard = memo(function IssueCard({ data }: NodeProps<IssueFlowNode>) {
  const { node: n, openBlockers, showSite, dimmed, highlight, aging, onOpen, onHover, onExpand } = data;
  const activate = onExpand ?? (() => onOpen(n.url));
  // Selecting a boolean means cards re-render only when crossing the threshold, not on every zoom step.
  const compact = useStore((s) => s.transform[2] < COMPACT_BELOW_ZOOM);
  const status = n.statusCategory;
  const statusText = n.ghost && status === "unknown" ? "Unknown" : n.statusName || STATUS_LABEL[status];
  const label = [
    n.key,
    n.summary,
    `status ${n.statusName}`,
    showSite || n.ghost ? `site ${n.siteLabel}` : null,
    openBlockers ? `${openBlockers} open blocker${openBlockers === 1 ? "" : "s"}` : null,
    n.ghost ? "outside scope" : null,
    highlight === "critical" ? "on critical path" : null,
    highlight === "ready" ? "ready to start" : null,
    aging ? agingDescription(aging) : null,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <div
      className={`card status-${status}${n.ghost ? " ghost" : ""}${dimmed ? " dimmed" : ""}${highlight ? ` hl-${highlight}` : ""}${compact ? " compact" : ""}`}
      role={onExpand ? "button" : "link"}
      tabIndex={0}
      aria-label={n.rollup ? rollupLabel(n) : `${label}. Opens in browser.`}
      data-uid={n.uid}
      onClick={activate}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          activate();
        }
      }}
      onMouseEnter={() => onHover(n.uid)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(n.uid)}
      onBlur={() => onHover(null)}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} />
      {n.rollup ? (
        <RollupBody node={n} compact={compact} />
      ) : compact ? <CompactBody node={n} statusText={statusText} openBlockers={openBlockers} ready={highlight === "ready"} aging={aging} /> : (
        <>
      <div className="card-row1">
        <TypeIcon type={n.issueType} />
        <span className="card-key">{n.key}</span>
        <span className={`pill pill-${status}`}>{statusText}</span>
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
            {blockerText(openBlockers)}
          </span>
        )}
        {highlight === "ready" && <span className="tag-ready">Ready</span>}
        {aging && <AgingBadge aging={aging} />}
      </div>
        </>
      )}
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  );
});

export type SiteGroupData = { label: string; color?: string; url?: string; onOpen: (url: string) => void; onCollapse?: () => void };
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
      {data.onCollapse && (
        <button type="button" className="lane-collapse" onClick={data.onCollapse} aria-label={`Collapse ${data.label}`}>
          ⊖ Collapse
        </button>
      )}
    </div>
  );
});
