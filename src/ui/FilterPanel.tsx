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
}: {
  filters: Filters;
  onFilters: (f: Filters) => void;
  view: ViewOptions;
  onView: (v: ViewOptions) => void;
}) {
  return (
    <section className="panel" aria-labelledby="filters-h">
      <h2 id="filters-h">Links</h2>
      {LINK_ROWS.map((r) => (
        <label key={r.key} className="check">
          <input type="checkbox" checked={filters[r.key]} onChange={(e) => onFilters({ ...filters, [r.key]: e.target.checked })} />
          <span className={`legend legend-${r.sample}`} aria-hidden="true" />
          {r.label}
        </label>
      ))}
      <h2>View</h2>
      <label className="field group-by">
        <span>Group by</span>
        <select value={view.groupBy} onChange={(e) => isGroupBy(e.target.value) && onView({ ...view, groupBy: e.target.value })}>
          <option value="none">None</option>
          <option value="site">Site</option>
          <option value="epic">Epic</option>
          <option value="assignee">Assignee</option>
        </select>
      </label>
    </section>
  );
}
