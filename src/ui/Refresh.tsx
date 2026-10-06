import { useEffect, useId, useState, type ReactElement } from "react";
import { requestNotificationPermission } from "../platform";
import type { SiteConfig } from "../config/types";
import { freshnessOf, REFRESH_MINUTES, type RefreshMinutes } from "../state/refresh";
import type { BackgroundRefresh } from "../state/useDomino";
import { SpinnerIcon } from "./LoadStatus";

/** Re-renders every `ms` so relative times stay current. */
function useNow(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => {
      setNow(Date.now());
    }, ms);
    return (): void => {
      clearInterval(id);
    };
  }, [ms]);
  return now;
}

/**
 * How fresh the data on screen is ("updated 3m ago", "from 2h ago, updating…"), or why it's older
 * than it seems. It sits in a live region, so only warnings are announced; the ticking time is
 * hidden from screen readers (the refresh button's label carries the last-updated time instead).
 */
export function Freshness({
  background,
  sites,
  updating,
  shownAt,
}: {
  background: BackgroundRefresh;
  sites: readonly SiteConfig[];
  /** A load is running while this scope's tickets are on screen. */
  updating: boolean;
  /** When the oldest data on screen was fetched. */
  shownAt: number | null;
}): ReactElement | null {
  const now = useNow(30_000);
  const labelOf = (id: string): string => sites.find((s) => s.id === id)?.label ?? id;
  const f = freshnessOf({ ...background, updating, shownAt }, labelOf, now);
  if (!f) return null;
  if (f.warn) return <span className="freshness warn">{f.text}</span>;
  const title = background.lastUpdated === null ? undefined : `Last updated ${new Date(background.lastUpdated).toLocaleString()}`;
  return (
    <span className="freshness" aria-hidden="true" title={title}>
      {f.text}
    </span>
  );
}

/** Refresh-now. The auto-refresh interval lives in Settings (see `AutoRefreshField`). */
export function RefreshButton({
  refreshing,
  lastUpdated,
  onRefresh,
}: {
  refreshing: boolean;
  lastUpdated: number | null;
  onRefresh: () => void;
}): ReactElement {
  const label =
    lastUpdated === null
      ? "Refresh now"
      : `Refresh now (last updated ${new Date(lastUpdated).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })})`;
  return (
    <button type="button" className="icon-btn refresh-btn" onClick={onRefresh} aria-label={label} aria-busy={refreshing} title={label}>
      <SpinnerIcon active={refreshing} />
    </button>
  );
}

/** The auto-refresh interval, a per-viewer preference shown in Settings. */
export function AutoRefreshField({
  minutes,
  onMinutes,
  notifyUnblocked,
  onNotifyUnblocked,
}: {
  minutes: RefreshMinutes;
  onMinutes: (m: RefreshMinutes) => void;
  /** Desktop notification when a refresh unblocks the user's own issues. */
  notifyUnblocked: boolean;
  onNotifyUnblocked: (on: boolean) => void;
}): ReactElement {
  const id = useId();
  const [permissionDenied, setPermissionDenied] = useState(false);
  return (
    <section className="backend-section" aria-labelledby={`${id}-h`}>
      <h3 id={`${id}-h`}>Updates</h3>
      <div className="form-field">
        <label htmlFor={`${id}-every`}>Refresh tickets automatically</label>
        <select
          id={`${id}-every`}
          className="auto-refresh-select"
          aria-describedby={`${id}-hint`}
          value={minutes}
          onChange={(e) => {
            const m = REFRESH_MINUTES.find((x) => String(x) === e.target.value);
            if (m !== undefined) onMinutes(m);
          }}
        >
          {REFRESH_MINUTES.map((m) => (
            <option key={m} value={m}>
              {m === 0 ? "Off" : `Every ${m} minutes`}
            </option>
          ))}
        </select>
      </div>
      <p className="hint" id={`${id}-hint`}>
        Re-checks the current sites and query in the background, keeping the graph on screen. Paused while the window is hidden. Stored on
        this computer only.
      </p>
      <label className="check">
        <input
          type="checkbox"
          role="switch"
          checked={notifyUnblocked}
          aria-describedby={`${id}-notify-hint`}
          onChange={(e) => {
            if (!e.target.checked) {
              onNotifyUnblocked(false);
              return;
            }
            // Turning it on asks the OS first; it stays off if notifications aren't allowed.
            void requestNotificationPermission().then((granted) => {
              setPermissionDenied(!granted);
              onNotifyUnblocked(granted);
            });
          }}
        />
        Notify me when my work is unblocked
      </label>
      <p className={permissionDenied ? "field-error" : "hint"} id={`${id}-notify-hint`} role={permissionDenied ? "alert" : undefined}>
        {permissionDenied
          ? "Notifications aren't allowed for Domino. Turn them on in your system settings, then try again."
          : "When a refresh finds that an issue assigned to you is no longer blocked. Needs auto-refresh, or a manual refresh."}
      </p>
    </section>
  );
}
