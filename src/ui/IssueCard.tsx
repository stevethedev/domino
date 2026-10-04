import { Handle, Position, useStore, type Node, type NodeProps } from "@xyflow/react";
import { MOVE_KEYS, type Move, type PreviewKey } from "../graph/traverse";
import { memo, useState, type ReactElement } from "react";
import { agingLabel, type Aging } from "../graph/aging";
import { CHANGE_LABEL, type ChangeKind } from "../graph/changes";
import type { Highlight } from "../graph/insights";
import type { EpicRollup, GraphNode, Priority, StatusCategory } from "../graph/types";
import { Icon } from "./Icon";

export type IssueNodeData = {
  node: GraphNode;
  openBlockers: number;
  showSite: boolean;
  dimmed: boolean;
  highlight: Exclude<Highlight, "none"> | null;
  aging?: Aging;
  /** The most notable change since the scope was last marked seen. */
  change?: ChangeKind;
  /** Whether this card's issue is open in the details panel. */
  selected: boolean;
  /** Click / Enter: show the issue's details. */
  onSelect: (uid: string) => void;
  /** ⌘/Ctrl+click: open the issue in Jira directly. */
  onOpen: (url: string) => void;
  onHover: (uid: string | null) => void;
  /** Arrow keys: follow links to the next card; true when it moved. */
  onTraverse: (uid: string, move: Move) => boolean;
  /** Set while the focused card's ← (upstream) or → (downstream) would come here. */
  preview?: PreviewKey;
  /** Set on epic-map summary nodes: activating the card expands the epic instead. */
  onExpand?: () => void;
};
export type IssueFlowNode = Node<IssueNodeData, "issue">;

/** The details panel's id (src/ui/IssueDetail.tsx), for the controlling card or row's aria-controls. */
export const ISSUE_DETAIL_ID = "issue-detail";

/** Below this zoom, card text is too small to read, so cards switch to a compact, high-contrast form. */
export const COMPACT_BELOW_ZOOM = 0.6;

const STATUS_LABEL: Record<StatusCategory, string> = {
  todo: "To Do",
  inprogress: "In Progress",
  done: "Done",
  unknown: "Unknown",
};

const TYPE_GLYPH: Partial<Record<string, string>> = { Epic: "E", Story: "S", Task: "T", Bug: "B", "Sub-task": "s", Subtask: "s" };

export function TypeIcon({ type }: { type: string }): ReactElement {
  return (
    <span className={`type-icon type-${type.toLowerCase()}`} title={type} aria-hidden="true">
      {TYPE_GLYPH[type] ?? (type.charAt(0).toUpperCase() || "?")}
    </span>
  );
}

/** The site's own priority icon, or the name's first letter when there's no icon or it fails to load. */
export function PriorityIcon({ priority }: { priority: Priority }): ReactElement {
  // Remember which URL failed, so a different priority (or a fixed URL) after a refresh still gets tried.
  const [failedUrl, setFailedUrl] = useState<string>();
  const { iconUrl } = priority;
  const title = `Priority: ${priority.name}`;
  if (iconUrl && iconUrl !== failedUrl) {
    return (
      <img
        className="priority-icon"
        src={iconUrl}
        alt=""
        title={title}
        width={16}
        height={16}
        onError={() => {
          setFailedUrl(iconUrl);
        }}
      />
    );
  }
  return (
    <span className="priority-icon priority-letter" title={title} aria-hidden="true">
      {priority.name.charAt(0).toUpperCase()}
    </span>
  );
}

function firstName(name?: string): string {
  return name?.split(/\s+/)[0] ?? "Unassigned";
}

function initials(name?: string): string {
  if (!name) return "?";
  const parts = name.split(/\s+/).filter(Boolean);
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

function rollupLabel(n: GraphNode, r: EpicRollup): string {
  const parts = [`Epic ${n.key}, ${n.summary}`, `${r.members.length} issues`, `${r.done} done`];
  if (r.blocked) parts.push(`${r.blocked} blocked`);
  if (r.aging) parts.push(`${r.aging} aging`);
  return `${parts.join(", ")}. Expands the epic.`;
}

/** Epic-map summary card: progress across the epic's loaded issues. */
function RollupBody({ node, rollup: r, compact }: { node: GraphNode; rollup: EpicRollup; compact: boolean }): ReactElement {
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
        {r.blocked > 0 && (
          <span className="blockers">
            <Icon name="alert" /> {r.blocked} blocked
          </span>
        )}
        {r.aging > 0 && (
          <span className="age age-waiting">
            <Icon name="clock" /> {r.aging}
          </span>
        )}
        <span className="rollup-expand" aria-hidden="true">
          ⊕ {total}
        </span>
      </div>
    </>
  );
}

