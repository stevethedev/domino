import { AGING_DEFAULTS, computeAging, type Aging } from "./aging";
import { criticalPath, openBlockerCounts, readyIssues, type Chain } from "./analysis";
import type { ChangeKind } from "./changes";
import type { Day, StatusHistory } from "./schedule";
import type { Graph, GraphNode } from "./types";
import { getOrThrow, isOneOf } from "../lib/guards";

/** What the user asked to emphasize; everything else dims. */
export type Highlight = "none" | "blocked" | "ready" | "critical" | "aging" | "changed";
const HIGHLIGHTS: readonly Highlight[] = ["none", "blocked", "ready", "critical", "aging", "changed"];
export const isHighlight = isOneOf(HIGHLIGHTS);

/** The at-a-glance answers, computed once per graph and shared by both views. */
export type Insights = {
  /** In-scope, not-Done issues with at least one open blocker. */
  blocked: ReadonlySet<string>;
  /** In-scope, not-Done issues with no open blockers. */
  ready: ReadonlySet<string>;
  critical: Chain;
  openBlockers: ReadonlyMap<string, number>;
  cycleCount: number;
  /** Open issues whose completion unblocks the most open work, biggest impact first. */
  unblockers: readonly Unblocker[];
  /** Per assignee name: distinct open issues of *other* people waiting downstream of theirs. */
  holdingUpByAssignee: ReadonlyMap<string, number>;
  /** Stuck or long-waiting open work; empty until status history has loaded. */
  aging: ReadonlyMap<string, Aging>;
  /** What changed per issue since the scope was last marked seen; empty until compared. */
  changed: ReadonlyMap<string, readonly ChangeKind[]>;
};

/** Inputs for aging; without history, aging is simply empty. */
export type InsightOptions = { history: StatusHistory; today: Day; daysPerPoint: number; defaultDays: number };

export type Unblocker = {
  uid: string;
  /** Distinct open, in-scope issues downstream through blocks edges (any site, any depth). */
  downstream: number;
  /** Sites those downstream issues live on. */
  sites: number;
};

const TOP_UNBLOCKERS = 5;

const isOpenInScope = (n: GraphNode | undefined): n is GraphNode => !!n && !n.ghost && n.statusCategory !== "done";

/** Distinct open, in-scope issues reachable downstream of each open issue through blocks edges. */
export function downstreamOpen(graph: Graph): Map<string, Set<string>> {
  const byUid = new Map(graph.nodes.map((n) => [n.uid, n]));
  const next = new Map<string, string[]>();
  for (const e of graph.edges) {
    if (e.kind !== "blocks" || e.source === e.target) continue;
    next.set(e.source, [...(next.get(e.source) ?? []), e.target]);
  }
  const out = new Map<string, Set<string>>();
  for (const n of graph.nodes) {
    if (!isOpenInScope(n)) continue;
    const seen = new Set<string>([n.uid]);
    const queue = [n.uid];
    const reached = new Set<string>();
    for (let v = queue.shift(); v !== undefined; v = queue.shift()) {
      for (const t of next.get(v) ?? []) {
        if (seen.has(t)) continue; // also terminates cycles
        seen.add(t);
        queue.push(t);
        if (isOpenInScope(byUid.get(t))) reached.add(t);
      }
    }
    out.set(n.uid, reached);
  }
  return out;
}

function rankUnblockers(graph: Graph, downstream: Map<string, Set<string>>): Unblocker[] {
  const byUid = new Map(graph.nodes.map((n) => [n.uid, n]));
  return [...downstream]
    .filter(([, d]) => d.size > 0)
    .map(([uid, d]) => ({ uid, downstream: d.size, sites: new Set([...d].map((u) => getOrThrow(byUid, u).siteId)).size }))
    .sort((a, b) => b.downstream - a.downstream || b.sites - a.sites || a.uid.localeCompare(b.uid))
    .slice(0, TOP_UNBLOCKERS);
}

/** For each person: other people's open issues that wait on that person's open issues. */
function holdingUp(graph: Graph, downstream: Map<string, Set<string>>): Map<string, number> {
  const byUid = new Map(graph.nodes.map((n) => [n.uid, n]));
  const waiting = new Map<string, Set<string>>();
  for (const [uid, reached] of downstream) {
    const owner = getOrThrow(byUid, uid).assigneeName;
    if (!owner) continue;
    let set = waiting.get(owner);
    if (!set) waiting.set(owner, (set = new Set()));
    for (const r of reached) if (getOrThrow(byUid, r).assigneeName !== owner) set.add(r);
  }
  return new Map([...waiting].filter(([, s]) => s.size > 0).map(([name, s]) => [name, s.size]));
}

export function computeInsights(graph: Graph, opts?: InsightOptions): Insights {
  const openBlockers = openBlockerCounts(graph);
  const blocked = new Set(
    graph.nodes.filter((n) => !n.ghost && n.statusCategory !== "done" && (openBlockers.get(n.uid) ?? 0) > 0).map((n) => n.uid),
  );
  const downstream = downstreamOpen(graph);
  return {
    blocked,
    ready: readyIssues(graph),
    critical: criticalPath(graph),
    openBlockers,
    cycleCount: graph.cycles.length,
    unblockers: rankUnblockers(graph, downstream),
    holdingUpByAssignee: holdingUp(graph, downstream),
    aging: opts ? computeAging(graph, opts.history, openBlockers, { ...opts, ...AGING_DEFAULTS }) : new Map(),
    changed: new Map(),
  };
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
    case "aging":
      return { nodes: new Set(insights.aging.keys()), edges: new Set() };
    case "changed":
      return { nodes: new Set(insights.changed.keys()), edges: new Set() };
  }
}
