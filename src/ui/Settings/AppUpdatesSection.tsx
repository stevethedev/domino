import { useEffect, useId, useState, type ReactElement } from "react";
import { appVersion } from "../../platform";
import type { AppUpdate } from "../../state/useAppUpdate";

/** What the last check found, in a sentence; null before any check. */
function statusText(updates: AppUpdate): string | null {
  const { state } = updates;
  switch (state.status) {
    case "idle":
      return null;
    case "checking":
      return "Checking…";
    case "current":
      return "You have the latest version.";
    case "available":
      return `Domino ${state.update.version} is available.`;
    case "installing":
      return `Installing Domino ${state.update.version}…`;
    case "failed":
      return state.message;
  }
}

/** Settings → App version: the running version, automatic update checks, and "Check now". */
export function AppUpdatesSection({
  updates,
  autoCheck,
  onAutoCheck,
}: {
  updates: AppUpdate;
  autoCheck: boolean;
  onAutoCheck: (on: boolean) => void;
}): ReactElement {
  const id = useId();
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    appVersion().then(
      (v) => {
        if (!cancelled) setVersion(v);
      },
      () => {
        if (!cancelled) setVersion("unknown");
      },
    );
    return (): void => {
      cancelled = true;
    };
  }, []);
  const status = statusText(updates);
  const failed = updates.state.status === "failed";

  return (
    <section className="backend-section" aria-labelledby={`${id}-h`}>
      <h3 id={`${id}-h`}>App version</h3>
      <p>
        Domino <span className="mono">{version ?? "…"}</span>
      </p>
      <label className="check">
        <input
          type="checkbox"
          role="switch"
          checked={autoCheck}
          aria-describedby={`${id}-hint`}
          onChange={(e) => {
            onAutoCheck(e.target.checked);
          }}
        />
        Check for updates automatically
      </label>
      <p className="hint" id={`${id}-hint`}>
        Looks for a newer release on GitHub shortly after launch and every few hours, and offers to install it. Updates are signed and
        checked before they install.
      </p>
      <div className="update-check">
        <button
          type="button"
          onClick={updates.check}
          disabled={updates.state.status === "checking" || updates.state.status === "installing"}
        >
          Check now
        </button>
        {(updates.state.status === "available" || (updates.state.status === "failed" && updates.state.update)) && (
          <button type="button" className="primary" onClick={updates.install}>
            Install and restart
          </button>
        )}
        {status && (
          <span className={failed ? "field-error" : "hint"} role={failed ? "alert" : "status"}>
            {status}
          </span>
        )}
      </div>
    </section>
  );
}
