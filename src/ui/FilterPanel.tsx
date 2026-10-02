import type { ReactElement } from "react";
import type { GraphNode, StatusCategory } from "../graph/types";
import { hasIssueFilters, NO_ISSUE_FILTERS, passesIssueFilters, UNASSIGNED, type IssueFilters, type LinkFilters } from "../graph/visible";
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

export function FilterPanel({
  filters,
  onFilters,
  view,
  onView,
  epicMapAvailable,
  issues,
  impliedLinks,
}: {
  filters: Filters;
  onFilters: (f: Filters) => void;
  view: ViewOptions;
  onView: (v: ViewOptions) => void;
  /** The epic map is a graph-view mode. */
  epicMapAvailable: boolean;
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
          disabled={view.collapseEpics && epicMapAvailable}
          title={view.collapseEpics && epicMapAvailable ? "The epic map groups by epic" : undefined}
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
      <label
        className="check"
        title={epicMapAvailable ? "One card per epic, with links between epics combined" : "Available in the Graph view"}
      >
        <input
          type="checkbox"
          role="switch"
          checked={view.collapseEpics}
          disabled={!epicMapAvailable}
          onChange={(e) => {
            onView({ ...view, collapseEpics: e.target.checked });
          }}
        />
        Epic map (collapse epics)
      </label>
    </>
  );
}
