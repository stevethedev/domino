import { useEffect, useLayoutEffect, useRef, useState, type ReactElement } from "react";
import type { Aging } from "../graph/aging";
import type { ChangeKind } from "../graph/changes";
import type { Day, StatusChange } from "../graph/schedule";
import type { Graph, GraphEdge, GraphNode, Release, StatusCategory } from "../graph/types";
import type { DescriptionState } from "../state/useDescription";
import { AdfDocument, hasContent } from "./Adf";
import { AgingBadge, ChangeTag, ISSUE_DETAIL_ID, PriorityIcon, TypeIcon } from "./IssueCard";
import { fmtDay } from "./format";
import { Icon } from "./Icon";

const CATEGORY_LABEL: Record<StatusCategory, string> = { todo: "To Do", inprogress: "In Progress", done: "Done", unknown: "Unknown" };

/** "Oct 3, 2026" for a calendar day. */
const fmtDate = (d: Day): string => fmtDay(d, true);

export type IssueDetailData = {
  node: GraphNode;
  graph: Graph;
  /** Open issues downstream of this one through blocking links (what finishing it unblocks). */
  unblocks: number;
  openBlockers: number;
  aging?: Aging;
  changes: readonly ChangeKind[];
  /** Status-category transitions, oldest first; undefined until history has loaded. */
  history?: readonly StatusChange[];
  /** The releases it's planned for, and whether the forecast misses each one's date. */
  releases: readonly Readonly<{ release: Release; misses: boolean }>[];
  /** The last day it's forecast to finish, while open. */
  forecastDone?: Day;
  /** What keeps its card or row off screen, if anything: the panel is then all that shows it. */
  hiddenBy?: "issue filters" | "link filters";
};

/** One related issue: key, summary and status; activating it moves the panel (and the view) there. */
function IssueLink({ node, onSelect }: { node: GraphNode; onSelect: (uid: string) => void }): ReactElement {
  return (
    <li>
      <button
        type="button"
        className="detail-link"
        onClick={() => {
          onSelect(node.uid);
        }}
        title={`${node.key}: ${node.summary}`}
      >
        <TypeIcon type={node.issueType} />
        <span className="card-key">{node.key}</span>
        <span className="detail-link-summary">{node.summary}</span>
        <span className={`pill pill-${node.statusCategory}`}>{node.statusName || CATEGORY_LABEL[node.statusCategory]}</span>
      </button>
    </li>
  );
}

function LinkList({
  title,
  edges,
  otherEnd,
  nodes,
  onSelect,
}: {
  title: string;
  edges: readonly GraphEdge[];
  otherEnd: (e: GraphEdge) => string;
  nodes: ReadonlyMap<string, GraphNode>;
  onSelect: (uid: string) => void;
}): ReactElement | null {
  const related = [...new Set(edges.map(otherEnd))].flatMap((uid) => {
    const n = nodes.get(uid);
    return n ? [n] : [];
  });
  if (related.length === 0) return null;
  return (
    <section className="detail-section">
      <h3 className="subhead">
        {title} <span className="muted">· {related.length}</span>
      </h3>
      <ul className="detail-links">
        {related.map((n) => (
          <IssueLink key={n.uid} node={n} onSelect={onSelect} />
        ))}
      </ul>
    </section>
  );
}

/**
 * The issue's description: loading, missing, failed (with Retry) or shown. A long one is clipped
 * until "Show more"; keyed by issue, so each opens clipped.
 */
