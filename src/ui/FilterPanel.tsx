import type { ReactElement } from "react";
import type { GraphNode, StatusCategory } from "../graph/types";
import {
  hasIssueFilters,
  NO_ISSUE_FILTERS,
  NO_PRIORITY,
  passesIssueFilters,
  UNASSIGNED,
  type IssueFilters,
  type LinkFilters,
} from "../graph/visible";
import { isSortKey, orderText, SORT_INFO, SORT_KEYS, type SortBy, type SortGroup } from "../graph/sort";
import { isGroupBy, type Filters, type ViewOptions } from "./Canvas";
import { Icon } from "./Icon";

const LINK_ROWS: { key: keyof LinkFilters; label: string; sample: string }[] = [
  { key: "blocks", label: "Blocks", sample: "solid" },
  { key: "relates", label: "Relates to", sample: "dashed" },
  { key: "duplicates", label: "Duplicates / clones", sample: "dotted" },
  { key: "crossSite", label: "Cross-site links ⇄", sample: "xsite" },
];

const CATEGORY_LABEL: Record<StatusCategory, string> = { todo: "To Do", inprogress: "In Progress", done: "Done", unknown: "Unknown" };
const CATEGORIES: readonly StatusCategory[] = ["todo", "inprogress", "done", "unknown"];

/** Values present in the loaded issues, most common first, with how many issues have each. */
function tally(nodes: readonly GraphNode[], valueOf: (n: GraphNode) => string): [string, number][] {
  const counts = new Map<string, number>();
  for (const n of nodes) counts.set(valueOf(n), (counts.get(valueOf(n)) ?? 0) + 1);
  return [...counts].sort(([a, x], [b, y]) => y - x || a.localeCompare(b));
}

/**
 * Priority options in the sites' own order, most severe first (by a name's highest rank on any
 * site), then any whose order didn't load by how common they are, then issues with no priority.
 */
export function byPriority(issues: readonly GraphNode[]): [string, number][] {
  const ranks = new Map<string, number>();
  for (const { priority: p } of issues) {
    if (p?.rank !== undefined) ranks.set(p.name, Math.min(p.rank, ranks.get(p.name) ?? Infinity));
  }
  // Tiers: ranked by the sites, unranked, then no priority. `tally` already put each tier in count order.
  const tier = (name: string): number => (name === NO_PRIORITY ? 2 : ranks.has(name) ? 0 : 1);
  return tally(issues, (n) => n.priority?.name ?? NO_PRIORITY).sort(
    ([a], [b]) => tier(a) - tier(b) || (ranks.get(a) ?? 0) - (ranks.get(b) ?? 0),
  );
}

const toggled = <T,>(list: readonly T[], value: T): T[] => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

/** A compact multi-select: a menu of checkboxes (checked = shown) for one issue field. */
function FilterMenu({
  label,
  options,
  hidden,
  onHidden,
  display = (v) => v,
}: {
  label: string;
  options: readonly [string, number][];
  hidden: readonly string[];
  onHidden: (next: string[]) => void;
  display?: (value: string) => string;
}): ReactElement {
  const hiddenHere = options.filter(([v]) => hidden.includes(v)).length;
  return (
    <details className="filter-menu">
      <summary>
        <span className="field-label">{label}</span>
        <span className={hiddenHere ? "filter-menu-state active" : "filter-menu-state"}>{hiddenHere ? `${hiddenHere} hidden` : "All"}</span>
        <Icon name="chevron-down" className="disclosure-caret" />
      </summary>
      <fieldset className="popover">
        <legend className="sr-only">{label} to show</legend>
        {options.map(([value, count]) => (
          <label key={value} className="check">
            <input
              type="checkbox"
              checked={!hidden.includes(value)}
              onChange={() => {
                onHidden(toggled(hidden, value));
              }}
            />
            <span className="filter-menu-value">{display(value)}</span>
            <span className="muted small">{count}</span>
          </label>
        ))}
      </fieldset>
    </details>
  );
}

const SORT_GROUPS: readonly SortGroup[] = ["Ticket", "Dates", "Impact", "Release"];

/**
 * Sort by: a key (grouped), and beside it the order in words ("Most severe first"), which
 * reverses it. The natural order is each view's own: dependencies in the Graph, start date in the Timeline.
 */
function SortField({ sort, onSort }: { sort: SortBy; onSort: (next: SortBy) => void }): ReactElement {
  const order = orderText(sort);
  return (
    <div className="field sort-by">
      <label className="field">
        <span>Sort by</span>
        <select
          value={sort.key}
          title={sort.key === "natural" ? "Graph: by dependencies; Timeline: by start date" : undefined}
          onChange={(e) => {
            if (isSortKey(e.target.value)) onSort({ key: e.target.value, reversed: false });
          }}
        >
          <option value="natural">Natural order</option>
          {SORT_GROUPS.map((group) => (
            <optgroup key={group} label={group}>
              {SORT_KEYS.flatMap((key) =>
                key !== "natural" && SORT_INFO[key].group === group
                  ? [
                      <option key={key} value={key}>
                        {SORT_INFO[key].label}
                      </option>,
                    ]
                  : [],
              )}
            </optgroup>
          ))}
        </select>
      </label>
      {sort.key !== "natural" && (
        <button
          type="button"
          className="link-btn sort-order"
          aria-label={`Order: ${order}. Reverses it.`}
          title="Reverse the order"
          onClick={() => {
            onSort({ ...sort, reversed: !sort.reversed });
          }}
        >
          {order} <span aria-hidden="true">⇅</span>
        </button>
      )}
    </div>
  );
}

