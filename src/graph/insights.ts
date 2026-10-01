import { criticalPath, openBlockerCounts, readyIssues, type Chain } from "./analysis";
import type { Graph } from "./types";

/** What the user asked to emphasize; everything else dims. */
export type Highlight = "none" | "blocked" | "ready" | "critical";
export const HIGHLIGHTS: readonly Highlight[] = ["none", "blocked", "ready", "critical"];
export const isHighlight = (v: string): v is Highlight => (HIGHLIGHTS as readonly string[]).includes(v);

/** The at-a-glance answers, computed once per graph and shared by both views. */
export type Insights = {
  /** In-scope, not-Done issues with at least one open blocker. */
  blocked: ReadonlySet<string>;
  /** In-scope, not-Done issues with no open blockers. */
  ready: ReadonlySet<string>;
  critical: Chain;
  openBlockers: ReadonlyMap<string, number>;
  cycleCount: number;
};

export function computeInsights(graph: Graph): Insights {
  const openBlockers = openBlockerCounts(graph);
  const blocked = new Set(
    graph.nodes.filter((n) => !n.ghost && n.statusCategory !== "done" && (openBlockers.get(n.uid) ?? 0) > 0).map((n) => n.uid),
  );
  return { blocked, ready: readyIssues(graph), critical: criticalPath(graph), openBlockers, cycleCount: graph.cycles.length };
}

/** Nodes and edges to keep at full strength for a highlight; `null` means nothing dims. */
export function emphasis(h: Highlight, insights: Insights): { nodes: ReadonlySet<string>; edges: ReadonlySet<string> } | null {
  switch (h) {
    case "none":
      return null;
    case "blocked":
      return { nodes: insights.blocked, edges: new Set() };
    case "ready":
      return { nodes: insights.ready, edges: new Set() };
    case "critical":
      return { nodes: new Set(insights.critical.nodes), edges: new Set(insights.critical.edges) };
  }
}