function Description({
  state,
  onOpen,
  onRetry,
}: {
  state: DescriptionState;
  onOpen: (url: string) => void;
  onRetry: () => void;
}): ReactElement {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const doc = state.status === "loaded" ? state.doc : null;
  // Measured again whenever the clipped box or its content changes size (a resize, a <details>
  // opening, fonts arriving), so "Show more" appears exactly when something is cut off.
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const measure = (): void => {
      setOverflows(el.scrollHeight > el.clientHeight + 1);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    for (const child of el.children) observer.observe(child);
    return (): void => {
      observer.disconnect();
    };
  }, [doc]);

  let body: ReactElement;
  if (state.status === "loading") body = <p className="muted">Loading the description…</p>;
  else if (state.status === "error") {
    body = (
      <p className="detail-description-error">
        Couldn't load the description: {state.message}{" "}
        <button type="button" className="link-btn" onClick={onRetry}>
          Retry
        </button>
      </p>
    );
  } else if (!hasContent(state.doc)) body = <p className="muted">No description.</p>;
  else {
    body = (
      <>
        <div
          ref={bodyRef}
          id="detail-description-body"
          // Tabbing to a link below the cut would focus something out of sight: open it up first.
          // Only then: a visible link (or a click on one) leaves the layout alone.
          onFocus={(e) => {
            if (expanded || !overflows) return;
            const box = e.currentTarget;
            // In content coordinates, so a scroll the browser already made to reveal it doesn't hide
            // the answer; the faded last 3em counts as out of sight.
            const bottom = e.target.getBoundingClientRect().bottom - box.getBoundingClientRect().top + box.scrollTop;
            const fade = 3 * parseFloat(getComputedStyle(box).fontSize);
            if (box.scrollTop > 0 || bottom > box.clientHeight - fade) {
              box.scrollTop = 0;
              setExpanded(true);
            }
          }}
          className={`detail-description${expanded ? " expanded" : overflows ? " clipped" : ""}`}
        >
          <AdfDocument doc={state.doc} onOpen={onOpen} />
        </div>
        {(overflows || expanded) && (
          <button
            type="button"
            className="link-btn"
            aria-expanded={expanded}
            aria-controls="detail-description-body"
            onClick={() => {
              setExpanded(!expanded);
            }}
          >
            {expanded ? "Show less" : "Show more"}
          </button>
        )}
      </>
    );
  }
  // Focus stays on the title while this arrives: say how it went (not the text itself, which can be long).
  const announcement =
    state.status === "loading"
      ? ""
      : state.status === "error"
        ? "Couldn't load the description."
        : hasContent(state.doc)
          ? "Description loaded."
          : "No description.";
  return (
    <section className="detail-section" aria-busy={state.status === "loading"}>
      <h3 className="subhead">Description</h3>
      <p className="sr-only" role="status">
        {announcement}
      </p>
      {body}
    </section>
  );
}

/**
 * Details for the selected issue, from what's already loaded: status and badges, people, dates,
 * its description, what blocks it and what it blocks (each a link that moves the panel there), and its status
 * history. Esc or the close button closes it; "Open in Jira" leaves the app.
 */