export type Badge = { key: string; label: string; el: React.ReactNode };

/**
 * Fits badges into `slots` (two by default, a card's bottom row). With more, it shows the first
 * `slots - 1` and a "+N" chip in the last slot whose tooltip lists the rest; the card or row's own
 * accessible name already covers every badge.
 */
export function CappedBadges({ badges, slots = 2 }: { badges: readonly (Badge | false | undefined)[]; slots?: number }): ReactElement {
  const all = badges.filter((b): b is Badge => !!b);
  const visible = all.length > slots ? slots - 1 : all.length;
  const extra = all.slice(visible);
  return (
    <>
      {all.slice(0, visible).map((b) => (
        <span key={b.key} className="badge-slot">
          {b.el}
        </span>
      ))}
      {extra.length > 0 && (
        <span className="chg badge-more" title={extra.map((b) => b.label).join("\n")}>
          +{extra.length}
        </span>
      )}
    </>
  );
}

export function ChangeTag({ change }: { change: ChangeKind }): ReactElement {
  return <span className={`chg chg-${change}`}>{CHANGE_LABEL[change]}</span>;
}

export function AgingBadge({ aging }: { aging: Aging }): ReactElement {
  return (
    <span className={`age age-${aging.kind}`} title={agingDescription(aging)}>
      <Icon name="clock" /> {agingLabel(aging)}
    </span>
  );
}

export const agingDescription = (a: Aging): string =>
  a.kind === "stuck"
    ? `stuck: in progress ${a.days} working days against a ${a.estimateDays}-day estimate`
    : `waiting: blocked with no status change for ${a.days} working days`;

const blockerText = (count: number): string => `${count} blocker${count === 1 ? "" : "s"}`;

function BlockersBadge({ count }: { count: number }): ReactElement {
  return (
    <span className="blockers" title={`${count} open blocker${count === 1 ? "" : "s"}`}>
      <Icon name="alert" /> {blockerText(count)}
    </span>
  );
}

/** Zoomed-out card: key, status and blockers only, large enough to read at a glance. */
function CompactBody({
  node,
  statusText,
  openBlockers,
  ready,
  aging,
  change,
}: {
  node: GraphNode;
  statusText: string;
  openBlockers: number;
  ready: boolean;
  aging?: Aging;
  change?: ChangeKind;
}): ReactElement {
  return (
    <>
      <div className="card-row1">
        <TypeIcon type={node.issueType} />
        <span className="card-key">{node.key}</span>
      </div>
      <div className="card-row3">
        <span className={`pill pill-${node.statusCategory}`}>{statusText}</span>
        {openBlockers > 0 && <BlockersBadge count={openBlockers} />}
        {ready && <span className="tag-ready">Ready</span>}
        {aging && <AgingBadge aging={aging} />}
        {change && <ChangeTag change={change} />}
      </div>
    </>
  );
}

const HINT_KEY: Record<PreviewKey | "activate", string> = { upstream: "←", downstream: "→", both: "↔", activate: "↵" };

/**
 * A key hint on a card or row: the arrow that would move focus here from the focused one, or
 * (`activate`, shown only while it has keyboard focus) Enter, which opens it.
 */
export function TraverseHint({ direction }: { direction: PreviewKey | "activate" }): ReactElement {
  return (
    <kbd className={`traverse-hint ${direction}`} aria-hidden="true">
      {HINT_KEY[direction]}
    </kbd>
  );
}

