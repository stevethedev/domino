import type { ReactElement } from "react";
import { isGroupBy, type Filters, type ViewOptions } from "./Canvas";

const LINK_ROWS: { key: keyof Filters; label: string; sample: string }[] = [
  { key: "blocks", label: "Blocks", sample: "solid" },
  { key: "relates", label: "Relates to", sample: "dashed" },
  { key: "duplicates", label: "Duplicates / clones", sample: "dotted" },
  { key: "crossSite", label: "Cross-site links ⇄", sample: "xsite" },
];

export function FilterPanel({
  filters,
  onFilters,
  view,
  onView,
  epicMapAvailable,
}: {
  filters: Filters;
  onFilters: (f: Filters) => void;
  view: ViewOptions;
  onView: (v: ViewOptions) => void;
  /** The epic map is a graph-view mode. */
  epicMapAvailable: boolean;
}): ReactElement {
  return (
    <>
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