export function IssueDetail({
  data,
  onSelect,
  onOpen,
  onClose,
  focusRequest,
  onShowHidden,
  description,
  onRetryDescription,
}: {
  data: IssueDetailData;
  onSelect: (uid: string) => void;
  onOpen: (url: string) => void;
  onClose: () => void;
  /**
   * Changes whenever focus should move into the panel (opening an issue with click or Enter), but
   * not when arrow keys follow links on the cards, which keeps focus there.
   */
  focusRequest: number;
  /** Brings a filtered-out issue back into view (clearing the filters, with an undo). */
  onShowHidden: () => void;
  /** Null when there's nothing to fetch it from. */
  description: DescriptionState | null;
  onRetryDescription: () => void;
}): ReactElement {
  const { node: n, graph, unblocks, openBlockers, aging, changes, history, releases, forecastDone } = data;
  const headingRef = useRef<HTMLHeadingElement>(null);
  // Move focus into the panel when asked, so keyboard users land on it.
  useEffect(() => {
    headingRef.current?.focus();
  }, [focusRequest]);

  const nodes = new Map(graph.nodes.map((x) => [x.uid, x]));
  const links = graph.edges.filter((e) => e.source === n.uid || e.target === n.uid);
  const blockedBy = links.filter((e) => e.kind === "blocks" && e.target === n.uid);
  const blocks = links.filter((e) => e.kind === "blocks" && e.source === n.uid);
  const other = links.filter((e) => e.kind !== "blocks");
  const epic = n.epic && n.epic.uid !== n.uid ? nodes.get(n.epic.uid) : undefined;
  const facts: [string, ReactElement | string][] = [];
  if (!n.ghost) facts.push(["Assignee", n.assigneeName ?? "Unassigned"]);
  if (n.priority) {
    facts.push([
      "Priority",
      <>
        <PriorityIcon priority={n.priority} /> {n.priority.name}
      </>,
    ]);
  }
  if (n.storyPoints !== undefined) facts.push(["Estimate", `${n.storyPoints} pts`]);
  if (n.epic && n.epic.uid !== n.uid) {
    facts.push([
      "Epic",
      epic ? (
        <button
          type="button"
          className="link-btn"
          onClick={() => {
            onSelect(epic.uid);
          }}
        >
          {n.epic.key}
          {n.epic.summary ? ` · ${n.epic.summary}` : ""}
        </button>
      ) : (
        `${n.epic.key}${n.epic.summary ? ` · ${n.epic.summary}` : ""}`
      ),
    ]);
  }
  for (const { release } of releases) {
    const when = release.date ? ` · ${fmtDate(release.date)}` : "";
    facts.push([
      releases.length > 1 ? `Release (${release.name})` : "Release",
      `${release.name}${when}${release.released ? " · released" : ""}`,
    ]);
  }
  const missed = releases.filter((r) => r.misses).map((r) => r.release);
  if (n.dates?.created) facts.push(["Created", fmtDate(n.dates.created)]);
  if (n.dates?.due) facts.push(["Due", fmtDate(n.dates.due)]);
  if (n.dates?.resolved) facts.push(["Resolved", fmtDate(n.dates.resolved)]);

  return (
    <aside
      id={ISSUE_DETAIL_ID}
      className="issue-detail"
      aria-labelledby="issue-detail-title"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <header className="detail-header">
        <TypeIcon type={n.issueType} />
        <span className="card-key">{n.key}</span>
        <span className="site-badge" style={{ "--site": n.siteColor ?? "#6b7280" }}>
          {n.siteLabel}
        </span>
        <button type="button" className="icon-btn detail-close" onClick={onClose} aria-label="Close details" title="Close (Esc)">
          <Icon name="close" />
        </button>
      </header>
      <h2 id="issue-detail-title" className="detail-title" tabIndex={-1} ref={headingRef}>
        {n.summary}
      </h2>
      <div className="detail-badges">
        <span className={`pill pill-${n.statusCategory}`}>{n.statusName || CATEGORY_LABEL[n.statusCategory]}</span>
        {openBlockers > 0 && (
          <span className="blockers">
            <Icon name="alert" /> {openBlockers} open blocker{openBlockers === 1 ? "" : "s"}
          </span>
        )}
        {aging && <AgingBadge aging={aging} />}
        {changes.map((c) => (
          <ChangeTag key={c} change={c} />
        ))}
      </div>
      {n.ghost && <p className="hint">Outside the loaded scope: only what its links say is known.</p>}
      {data.hiddenBy === "issue filters" && (
        <p className="hint">
          Hidden by your Display filters.{" "}
          <button type="button" className="link-btn" onClick={onShowHidden}>
            Show
          </button>
        </p>
      )}
      {data.hiddenBy === "link filters" && <p className="hint">Not drawn: only links hidden in Display → Links reach it.</p>}
      {missed.length > 0 && forecastDone && (
        <p className="detail-risk">
          <Icon name="alert" /> Forecast to finish {fmtDate(forecastDone)}, after{" "}
          {missed.map((r) => `${r.name}${r.date ? ` (${fmtDate(r.date)})` : ""}`).join(", ")}.
        </p>
      )}
      {unblocks > 0 && (
        <p className="detail-impact">
          Finishing this unblocks <strong>{unblocks}</strong> open ticket{unblocks === 1 ? "" : "s"} downstream.
        </p>
      )}
      {facts.length > 0 && (
        <dl className="detail-facts">
          {facts.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {description && <Description key={n.uid} state={description} onOpen={onOpen} onRetry={onRetryDescription} />}
      <LinkList title="Blocked by" edges={blockedBy} otherEnd={(e) => e.source} nodes={nodes} onSelect={onSelect} />
      <LinkList title="Blocks" edges={blocks} otherEnd={(e) => e.target} nodes={nodes} onSelect={onSelect} />
      <LinkList
        title="Other links"
        edges={other}
        otherEnd={(e) => (e.source === n.uid ? e.target : e.source)}
        nodes={nodes}
        onSelect={onSelect}
      />
      {history && history.length > 0 && (
        <section className="detail-section">
          <h3 className="subhead">Status history</h3>
          <ol className="detail-history">
            {history.map((h, i) => (
              <li key={`${h.at}-${i}`}>
                <span className="muted">{fmtDate(h.at)}</span> {CATEGORY_LABEL[h.toCategory]}
              </li>
            ))}
          </ol>
        </section>
      )}
      <div className="detail-actions">
        <button
          type="button"
          className="primary"
          onClick={() => {
            onOpen(n.url);
          }}
        >
          Open in Jira <Icon name="external" />
        </button>
      </div>
    </aside>
  );
}