export const IssueCard = memo(function IssueCard({ data }: NodeProps<IssueFlowNode>): ReactElement {
  const {
    node: n,
    openBlockers,
    showSite,
    dimmed,
    highlight,
    aging,
    change,
    selected,
    onSelect,
    onOpen,
    onHover,
    onTraverse,
    preview,
    onExpand,
  } = data;
  const activate = (e: { metaKey: boolean; ctrlKey: boolean }): void => {
    if (onExpand) onExpand();
    else if (e.metaKey || e.ctrlKey) onOpen(n.url);
    else onSelect(n.uid);
  };
  // Selecting a boolean means cards re-render only when crossing the threshold, not on every zoom step.
  const compact = useStore((s) => s.transform[2] < COMPACT_BELOW_ZOOM);
  const status = n.statusCategory;
  const statusText = n.ghost && status === "unknown" ? "Unknown" : n.statusName || STATUS_LABEL[status];
  const label = [
    n.key,
    n.summary,
    `status ${n.statusName}`,
    n.priority ? `priority ${n.priority.name}` : null,
    showSite || n.ghost ? `site ${n.siteLabel}` : null,
    openBlockers ? `${openBlockers} open blocker${openBlockers === 1 ? "" : "s"}` : null,
    n.ghost ? "outside scope" : null,
    highlight === "critical" ? "on critical path" : null,
    highlight === "ready" ? "ready to start" : null,
    aging ? agingDescription(aging) : null,
    change ? `changed: ${CHANGE_LABEL[change]}` : null,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <div
      className={`card status-${status}${n.ghost ? " ghost" : ""}${dimmed ? " dimmed" : ""}${highlight ? ` hl-${highlight}` : ""}${compact ? " compact" : ""}${selected ? " selected" : ""}${preview ? " traverse-target" : ""}`}
      role="button"
      // Activating shows the details panel; while it shows this issue, the card controls it.
      aria-expanded={onExpand ? undefined : selected}
      aria-controls={selected ? ISSUE_DETAIL_ID : undefined}
      tabIndex={0}
      aria-label={n.rollup ? rollupLabel(n, n.rollup) : `${label}. Shows details.`}
      aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown"
      data-uid={n.uid}
      onClick={activate}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          activate(e);
          return;
        }
        const move = MOVE_KEYS[e.key];
        if (move && !e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey && onTraverse(n.uid, move)) e.preventDefault();
      }}
      onMouseEnter={() => {
        onHover(n.uid);
      }}
      onMouseLeave={() => {
        onHover(null);
      }}
      onFocus={() => {
        onHover(n.uid);
      }}
      onBlur={() => {
        onHover(null);
      }}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <TraverseHint direction={preview ?? "activate"} />
      {n.rollup ? (
        <RollupBody node={n} rollup={n.rollup} compact={compact} />
      ) : compact ? (
        <CompactBody
          node={n}
          statusText={statusText}
          openBlockers={openBlockers}
          ready={highlight === "ready"}
          aging={aging}
          change={change}
        />
      ) : (
        <>
          <div className="card-row1">
            <TypeIcon type={n.issueType} />
            <span className="card-key">{n.key}</span>
            {n.priority && <PriorityIcon priority={n.priority} />}
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
                  <span className="assignee-name">{firstName(n.assigneeName)}</span>
                </span>
                {n.storyPoints !== undefined && <span className="points">{n.storyPoints} pts</span>}
              </>
            )}
            <CappedBadges
              badges={[
                openBlockers > 0 && {
                  key: "blockers",
                  label: blockerText(openBlockers),
                  el: <BlockersBadge count={openBlockers} />,
                },
                highlight === "ready" && { key: "ready", label: "Ready", el: <span className="tag-ready">Ready</span> },
                aging && { key: "aging", label: agingDescription(aging), el: <AgingBadge aging={aging} /> },
                change && { key: "change", label: CHANGE_LABEL[change], el: <ChangeTag change={change} /> },
              ]}
            />
          </div>
        </>
      )}
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  );
});

export type SiteGroupData = {
  label: string;
  color?: string;
  url?: string;
  onOpen: (url: string) => void;
  /** Set on epic lanes: whether the epic is folded into its summary card, and how to switch. */
  fold?: Readonly<{ folded: boolean; onToggle: () => void }>;
};
export type SiteGroupNode = Node<SiteGroupData, "siteGroup">;

export const SiteGroup = memo(function SiteGroup({ data }: NodeProps<SiteGroupNode>) {
  const { url } = data;
  return (
    <div className="site-group" style={{ "--site": data.color ?? "#6b7280" }}>
      {url ? (
        <button
          type="button"
          className="site-group-label lane-link"
          onClick={() => {
            data.onOpen(url);
          }}
          title="Open epic in Jira"
          aria-label={`Epic ${data.label}. Opens in browser.`}
        >
          {data.label} <Icon name="external" />
        </button>
      ) : (
        <div className="site-group-label">{data.label}</div>
      )}
      {data.fold && (
        <button
          type="button"
          className="lane-collapse"
          onClick={data.fold.onToggle}
          aria-expanded={!data.fold.folded}
          aria-label={`${data.fold.folded ? "Expand" : "Collapse"} ${data.label}`}
          title={data.fold.folded ? "Show the epic's issues" : "Fold the epic into one summary card"}
        >
          {data.fold.folded ? "⊕ Expand" : "⊖ Collapse"}
        </button>
      )}
    </div>
  );
});
