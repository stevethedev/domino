import { useRef, useState, type ReactElement } from "react";
import type { ConfigFileStatus } from "../config/types";
import { errorMessage } from "../data/errors";

/**
 * Shown while the config file couldn't be used and the app is running on an empty config: what's
 * wrong and where the file is, with the ways out: fix it by hand and reload it, or set sites up
 * again in Settings (saving there replaces the file), or start fresh (the file is set aside first).
 */
export function ConfigProblemBanner({
  status,
  onReload,
  onReveal,
  onOpenSettings,
  onStartFresh,
}: {
  status: ConfigFileStatus;
  onReload: () => Promise<void>;
  /** Sets the file aside and writes an empty one (asks first). */
  onStartFresh: () => Promise<unknown>;
  onReveal: () => void;
  onOpenSettings: () => void;
}): ReactElement | null {
  const [reloading, setReloading] = useState(false);
  const [confirmFresh, setConfirmFresh] = useState(false);
  const startFreshRef = useRef<HTMLButtonElement>(null);
  const [freshError, setFreshError] = useState<string | null>(null);
  // Once the file is usable again, an old start-fresh failure is no longer news.
  if (status.problem === null && freshError !== null) setFreshError(null);
  if (status.problem === null) return null;
  return (
    <div className="banner error actionable" role="alert">
      <div className="banner-text">
        <strong>Domino couldn't read its settings file, so it started with no sites.</strong> {status.problem}
        <div className="muted small">
          Fix <code>{status.path}</code> and reload it, or add your sites again in Settings (saving there replaces the file).
        </div>
      </div>
      <div className="banner-actions">
        <button
          type="button"
          disabled={reloading}
          onClick={() => {
            setReloading(true);
            // A failure updates `status.problem`, which this banner shows.
            onReload()
              .catch(() => undefined)
              .finally(() => {
                setReloading(false);
              });
          }}
        >
          {reloading ? "Reloading…" : "Reload file"}
        </button>
        <button type="button" onClick={onReveal}>
          Show file
        </button>
        <button type="button" onClick={onOpenSettings}>
          Open Settings
        </button>
        {confirmFresh ? (
          <>
            <button
              type="button"
              className="danger"
              onClick={() => {
                setConfirmFresh(false);
                setFreshError(null);
                // A failure keeps the banner, saying why beside the file's own problem.
                onStartFresh().catch((e: unknown) => {
                  setFreshError(errorMessage(e));
                  startFreshRef.current?.focus();
                });
              }}
            >
              Start fresh
            </button>
            <button
              type="button"
              autoFocus
              onClick={() => {
                setConfirmFresh(false);
                requestAnimationFrame(() => startFreshRef.current?.focus()); // back to where they were
              }}
            >
              Keep the file
            </button>
          </>
        ) : (
          <button
            type="button"
            ref={startFreshRef}
            onClick={() => {
              setConfirmFresh(true);
            }}
          >
            Start fresh…
          </button>
        )}
      </div>
      {freshError && <p className="small banner-confirm">Couldn't start fresh: {freshError}</p>}
      {confirmFresh && (
        <p className="small banner-confirm">
          Start with no sites? The current file is kept beside it as <code>domino.config.broken.json</code> (or <code>-2</code>,{" "}
          <code>-3</code>… if earlier ones are there).
        </p>
      )}
    </div>
  );
}
