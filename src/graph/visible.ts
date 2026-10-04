import type { Graph, GraphEdge, GraphNode, LinkKind, StatusCategory } from "./types";

export type LinkFilters = Readonly<Record<LinkKind, boolean> & { crossSite: boolean }>;

/**
 * Which issues to hide from the views. Each list names what's hidden (empty = show all), so new
 * assignees or types arriving with a refresh show up instead of being silently filtered out.
 */
export type IssueFilters = Readonly<{
  hiddenCategories: readonly StatusCategory[];
  hiddenTypes: readonly string[];
  /** Assignee display names; `UNASSIGNED` for issues with no assignee. */
  hiddenAssignees: readonly string[];
  /** Priority names; `NO_PRIORITY` for issues with no priority. */
  hiddenPriorities: readonly string[];
}>;

export const UNASSIGNED = "";
export const NO_PRIORITY = "";
export const NO_ISSUE_FILTERS: IssueFilters = { hiddenCategories: [], hiddenTypes: [], hiddenAssignees: [], hiddenPriorities: [] };

/**
 * `hideImplied`: drop blocking links a longer drawn chain already implies (A→C when A→B→C is drawn).
 */
export type ViewFilters = LinkFilters & Readonly<{ issues: IssueFilters; hideImplied: boolean }>;

export const hasIssueFilters = (f: IssueFilters): boolean =>
  f.hiddenCategories.length > 0 || f.hiddenTypes.length > 0 || f.hiddenAssignees.length > 0 || f.hiddenPriorities.length > 0;

/**
 * Whether an issue passes the issue filters. Epic-map summary cards always do (they stand for many
 * issues). Ghosts have no loaded assignee and often no priority, so only status and type apply to
 * them (the assignee and priority menus list only loaded issues' values).
 */
export function passesIssueFilters(n: GraphNode, f: IssueFilters): boolean {
  if (n.rollup) return true;
  if (f.hiddenCategories.includes(n.statusCategory) || f.hiddenTypes.includes(n.issueType)) return false;
  if (n.ghost) return true;
  return !f.hiddenAssignees.includes(n.assigneeName ?? UNASSIGNED) && !f.hiddenPriorities.includes(n.priority?.name ?? NO_PRIORITY);
}

/**
 * Blocking links that a longer chain of drawn blocking links already implies: A→C is implied when
 * C can be reached from A through at least one other drawn issue (A→B→…→C), so drawing it adds
 * nothing (a transitive reduction). Links in a blocking cycle are always kept, and chains run
 * only through the cycle-free part of the graph (`brokenEdgeIds` removed), where the reduction
 * is unique. Only the drawn `edges` count: if B is hidden, A→C is no longer implied.
 */
export function impliedEdgeIds(edges: readonly GraphEdge[], graph: Pick<Graph, "cycleEdgeIds" | "brokenEdgeIds">): Set<string> {
  const chainEdges = edges.filter((e) => e.kind === "blocks" && e.source !== e.target && !graph.brokenEdgeIds.has(e.id));
  const next = new Map<string, Set<string>>();
  for (const e of chainEdges) next.set(e.source, (next.get(e.source) ?? new Set()).add(e.target));
  /** Whether `to` is reachable from `from` by a path that doesn't start with the direct link. */
  const reachableAround = (from: string, to: string): boolean => {
    const queue = [...(next.get(from) ?? [])].filter((n) => n !== to);
    const seen = new Set(queue);
    for (let v = queue.shift(); v !== undefined; v = queue.shift()) {
      for (const w of next.get(v) ?? []) {
        if (w === to) return true;
        if (!seen.has(w)) {
          seen.add(w);
          queue.push(w);
        }
      }
    }
    return false;
  };
  return new Set(chainEdges.filter((e) => !graph.cycleEdgeIds.has(e.id) && reachableAround(e.source, e.target)).map((e) => e.id));
}

/**
 * What the views draw: issues that pass the issue filters, links that pass the link filters and
 * join two drawn issues, and ghosts only while a drawn link still touches them (so hiding an
 * issue also drops ghosts that were only there through it). With `hideImplied`, blocking links a
 * longer drawn chain implies are left out too (`implied` counts them). Display only: the
 * insights and the timeline's schedule still use the whole graph.
 */
export type VisibleSubgraph = Readonly<{ nodes: readonly GraphNode[]; edges: readonly GraphEdge[]; implied: number }>;

// The graph, the timeline and the sidebar's counts all ask for the same graph and filters; the
// implied-link reduction is the costly part, so results are shared per graph (dropped with it).
const cache = new WeakMap<Graph, Map<string, VisibleSubgraph>>();

export function visibleSubgraph(graph: Graph, filters: ViewFilters): VisibleSubgraph {
  const key = JSON.stringify(filters);
  const byFilters = cache.get(graph) ?? new Map<string, VisibleSubgraph>();
  cache.set(graph, byFilters);
  const hit = byFilters.get(key);
  if (hit) return hit;
  const result = computeVisible(graph, filters);
  byFilters.set(key, result);
  return result;
}

function computeVisible(graph: Graph, filters: ViewFilters): VisibleSubgraph {
  const passing = new Set(graph.nodes.filter((n) => passesIssueFilters(n, filters.issues)).map((n) => n.uid));
  const edges = graph.edges.filter(
    (e) => filters[e.kind] && (filters.crossSite || !e.crossSite) && passing.has(e.source) && passing.has(e.target),
  );
  const touched = new Set(edges.flatMap((e) => [e.source, e.target]));
  const nodes = graph.nodes.filter((n) => passing.has(n.uid) && (!n.ghost || touched.has(n.uid)));
  const uids = new Set(nodes.map((n) => n.uid));
  const drawn = edges.filter((e) => uids.has(e.source) && uids.has(e.target));
  // An implied link's endpoints keep the links of the chain that implies it, so no node is orphaned.
  const implied = filters.hideImplied ? impliedEdgeIds(drawn, graph) : new Set<string>();
  return { nodes, edges: drawn.filter((e) => !implied.has(e.id)), implied: implied.size };
}
