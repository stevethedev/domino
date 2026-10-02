import { useEffect, useId, useState, type ReactElement } from "react";
import { REFRESH_MINUTES, updatedAgo, type RefreshMinutes } from "../state/refresh";
import type { BackgroundRefresh } from "../state/useDomino";

/** Re-renders every `ms` so relative times stay current. */
function useNow(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => { setNow(Date.now()); }, ms);
    return (): void => { clearInterval(id); };
  }, [ms]);
  return now;
}

/**
 * How fresh the data on screen is ("updated 3m ago"), or why the last background refresh didn't
 * apply. It sits in a live region, so only errors are announced; the ticking time is hidden from
 * screen readers (the refresh button's label carries the last-updated time instead).
 */
export function Freshness({ background }: { background: BackgroundRefresh }): ReactElement | null {
  const now = useNow(30_000);
  const { lastUpdated, refreshing, error } = background;
  if (refreshing) return <span className="freshness" aria-hidden="true">refreshing…</span>;
  if (error) return <span className="freshness warn">{error}</span>;
  if (lastUpdated === null) return null;
  return (
    <span className="freshness" aria-hidden="true" title={`Last updated ${new Date(lastUpdated).toLocaleString()}`}>
      updated {updatedAgo(lastUpdated, now)}
    </span>
  );
}

/** Refresh-now. The auto-refresh interval lives in Settings (see `AutoRefreshField`). */
export function RefreshButton({ refreshing, lastUpdated, onRefresh }: { refreshing: boolean; lastUpdated: number | null; onRefresh: () => void }): ReactElement {
  const label = lastUpdated === null ? "Refresh now" : `Refresh now (last updated ${new Date(lastUpdated).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })})`;
  return (
    <button type="button" className={`icon-btn${refreshing ? " spinning" : ""}`} onClick={onRefresh} aria-label={label} aria-busy={refreshing} title={label}>
      ↻
    </button>
  );
}

/** The auto-refresh interval, a per-viewer preference shown in Settings. */
export function AutoRefreshField({ minutes, onMinutes }: { minutes: RefreshMinutes; onMinutes: (m: RefreshMinutes) => void }): ReactElement {
  const id = useId();
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
        Re-checks the current sites and query in the background, keeping the graph on screen. Paused while the window is hidden. Stored on this computer only.
      </p>
    </section>
  );
}
