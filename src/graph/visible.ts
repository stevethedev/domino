import type { Graph, GraphEdge, GraphNode, LinkKind } from "./types";

export type LinkFilters = Readonly<Record<LinkKind, boolean> & { crossSite: boolean }>;

/** Edges that pass the filter panel, plus the nodes worth showing (ghosts only when still connected). */
export function visibleSubgraph(graph: Graph, filters: LinkFilters): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const edges = graph.edges.filter((e) => filters[e.kind] && (filters.crossSite || !e.crossSite));
  const touched = new Set(edges.flatMap((e) => [e.source, e.target]));
  const nodes = graph.nodes.filter((n) => !n.ghost || touched.has(n.uid));
  const uids = new Set(nodes.map((n) => n.uid));
  return { nodes, edges: edges.filter((e) => uids.has(e.source) && uids.has(e.target)) };
}
