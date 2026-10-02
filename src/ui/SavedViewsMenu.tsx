import { useRef, useState, type ReactElement } from "react";
import { saveFile } from "../platform";
import { readViewsFile, viewsFile, type SavedView } from "../state/savedViews";
import { Icon } from "./Icon";
import { useDetailsMenu } from "./useDetailsMenu";

/** "Views" menu: apply, save (overwrites a same-named view), delete, and share named views as a file. */
export function SavedViewsMenu({
  views,
  onApply,
  onSave,
  onDelete,
  onImport,
}: {
  views: readonly SavedView[];
  onApply: (v: SavedView) => void;
  onSave: (name: string) => void;
  onDelete: (name: string) => void;
  /** Views read from a shared file (validated); the caller merges them in. */
  onImport: (views: SavedView[]) => void;
}): ReactElement {
  const fileInput = useRef<HTMLInputElement>(null);
  const [shareStatus, setShareStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const { ref, close, onKeyDown } = useDetailsMenu();
  const [name, setName] = useState("");

  const exists = views.some((v) => v.name.toLowerCase() === name.trim().toLowerCase());
  return (
    <details className="saved-views" ref={ref} onKeyDown={onKeyDown}>
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
        <div className="saved-views-share">
          <button
            type="button"
            className="link-btn"
            disabled={views.length === 0}
            onClick={() => {
              saveFile("domino-views.json", viewsFile(views), { name: "Domino views", extensions: ["json"] })
                .then((saved) => {
                  if (saved) setShareStatus({ kind: "ok", text: `Exported ${views.length} ${views.length === 1 ? "view" : "views"}.` });
                })
                .catch((e: unknown) => {
                  setShareStatus({ kind: "error", text: `Export failed: ${e instanceof Error ? e.message : String(e)}` });
                });
            }}
          >
            Export views…
          </button>
          <button
            type="button"
            className="link-btn"
            onClick={() => {
              fileInput.current?.click();
            }}
          >
            Import views…
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = ""; // picking the same file again still fires
              if (!file) return;
              file
                .text()
                .then((text) => {
                  const imported = readViewsFile(text);
                  onImport(imported);
                  setShareStatus({ kind: "ok", text: `Imported ${imported.length} ${imported.length === 1 ? "view" : "views"}.` });
                })
                .catch((err: unknown) => {
                  setShareStatus({ kind: "error", text: err instanceof Error ? err.message : String(err) });
                });
            }}
          />
        </div>
        {shareStatus && (
          <p className={shareStatus.kind === "error" ? "field-error" : "hint"} role="status">
            {shareStatus.text}
          </p>
        )}
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
