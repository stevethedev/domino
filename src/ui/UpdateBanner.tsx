import { useState, type ReactElement } from "react";
import type { AppUpdate } from "../state/useAppUpdate";

/**
 * "Domino 0.2.0 is available": install now (the app restarts) or later. "Later" hides it for this
 * version (offer or failed install) until the next launch; a newer version shows again. Shows
 * download progress and install failures.
 */
export function UpdateBanner({ updates }: { updates: AppUpdate }): ReactElement | null {
  const { state } = updates;
  const [dismissed, setDismissed] = useState<string | null>(null);
  const update = state.status === "available" || state.status === "installing" || state.status === "failed" ? state.update : undefined;
  if (!update || (state.status !== "installing" && dismissed === update.version)) return null;

  if (state.status === "installing") {
    const percent = state.progress === null ? null : Math.round(state.progress * 100);
    return (
      <div className="banner update" role="status">
        <strong>Installing Domino {update.version}…</strong>
        <progress max={100} value={percent ?? undefined} aria-label="Download progress" />
        <span className="muted">{percent === null ? "Downloading" : `${percent}%`}. Domino restarts when it's done.</span>
      </div>
    );
  }

  return (
    <div className={`banner update${state.status === "failed" ? " error" : ""}`} role={state.status === "failed" ? "alert" : "status"}>
      <strong>
        {state.status === "failed" ? state.message : `Domino ${update.version} is available`}
        <span className="muted"> · you have {update.currentVersion}</span>
      </strong>
      {update.notes && (
        <details className="update-notes">
          <summary>What&apos;s new</summary>
          <p>{update.notes}</p>
        </details>
      )}
      <div className="update-actions">
        <button type="button" className="primary" onClick={updates.install}>
          {state.status === "failed" ? "Try again" : "Install and restart"}
        </button>
        <button
          type="button"
          onClick={() => {
            setDismissed(update.version);
          }}
        >
          Later
        </button>
      </div>
    </div>
  );
}
