import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  useReactFlow,
  type Node,
} from "@xyflow/react";
import { useEffect, useMemo, useState } from "react";
import { blockingChain, criticalPath, openBlockerCounts, readyIssues } from "../graph/analysis";
import { CARD_HEIGHT, CARD_WIDTH, computeLayout, laneByEpic, laneBySite, type Layout } from "../graph/layout";
import type { Graph, GraphEdge, GraphNode, LinkKind } from "../graph/types";
import { openIssue } from "../platform";
import { LinkEdge, type LinkFlowEdge } from "./edges/LinkEdge";
import { IssueCard, SiteGroup, type IssueFlowNode, type SiteGroupNode } from "./IssueCard";

export type Filters = Record<LinkKind, boolean> & { crossSite: boolean };
export type GroupBy = "none" | "site" | "epic";
export type ViewOptions = { groupBy: GroupBy; criticalPath: boolean; ready: boolean };

const LANES = { none: undefined, site: laneBySite, epic: laneByEpic } as const;

const nodeTypes = { issue: IssueCard, siteGroup: SiteGroup };
const edgeTypes = { link: LinkEdge };

const CSS_VAR = (name: string) =>
  typeof window === "undefined" ? "#555" : getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#555";

/** Edges that pass the filter panel, plus the nodes worth showing (ghosts only when still connected). */
export function visibleSubgraph(graph: Graph, filters: Filters): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const edges = graph.edges.filter((e) => filters[e.kind] && (filters.crossSite || !e.crossSite));
  const touched = new Set(edges.flatMap((e) => [e.source, e.target]));
  const nodes = graph.nodes.filter((n) => !n.ghost || touched.has(n.uid));
  const uids = new Set(nodes.map((n) => n.uid));
  return { nodes, edges: edges.filter((e) => uids.has(e.source) && uids.has(e.target)) };
}

