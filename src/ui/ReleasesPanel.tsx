import type { ReactElement } from "react";
import type { ReleaseStatus } from "../graph/releases";
import { daysBetween, type Day } from "../graph/schedule";
import type { GraphNode } from "../graph/types";
import { fmtDay } from "./format";

/** "in 12 days", "today", "3 days overdue" for an unreleased date. */
function whenText(date: Day, today: Day): string {
  const days = daysBetween(today, date);
  if (days === 0) return "today";
  if (days > 0) return `in ${days} ${days === 1 ? "day" : "days"}`;
  return `${-days} ${days === -1 ? "day" : "days"} overdue`;
}

/**
 * Upcoming releases (Jira fix versions) in the loaded scope, soonest first: how much is still
 * open, and which open issues the schedule forecast puts after the release date. Picking one
 * shows it in the current view.
 */
export function ReleasesPanel({
  releases,
  nodes,
  today,
  showSite,
  onPick,
}: {
  releases: readonly ReleaseStatus[];
  nodes: ReadonlyMap<string, GraphNode>;
  today: Day;
  showSite: boolean;
  onPick: (uid: string) => void;
}): ReactElement {
  const upcoming = releases.filter((s) => !s.release.released);
  if (upcoming.length === 0) return <p className="hint">Every release in this scope has shipped.</p>;
  return (
    <ul className="releases">
      {upcoming.map((s) => {
        const { release } = s;
        const site = showSite ? nodes.get(s.issues[0] ?? "")?.siteLabel : undefined;
        const status =
          s.open.length === 0
            ? "All done"
            : `${s.open.length} open${release.date ? (s.atRisk.length ? ` · ${s.atRisk.length} at risk` : " · on track") : ""}`;
        return (
          <li key={release.uid} className={s.atRisk.length ? "at-risk" : undefined}>
            <div className="release-head">
              <span className="release-name">
                {release.name}
                {site && <span className="muted"> · {site}</span>}
              </span>
              <span className="release-when">
                {release.date ? (
                  <>
                    {fmtDay(release.date)} <span className="muted">({whenText(release.date, today)})</span>
                  </>
                ) : (
                  <span className="muted">No release date</span>
                )}
              </span>
            </div>
            <p className="release-status">
              {status}
              {s.forecastDone && release.date && s.atRisk.length > 0 && (
                <span className="muted"> · forecast done {fmtDay(s.forecastDone)}</span>
              )}
            </p>
            {s.atRisk.length > 0 && (
              <ul className="release-risks" aria-label={`Forecast to miss ${release.name}`}>
                {s.atRisk.map((uid) => {
                  const n = nodes.get(uid);
                  if (!n) return null;
                  return (
                    <li key={uid}>
                      <button
                        type="button"
                        className="link-btn"
                        onClick={() => {
                          onPick(uid);
                        }}
                        title={`${n.key}: ${n.summary}`}
                      >
                        <span className="card-key">{n.key}</span> <span className="release-risk-summary">{n.summary}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}
