import { useId, type ReactElement, type ReactNode } from "react";
import type { SiteConfig } from "../config/types";
import type { Highlight, HighlightScope, Insights } from "../graph/insights";
import type { GraphNode } from "../graph/types";
import type { MyselfState } from "../state/useMyself";
import { InsightTiles } from "./InsightsBar";

const SCOPES: readonly { id: HighlightScope; label: string; title: string; none: string }[] = [
  { id: "all", label: "Everyone", title: "Everyone's issues", none: "" },
  { id: "assigned", label: "Assigned", title: "Issues assigned to me", none: "Nothing in this scope is assigned to you." },
  { id: "reported", label: "Reported", title: "Issues I reported", none: "You haven't reported anything in this scope." },
];

/**
 * "At a glance": the insight tiles for everyone's issues, or just the signed-in user's (assigned
 * to them, or reported by them). A tile's highlight covers the scope it was clicked in.
 */
export function Glance({
  scope,
  onScope,
  everyoneSummary,
  insights,
  nodes,
  myself,
  sites,
  highlightFor,
  onHighlight,
}: {
  scope: HighlightScope;
  onScope: (s: HighlightScope) => void;
  /** The load summary shown for everyone ("12 issues · 6 outside scope · updated …"). */
  everyoneSummary: ReactNode;
  insights: Insights;
  nodes: ReadonlyMap<string, GraphNode>;
  myself: MyselfState;
  sites: readonly SiteConfig[];
  /** The active highlight if it belongs to `scope`, else "none". */
  highlightFor: (scope: HighlightScope) => Highlight;
  onHighlight: (scope: HighlightScope, h: Highlight) => void;
}): ReactElement {
  const name = useId();
  const only = scope === "all" ? undefined : insights.mine[scope];
  const current = SCOPES.find((s) => s.id === scope) ?? SCOPES[0];
  const labelOf = (siteId: string): string => sites.find((s) => s.id === siteId)?.label ?? siteId;
  let summary: ReactNode = everyoneSummary;
  if (only) {
    const open = [...only].filter((uid) => nodes.get(uid)?.statusCategory !== "done").length;
    summary =
      myself.loading && only.size === 0
        ? "Finding you on each site…"
        : only.size === 0
          ? current.none
          : `${only.size} ${only.size === 1 ? "issue" : "issues"} · ${open} open`;
  }
  return (
    <>
      <fieldset className="segmented glance-scope">
        <legend className="sr-only">Whose issues</legend>
        {SCOPES.map((s) => (
          <label key={s.id} className={scope === s.id ? "active" : ""} title={s.title}>
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
      <InsightTiles
        summary={summary}
        insights={insights}
        highlight={highlightFor(scope)}
        onHighlight={(h) => {
          onHighlight(scope, h);
        }}
        only={only}
      />
      {only && myself.errors.length > 0 && (
        <p className="hint" title={myself.errors.map((e) => `${labelOf(e.siteId)}: ${e.message}`).join("\n")}>
          Couldn't tell who you are on {myself.errors.map((e) => labelOf(e.siteId)).join(", ")}, so issues there aren't counted.
        </p>
      )}
    </>
  );
}
