import { useState, type ReactElement } from "react";
import type { SiteConfig } from "../config/types";
import type { SiteError } from "../data/MultiSiteLoader";
import { ageText, type LaggingSite } from "../state/refresh";

/** A site's error, naming the site once: Jira errors already start with it ("Acme returned 401 …"). */
export function siteErrorText(label: string, message: string): string {
  return message.startsWith(`${label} `) ? message : `${label}: ${message}`;
}

/** "showing its tickets from 2h ago", or "showing its last tickets" when they're only moments old. */
function shownFrom(takenAt: number, now: number): string {
  const age = ageText(takenAt, now);
  return age === "just now" ? "showing its last tickets" : `showing its tickets from ${age}`;
}

/**
 * Sites that couldn't load: those with nothing to show (`errors`), and those still showing earlier
 * tickets (`lagging`), each with why, so an expired token isn't a silent "couldn't update". Retry
 * loads again; Open Settings is where credentials are fixed. Dismiss hides it until the errors change.
 */
export function ErrorBanner({
  errors,
  lagging,
  sites,
  attempted,
  now,
  onRetry,
  onOpenSettings,
}: {
  errors: readonly SiteError[];
  lagging: readonly LaggingSite[];
  sites: readonly SiteConfig[];
  attempted: number;
  now: number;
  onRetry: () => void;
  onOpenSettings: () => void;
}): ReactElement | null {
  const key = JSON.stringify([errors, lagging.map((l) => [l.siteId, l.message])]);
  const [dismissed, setDismissed] = useState<string | null>(null);
  if ((errors.length === 0 && lagging.length === 0) || dismissed === key) return null;
  const label = (id: string): string => sites.find((s) => s.id === id)?.label ?? id;
  const failed = errors.length + lagging.length;
  let title: string;
  if (errors.length === 0) title = `${failed === 1 ? "A site" : `${failed} sites`} couldn't update; showing earlier tickets.`;
  else if (errors.length >= attempted) title = `${attempted === 1 ? "The site" : "All sites"} failed to load.`;
  else title = `${failed === 1 ? "1 site" : `${failed} sites`} failed to load; showing the rest.`;
  return (
    <div className="banner error actionable" role="alert">
      <div className="banner-text">
        <strong>{title}</strong>
        <ul>
          {errors.map((e) => (
            <li key={e.siteId}>{siteErrorText(label(e.siteId), e.message)}</li>
          ))}
          {lagging.map((l) => (
            <li key={l.siteId}>
              {siteErrorText(label(l.siteId), l.message)} <span className="muted">({shownFrom(l.takenAt, now)})</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="banner-actions">
        <button type="button" onClick={onRetry}>
          Retry
        </button>
        <button type="button" onClick={onOpenSettings}>
          Open Settings
        </button>
        <button
          type="button"
          onClick={() => {
            setDismissed(key);
          }}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
