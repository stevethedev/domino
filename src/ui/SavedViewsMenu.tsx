import { useEffect, useRef, useState, type ReactElement } from "react";
import { saveFile } from "../platform";
import { canSaveView, MAX_SAVED_VIEWS, readViewsFile, viewsFile, type ImportReport, type SavedView } from "../state/savedViews";
import { Icon } from "./Icon";
import { useDetailsMenu } from "./useDetailsMenu";

/** "N views" / "1 view". */
const countViews = (n: number): string => `${n} ${n === 1 ? "view" : "views"}`;

/** What an import did, in a sentence or two. */
export function importText(r: Pick<ImportReport, "added" | "replaced" | "skipped">): string {
  const done = r.added.length + r.replaced.length;
  const parts = [
    done === 0
      ? "Imported nothing."
      : `Imported ${countViews(done)}${r.replaced.length > 0 ? ` (${r.replaced.length} replaced a view with the same name)` : ""}.`,
  ];
  if (r.skipped.length > 0) {
    parts.push(
      `${countViews(r.skipped.length)} not imported (${r.skipped.join(", ")}): Domino keeps at most ${MAX_SAVED_VIEWS}. Delete some, then import again.`,
    );
  }
  return parts.join(" ");
}

/**
 * "Views" menu: apply, save (overwrites a same-named view), delete (after a confirm), and share
 * named views as a file. At the limit, only existing names can be saved.
 */
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
  /** Views read from a shared file (validated); the caller merges them in and says what it did. */
  onImport: (views: SavedView[]) => ImportReport;
}): ReactElement {
  const fileInput = useRef<HTMLInputElement>(null);
  const [shareStatus, setShareStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const { ref, close, onKeyDown } = useDetailsMenu();
  const [name, setName] = useState("");
  /** The view whose delete is waiting for a confirm. */
  const [confirming, setConfirming] = useState<string | null>(null);
  const list = useRef<HTMLUListElement>(null);
  // Asking to confirm puts focus on Keep, the safe choice, so Enter can't delete by accident.
  useEffect(() => {
    if (confirming !== null) list.current?.querySelector<HTMLButtonElement>(".saved-view-keep")?.focus();
  }, [confirming]);

  const exists = views.some((v) => v.name.toLowerCase() === name.trim().toLowerCase());
  const full = name.trim() !== "" && !canSaveView(views, name);
  /** Deletes, then puts focus on the next view (or the name field), not on the removed button. */
  const remove = (viewName: string): void => {
    const index = views.findIndex((v) => v.name === viewName);
    onDelete(viewName);
    setConfirming(null);
    requestAnimationFrame(() => {
      const buttons = list.current?.querySelectorAll<HTMLButtonElement>(".saved-view-apply");
      const next = buttons?.[Math.min(index, buttons.length - 1)];
      (next ?? document.getElementById("saved-view-name"))?.focus();
    });
  };
  return (
    <details
      className="saved-views"
      ref={ref}
      onKeyDown={onKeyDown}
      onToggle={(e) => {
        if (!e.currentTarget.open) setConfirming(null); // a pending delete doesn't outlive the menu
      }}
    >
      {/* The name starts with the visible label, so "click Views" works with voice control. */}
      <summary aria-label={`Views, ${countViews(views.length)} saved`}>
        <span className="field-label">Views</span> <Icon name="chevron-down" className="disclosure-caret" />
      </summary>
      <div className="popover saved-views-popover">
        {views.length === 0 ? (
          <p className="muted small">No saved views yet. Save the current sites, query, filters and layout below.</p>
        ) : (
          <ul className="saved-views-list" ref={list}>
            {views.map((v) =>
              confirming === v.name ? (
                <li key={v.name} className="saved-view-confirm">
                  <span>
                    Delete <strong>{v.name}</strong>?
                  </span>
                  <button
                    type="button"
                    className="danger"
                    onClick={() => {
                      remove(v.name);
                    }}
                  >
                    Delete
                  </button>
                  <button
                    type="button"
                    className="saved-view-keep"
                    onClick={() => {
                      setConfirming(null);
                      // Back to this view's ✕ (this button goes away), matched by label text.
                      requestAnimationFrame(() => {
                        [...(list.current?.querySelectorAll<HTMLElement>(".saved-view-delete") ?? [])]
                          .find((btn) => btn.getAttribute("aria-label") === `Delete view ${v.name}`)
                          ?.focus();
                      });
                    }}
                  >
                    Keep
                  </button>
                </li>
              ) : (
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
                      {v.mode === "timeline" ? "Timeline" : "Graph"} · {describeScope(v)}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="icon-btn saved-view-delete"
                    onClick={() => {
                      setConfirming(v.name);
                    }}
                    aria-label={`Delete view ${v.name}`}
                    title="Delete"
                  >
                    <Icon name="close" />
                  </button>
                </li>
              ),
            )}
          </ul>
        )}
        <form
          className="saved-views-save"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim() || full) return;
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
          <button
            type="submit"
            className="primary"
            disabled={!name.trim() || full}
            aria-describedby={full ? "saved-views-full" : undefined}
          >
            {exists ? "Update" : "Save"}
          </button>
        </form>
        {full && (
          <p id="saved-views-full" className="field-error">
            You have {MAX_SAVED_VIEWS} saved views, the most Domino keeps. Delete one to save another, or use an existing name to update it.
          </p>
        )}
        <div className="saved-views-share">
          <button
            type="button"
            className="link-btn"
            disabled={views.length === 0}
            onClick={() => {
              saveFile("domino-views.json", viewsFile(views), { name: "Domino views", extensions: ["json"] })
                .then((saved) => {
                  if (saved) setShareStatus({ kind: "ok", text: `Exported ${countViews(views.length)}.` });
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
                  const report = onImport(readViewsFile(text));
                  setShareStatus({ kind: report.skipped.length > 0 ? "error" : "ok", text: importText(report) });
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
