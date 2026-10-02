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
}>;

export const UNASSIGNED = "";
export const NO_ISSUE_FILTERS: IssueFilters = { hiddenCategories: [], hiddenTypes: [], hiddenAssignees: [] };

export type ViewFilters = LinkFilters & Readonly<{ issues: IssueFilters }>;

export const hasIssueFilters = (f: IssueFilters): boolean =>
  f.hiddenCategories.length > 0 || f.hiddenTypes.length > 0 || f.hiddenAssignees.length > 0;

/**
 * Whether an issue passes the issue filters. Epic-map summary cards always do (they stand for many
 * issues). Ghosts have no loaded assignee, so only status and type apply to them.
 */
export function passesIssueFilters(n: GraphNode, f: IssueFilters): boolean {
  if (n.rollup) return true;
  if (f.hiddenCategories.includes(n.statusCategory) || f.hiddenTypes.includes(n.issueType)) return false;
  return n.ghost || !f.hiddenAssignees.includes(n.assigneeName ?? UNASSIGNED);
}

/**
 * What the views draw: issues that pass the issue filters, links that pass the link filters and
 * join two drawn issues, and ghosts only while a drawn link still touches them (so hiding an
 * issue also drops ghosts that were only there through it). Display only: the
 * insights and the timeline's schedule still use the whole graph.
 */
export function visibleSubgraph(graph: Graph, filters: ViewFilters): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const passing = new Set(graph.nodes.filter((n) => passesIssueFilters(n, filters.issues)).map((n) => n.uid));
  const edges = graph.edges.filter(
    (e) => filters[e.kind] && (filters.crossSite || !e.crossSite) && passing.has(e.source) && passing.has(e.target),
  );
  const touched = new Set(edges.flatMap((e) => [e.source, e.target]));
  const nodes = graph.nodes.filter((n) => passing.has(n.uid) && (!n.ghost || touched.has(n.uid)));
  const uids = new Set(nodes.map((n) => n.uid));
  return { nodes, edges: edges.filter((e) => uids.has(e.source) && uids.has(e.target)) };
}
