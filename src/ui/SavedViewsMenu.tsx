import { useEffect, useRef, useState, type ReactElement } from "react";
import type { SavedView } from "../state/savedViews";
import { Icon } from "./Icon";

/** "Views" menu: apply, save (overwrites a same-named view) and delete named views. */
export function SavedViewsMenu({
  views,
  onApply,
  onSave,
  onDelete,
}: {
  views: readonly SavedView[];
  onApply: (v: SavedView) => void;
  onSave: (name: string) => void;
  onDelete: (name: string) => void;
}): ReactElement {
  const ref = useRef<HTMLDetailsElement>(null);
  const [name, setName] = useState("");
  const close = (): void => {
    if (ref.current) ref.current.open = false;
  };

  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (ref.current?.open && e.target instanceof Node && !ref.current.contains(e.target)) close();
    };
    document.addEventListener("mousedown", onDown);
    return (): void => {
      document.removeEventListener("mousedown", onDown);
    };
  }, []);

  const exists = views.some((v) => v.name.toLowerCase() === name.trim().toLowerCase());
  return (
    <details
      className="saved-views"
      ref={ref}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          close();
          ref.current?.querySelector("summary")?.focus();
        }
      }}
    >
      <summary aria-label={`Saved views (${views.length})`}>
        <span className="field-label">Views</span> <Icon name="chevron-down" className="disclosure-caret" />
      </summary>
      <div className="popover saved-views-popover">
        {views.length === 0 ? (
          <p className="muted small">No saved views yet. Save the current sites, query, filters and layout below.</p>
        ) : (
          <ul className="saved-views-list">
            {views.map((v) => (
              <li key={v.name}>
                <button
                  type="button"
                  className="saved-view-apply"
                  onClick={() => {
                    onApply(v);
                    close();
                  }}
                >
                  <span className="saved-view-name">{v.name}</span>
                  <span className="muted small">
                    {v.mode === "timeline" ? "Timeline" : v.view.collapseEpics ? "Epic map" : "Graph"} · {describeScope(v)}
                  </span>
                </button>
                <button
                  type="button"
                  className="icon-btn saved-view-delete"
                  onClick={() => {
                    onDelete(v.name);
                  }}
                  aria-label={`Delete view ${v.name}`}
                  title="Delete"
                >
                  <Icon name="close" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <form
          className="saved-views-save"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            onSave(name.trim());
            setName("");
          }}
        >
          <label className="sr-only" htmlFor="saved-view-name">
            View name
          </label>
          <input
            id="saved-view-name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
            }}
            placeholder="Name this view…"
            maxLength={60}
          />
          <button type="submit" className="primary" disabled={!name.trim()}>
            {exists ? "Update" : "Save"}
          </button>
        </form>
      </div>
    </details>
  );
}

function describeScope(v: SavedView): string {
  const s = v.scope;
  if (s.mode === "epic") return `epic ${s.key}`;
  if (s.mode === "seed") return `${s.key} ±${s.depth}`;
  return s.jql ? "query" : "site filters";
}