export function FilterPanel({
  filters,
  onFilters,
  view,
  onView,
  epicFolds,
  issues,
  impliedLinks,
}: {
  filters: Filters;
  onFilters: (f: Filters) => void;
  view: ViewOptions;
  onView: (v: ViewOptions) => void;
  /** While grouped by epic: how many epic lanes there are and are folded, and folding them all. */
  epicFolds?: Readonly<{ total: number; folded: number; onFoldAll: (fold: boolean) => void }>;
  /** Loaded (non-ghost) issues: the filter options and counts come from these. */
  issues: readonly GraphNode[];
  /** How many drawn blocking links a longer chain implies (hidden when the switch is on). */
  impliedLinks: number;
}): ReactElement {
  const f = filters.issues;
  const setIssues = (patch: Partial<IssueFilters>): void => {
    onFilters({ ...filters, issues: { ...f, ...patch } });
  };
  const byCategory = new Map(tally(issues, (n) => n.statusCategory));
  // Only categories something is in (or that are already hidden, so they can be shown again).
  const categories = CATEGORIES.filter((c) => byCategory.has(c) || f.hiddenCategories.includes(c));
  const shown = issues.filter((n) => passesIssueFilters(n, f)).length;
  return (
    <>
      <h3 className="subhead">Issues</h3>
      <div className="status-toggles" role="group" aria-label="Statuses to show">
        {categories.map((c) => (
          <button
            key={c}
            type="button"
            className={`status-toggle pill-${c}`}
            aria-pressed={!f.hiddenCategories.includes(c)}
            onClick={() => {
              setIssues({ hiddenCategories: toggled(f.hiddenCategories, c) });
            }}
          >
            {CATEGORY_LABEL[c]} <span className="status-toggle-count">{byCategory.get(c) ?? 0}</span>
          </button>
        ))}
      </div>
      <FilterMenu
        label="Type"
        options={tally(issues, (n) => n.issueType)}
        hidden={f.hiddenTypes}
        onHidden={(hiddenTypes) => {
          setIssues({ hiddenTypes });
        }}
      />
      <FilterMenu
        label="Assignee"
        options={tally(issues, (n) => n.assigneeName ?? UNASSIGNED)}
        hidden={f.hiddenAssignees}
        onHidden={(hiddenAssignees) => {
          setIssues({ hiddenAssignees });
        }}
        display={(v) => (v === UNASSIGNED ? "Unassigned" : v)}
      />
      <FilterMenu
        label="Priority"
        options={byPriority(issues)}
        hidden={f.hiddenPriorities}
        onHidden={(hiddenPriorities) => {
          setIssues({ hiddenPriorities });
        }}
        display={(v) => (v === NO_PRIORITY ? "No priority" : v)}
      />
      {hasIssueFilters(f) && (
        <p className="hint" role="status">
          Showing {shown} of {issues.length} issues ·{" "}
          <button
            type="button"
            className="link-btn"
            onClick={() => {
              onFilters({ ...filters, issues: NO_ISSUE_FILTERS });
            }}
          >
            Clear filters
          </button>
        </p>
      )}
      <h3 className="subhead">Links</h3>
      {LINK_ROWS.map((r) => (
        <label key={r.key} className="check">
          <input
            type="checkbox"
            checked={filters[r.key]}
            onChange={(e) => {
              onFilters({ ...filters, [r.key]: e.target.checked });
            }}
          />
          <span className={`legend legend-${r.sample}`} aria-hidden="true" />
          {r.label}
        </label>
      ))}
      <label className="check" title="A→C is implied when A→B→C is drawn; it shows again if B is hidden">
        <input
          type="checkbox"
          role="switch"
          checked={filters.hideImplied}
          onChange={(e) => {
            onFilters({ ...filters, hideImplied: e.target.checked });
          }}
        />
        Hide implied links
        {impliedLinks > 0 && <span className="muted small"> · {impliedLinks}</span>}
      </label>
      <h3 className="subhead">Layout</h3>
      <label className="field group-by">
        <span>Group by</span>
        <select
          value={view.groupBy}
          onChange={(e) => {
            if (isGroupBy(e.target.value)) onView({ ...view, groupBy: e.target.value });
          }}
        >
          <option value="none">None</option>
          <option value="site">Site</option>
          <option value="epic">Epic</option>
          <option value="assignee">Assignee</option>
        </select>
      </label>
      <SortField
        sort={view.sort}
        onSort={(sort) => {
          onView({ ...view, sort });
        }}
      />
      {epicFolds && (
        <div className="epic-folds">
          <p className="hint">
            Collapse an epic&apos;s lane to fold it into one summary card, with its links combined. {epicFolds.folded} of {epicFolds.total}{" "}
            folded.
          </p>
          <button
            type="button"
            className="link-btn"
            onClick={() => {
              epicFolds.onFoldAll(epicFolds.folded < epicFolds.total);
            }}
          >
            {epicFolds.folded < epicFolds.total ? "Collapse all epics" : "Expand all epics"}
          </button>
        </div>
      )}
    </>
  );
}