export function Canvas({
  graph,
  filters,
  view,
  showSiteBadges,
}: {
  graph: Graph;
  filters: Filters;
  view: ViewOptions;
  showSiteBadges: boolean;
}) {
  const rf = useReactFlow();
  const [hovered, setHovered] = useState<string | null>(null);
  const [layout, setLayout] = useState<Layout | null>(null);

  const { nodes: vNodes, edges: vEdges } = useMemo(() => visibleSubgraph(graph, filters), [graph, filters]);

  useEffect(() => {
    let cancelled = false;
    computeLayout(vNodes, vEdges, graph.brokenEdgeIds, LANES[view.groupBy]).then((l) => {
      if (cancelled) return;
      setLayout(l);
      requestAnimationFrame(() => rf.fitView({ padding: 0.2, duration: 250 }));
    });
    return () => {
      cancelled = true;
    };
  }, [vNodes, vEdges, graph.brokenEdgeIds, view.groupBy, rf]);

  const blockers = useMemo(() => openBlockerCounts(graph), [graph]);
  const critical = useMemo(() => (view.criticalPath ? criticalPath(graph) : null), [graph, view.criticalPath]);
  const ready = useMemo(() => (view.ready ? readyIssues(graph) : null), [graph, view.ready]);
  const chain = useMemo(() => (hovered ? blockingChain(graph, hovered) : null), [graph, hovered]);
  const byUid = useMemo(() => new Map(graph.nodes.map((n) => [n.uid, n])), [graph]);

  const flowNodes = useMemo<Node[]>(() => {
    if (!layout) return [];
    const criticalSet = new Set(critical?.nodes ?? []);
    const emphasis = critical || ready ? new Set([...criticalSet, ...(ready ?? [])]) : null;
    const groups: SiteGroupNode[] = layout.groups.map((g) => ({
      id: g.id,
      type: "siteGroup",
      position: { x: g.x, y: g.y },
      data: { label: g.label, color: g.color, url: g.url, onOpen: openIssue },
      width: g.width,
      height: g.height,
      selectable: false,
      focusable: false,
      draggable: false,
      zIndex: -1,
    }));
    const cards: IssueFlowNode[] = vNodes.flatMap((n) => {
      const pos = layout.positions.get(n.uid);
      if (!pos) return [];
      const isCrit = criticalSet.has(n.uid);
      const isReady = ready?.has(n.uid) ?? false;
      return [
        {
          id: n.uid,
          type: "issue",
          position: { x: pos.x, y: pos.y },
          width: CARD_WIDTH,
          height: CARD_HEIGHT,
          parentId: pos.parent,
          data: {
            node: n,
            openBlockers: blockers.get(n.uid) ?? 0,
            showSite: showSiteBadges,
            dimmed: chain ? !chain.nodes.has(n.uid) : emphasis ? !emphasis.has(n.uid) : false,
            highlight: isCrit && isReady ? "both" : isCrit ? "critical" : isReady ? "ready" : null,
            onOpen: openIssue,
            onHover: setHovered,
          },
          draggable: false,
          focusable: false, // the card itself is the tab stop
        },
      ];
    });
    return [...groups, ...cards];
  }, [layout, vNodes, blockers, showSiteBadges, chain, critical, ready]);

  const flowEdges = useMemo<LinkFlowEdge[]>(() => {
    const criticalEdges = new Set(critical?.edges ?? []);
    const emphasis = critical || ready;
    const colors = { edge: CSS_VAR("--edge"), cycle: CSS_VAR("--cycle"), critical: CSS_VAR("--critical") };
    return vEdges.map((e) => {
      const inCycle = graph.cycleEdgeIds.has(e.id);
      const isCritical = criticalEdges.has(e.id);
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        type: "link",
        focusable: false,
        selectable: false,
        markerEnd:
          e.kind === "blocks"
            ? { type: MarkerType.ArrowClosed, width: 18, height: 18, color: inCycle ? colors.cycle : isCritical ? colors.critical : colors.edge }
            : undefined,
        zIndex: inCycle || isCritical ? 1 : 0,
        data: {
          edge: e,
          inCycle,
          sourceDone: byUid.get(e.source)?.statusCategory === "done",
          dimmed: chain ? !chain.edges.has(e.id) : emphasis ? !isCritical : false,
          critical: isCritical,
          back: graph.brokenEdgeIds.has(e.id),
        },
      };
    });
  }, [vEdges, graph.cycleEdgeIds, graph.brokenEdgeIds, byUid, chain, critical, ready]);

  return (
    <ReactFlow
      nodes={flowNodes}
      edges={flowEdges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      nodesConnectable={false}
      nodesDraggable={false}
      elementsSelectable={false}
      nodesFocusable={false}
      edgesFocusable={false}
      minZoom={0.1}
      maxZoom={2}
      fitView
    >
      <Background gap={24} size={1} />
      <Controls showInteractive={false} position="bottom-left" />
      <MiniMap
        pannable
        style={{ width: 170, height: 110 }}
        zoomable
        ariaLabel="Minimap, tinted by site"
        nodeColor={(n) => (n.type === "siteGroup" ? "transparent" : (n.data as { node: GraphNode }).node.siteColor ?? "#9ca3af")}
        nodeStrokeColor={(n) => (n.type === "siteGroup" ? ((n.data as { color?: string }).color ?? "#9ca3af") : "transparent")}
      />
    </ReactFlow>
  );
}

/** Centers the viewport on a card and focuses it (used by the Warnings panel). */
export function useFocusNode() {
  const rf = useReactFlow();
  return (uid: string) => {
    const n = rf.getInternalNode(uid);
    if (!n) return;
    const { x, y } = n.internals.positionAbsolute;
    rf.setCenter(x + (n.measured.width ?? 260) / 2, y + (n.measured.height ?? 112) / 2, { zoom: 1.1, duration: 300 });
    const el = document.querySelector<HTMLElement>(`[data-uid="${CSS.escape(uid)}"]`);
    el?.focus({ preventScroll: true });
  };
}
