import { useId, type ReactElement, type ReactNode } from "react";
import type { SiteConfig } from "../config/types";
import type { Highlight, HighlightScope, Insights } from "../graph/insights";
import type { GraphNode } from "../graph/types";
import type { MyselfState } from "../state/useMyself";
import { InfoTip } from "./InfoTip";
import { InsightTiles } from "./InsightsBar";

const SCOPES: readonly { id: HighlightScope; label: string; means: string; none: string }[] = [
  { id: "all", label: "Everyone", means: "every ticket in scope", none: "" },
  { id: "assigned", label: "Assigned", means: "tickets assigned to you", none: "Nothing in this scope is assigned to you." },
  { id: "reported", label: "Reported", means: "tickets you reported", none: "You haven't reported anything in this scope." },
];

/**
 * "At a glance": the insight tiles for everyone's issues, or just the signed-in user's (assigned
 * to them, or reported by them). A tile's highlight covers the scope it was clicked in.
 */
export function Glance({
  scope,
  onScope,
  loaded,
  everyoneSummary,
  insights,
  nodes,
  myself,
  sites,
  highlightFor,
  onHighlight,
  drawn,
}: {
  scope: HighlightScope;
  onScope: (s: HighlightScope) => void;
  /** Whether a load has finished; until then every scope shows the load status. */
  loaded: boolean;
  /** The load summary shown for everyone ("12 issues · 6 outside scope · updated …"). */
  everyoneSummary: ReactNode;
  insights: Insights;
  nodes: ReadonlyMap<string, GraphNode>;
  myself: MyselfState;
  sites: readonly SiteConfig[];
  /** The active highlight if it belongs to `scope`, else "none". */
  highlightFor: (scope: HighlightScope) => Highlight;
  onHighlight: (scope: HighlightScope, h: Highlight) => void;
  /** While Display filters are on: the issues they leave on screen. */
  drawn?: ReadonlySet<string>;
}): ReactElement {
  const name = useId();
  const scopeTipId = `${name}-tip`;
  const errorsTipId = `${name}-errors`;
  const only = scope === "all" ? undefined : insights.mine[scope];
  const current = SCOPES.find((s) => s.id === scope) ?? SCOPES[0];
  const labelOf = (siteId: string): string => sites.find((s) => s.id === siteId)?.label ?? siteId;
  let summary: ReactNode = everyoneSummary;
  if (only) {
    const open = [...only].filter((uid) => nodes.get(uid)?.statusCategory !== "done").length;
    summary = !loaded
      ? everyoneSummary
      : myself.loading && only.size === 0
        ? "Finding you on each site…"
        : only.size === 0
          ? current.none
          : `${only.size} ${only.size === 1 ? "ticket" : "tickets"} · ${open} open`;
  }
  return (
    <>
      <div className="label-with-tip has-tip">
        <fieldset className="segmented glance-scope" aria-describedby={scopeTipId}>
          <legend className="sr-only">Whose tickets</legend>
          {SCOPES.map((s) => (
            <label key={s.id} className={scope === s.id ? "active" : ""}>
              <input
                type="radio"
                name={name}
                value={s.id}
                checked={scope === s.id}
                onChange={() => {
                  onScope(s.id);
                }}
              />
              {s.label}
            </label>
          ))}
        </fieldset>
        <InfoTip id={scopeTipId} label="whose tickets" inline>
          <ul className="tip-list">
            {SCOPES.map((s) => (
              <li key={s.id}>
                <strong>{s.label}:</strong> {s.means}
              </li>
            ))}
          </ul>
        </InfoTip>
      </div>
      <InsightTiles
        summary={summary}
        insights={insights}
        highlight={highlightFor(scope)}
        onHighlight={(h) => {
          onHighlight(scope, h);
        }}
        only={only}
        drawn={drawn}
      />
      {only && myself.errors.length > 0 && (
        <div className="hint label-with-tip has-tip">
          <span>
            Couldn&apos;t tell who you are on {myself.errors.map((e) => labelOf(e.siteId)).join(", ")}, so tickets there aren&apos;t
            counted.
          </span>
          <InfoTip id={errorsTipId} label="the errors" inline>
            <ul className="tip-list">
              {myself.errors.map((e) => (
                <li key={e.siteId}>
                  <strong>{labelOf(e.siteId)}:</strong> {e.message}
                </li>
              ))}
            </ul>
          </InfoTip>
        </div>
      )}
    </>
  );
}
