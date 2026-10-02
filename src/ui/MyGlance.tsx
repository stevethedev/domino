import type { ReactElement } from "react";
import type { SiteConfig } from "../config/types";
import type { Highlight, Insights } from "../graph/insights";
import type { GraphNode } from "../graph/types";
import type { MyselfState } from "../state/useMyself";
import { InsightTiles } from "./InsightsBar";
import { SidebarSection } from "./SidebarSection";

const COPY = {
  assigned: { title: "Assigned to me", none: "Nothing in this scope is assigned to you." },
  reported: { title: "Reported by me", none: "You haven't reported anything in this scope." },
} as const;

/** "At a glance", narrowed to the signed-in user's issues: assigned to them, or reported by them. */
export function MyGlance({
  scope,
  insights,
  nodes,
  myself,
  sites,
  highlight,
  onHighlight,
}: {
  scope: "assigned" | "reported";
  insights: Insights;
  nodes: ReadonlyMap<string, GraphNode>;
  myself: MyselfState;
  sites: readonly SiteConfig[];
  /** The active highlight when it's scoped to these issues, else "none". */
  highlight: Highlight;
  onHighlight: (h: Highlight) => void;
}): ReactElement {
  const copy = COPY[scope];
  const only = insights.mine[scope];
  const open = [...only].filter((uid) => nodes.get(uid)?.statusCategory !== "done").length;
  const labelOf = (siteId: string): string => sites.find((s) => s.id === siteId)?.label ?? siteId;
  const unknownOn = myself.errors.map((e) => labelOf(e.siteId));
  const summary = myself.loading && only.size === 0 ? "Finding you on each site…" : only.size === 0 ? copy.none : `${only.size} ${only.size === 1 ? "issue" : "issues"} · ${open} open`;
  return (
    <SidebarSection id={`mine-${scope}`} title={copy.title} badge={only.size ? open : undefined}>
      <InsightTiles summary={summary} insights={insights} highlight={highlight} onHighlight={onHighlight} only={only} />
      {unknownOn.length > 0 && (
        <p className="hint" title={myself.errors.map((e) => `${labelOf(e.siteId)}: ${e.message}`).join("\n")}>
          Couldn't tell who you are on {unknownOn.join(", ")}, so issues there aren't counted.
        </p>
      )}
    </SidebarSection>
  );
}
