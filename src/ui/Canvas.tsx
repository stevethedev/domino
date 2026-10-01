import { Background, Controls, MiniMap, ReactFlow, useReactFlow } from "@xyflow/react";
import { useEffect, useMemo, useState } from "react";
import { blockingChain } from "../graph/analysis";
import { emphasis, type Highlight, type Insights } from "../graph/insights";
import { CARD_HEIGHT, CARD_WIDTH, computeLayout, laneByAssignee, laneByEpic, laneBySite, type LaneFn, type Layout } from "../graph/layout";
import type { Graph, LinkKind } from "../graph/types";
import { visibleSubgraph } from "../graph/visible";
import { openExternal } from "../platform";
import { LinkEdge, type LinkFlowEdge } from "./edges/LinkEdge";
import { IssueCard, SiteGroup, type IssueFlowNode, type SiteGroupNode } from "./IssueCard";

export type Filters = Record<LinkKind, boolean> & { crossSite: boolean };
export const GROUP_BY = ["none", "site", "epic", "assignee"] as const;
export type GroupBy = (typeof GROUP_BY)[number];
export const isGroupBy = (v: string): v is GroupBy => (GROUP_BY as readonly string[]).includes(v);
export type ViewOptions = { groupBy: GroupBy; highlight: Highlight };

/** The lane function for a Group by choice; assignee lanes need the insights for their labels. */
export function lanesFor(groupBy: GroupBy, insights: Insights): LaneFn | undefined {
  switch (groupBy) {
    case "none":
      return undefined;
    case "site":
      return laneBySite;
    case "epic":
      return laneByEpic;
    case "assignee":
      return laneByAssignee(insights.holdingUpByAssignee);
  }
}

const nodeTypes = { issue: IssueCard, siteGroup: SiteGroup };
type FlowNode = IssueFlowNode | SiteGroupNode;
const edgeTypes = { link: LinkEdge };

type MarkerKind = "edge" | "cycle" | "critical";
const MARKER_KINDS: readonly MarkerKind[] = ["edge", "cycle", "critical"];
const markerId = (k: MarkerKind) => `domino-arrow-${k}`;

/** Arrowheads styled by CSS classes, so they follow the theme (React Flow's built-in markers take a fixed color). */
function ArrowMarkers() {
  return (
    <svg className="arrow-defs" aria-hidden="true">
      <defs>
        {MARKER_KINDS.map((k) => (
          <marker key={k} id={markerId(k)} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" className={`arrowhead arrowhead-${k}`} />
          </marker>
        ))}
      </defs>
    </svg>
  );
}

export function Canvas({
  graph,
  insights,
  filters,
  view,
  showSiteBadges,
}: {
  graph: Graph;
  insights: Insights;
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
    computeLayout(vNodes, vEdges, graph.brokenEdgeIds, lanesFor(view.groupBy, insights)).then((l) => {
      if (cancelled) return;
      setLayout(l);
      // Never zoom in past 100%: a small graph should look like cards, not a poster.
      requestAnimationFrame(() => rf.fitView({ padding: 0.2, maxZoom: 1, duration: 250 }));
    });
    return () => {
      cancelled = true;
    };
  }, [vNodes, vEdges, graph.brokenEdgeIds, view.groupBy, insights, rf]);

  const emphasized = useMemo(() => emphasis(view.highlight, insights), [view.highlight, insights]);
  const chain = useMemo(() => (hovered ? blockingChain(graph, hovered) : null), [graph, hovered]);
  const byUid = useMemo(() => new Map(graph.nodes.map((n) => [n.uid, n])), [graph]);

  const flowNodes = useMemo<FlowNode[]>(() => {
    if (!layout) return [];
    const groups: SiteGroupNode[] = layout.groups.map((g) => ({
      id: g.id,
      type: "siteGroup",
      position: { x: g.x, y: g.y },
      data: { label: g.label, color: g.color, url: g.url, onOpen: openExternal },
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
      const isEmphasized = emphasized?.nodes.has(n.uid) ?? false;
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
            openBlockers: insights.openBlockers.get(n.uid) ?? 0,
            showSite: showSiteBadges,
            dimmed: chain ? !chain.nodes.has(n.uid) : emphasized ? !isEmphasized : false,
            highlight: isEmphasized && view.highlight !== "none" ? view.highlight : null,
            onOpen: openExternal,
            onHover: setHovered,
          },
          draggable: false,
          focusable: false, // the card itself is the tab stop
        },
      ];
    });
    return [...groups, ...cards];
  }, [layout, vNodes, insights, showSiteBadges, chain, emphasized, view.highlight]);

  const flowEdges = useMemo<LinkFlowEdge[]>(() => {
    return vEdges.map((e) => {
      const inCycle = graph.cycleEdgeIds.has(e.id);
      const isCritical = view.highlight === "critical" && (emphasized?.edges.has(e.id) ?? false);
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        type: "link",
        focusable: false,
        selectable: false,
        markerEnd: e.kind === "blocks" ? markerId(inCycle ? "cycle" : isCritical ? "critical" : "edge") : undefined,
        zIndex: inCycle || isCritical ? 1 : 0,
        data: {
          edge: e,
          inCycle,
          sourceDone: byUid.get(e.source)?.statusCategory === "done",
          dimmed: chain ? !chain.edges.has(e.id) : emphasized ? !isCritical : false,
          critical: isCritical,
          back: graph.brokenEdgeIds.has(e.id),
        },
      };
    });
  }, [vEdges, graph.cycleEdgeIds, graph.brokenEdgeIds, byUid, chain, emphasized, view.highlight]);

  return (
    <>
    <ArrowMarkers />
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
      <MiniMap<FlowNode>
        pannable
        style={{ width: 170, height: 110 }}
        zoomable
        ariaLabel="Minimap, tinted by site"
        nodeColor={(n) => (n.type === "issue" ? n.data.node.siteColor ?? "#9ca3af" : "transparent")}
        nodeStrokeColor={(n) => (n.type === "siteGroup" ? n.data.color ?? "#9ca3af" : "transparent")}
      />
    </ReactFlow>
    </>
  );
}

/** Centers the viewport on a card and focuses it (used by the Warnings panel). */
export function useFocusNode() {
  const rf = useReactFlow();
  return (uid: string) => {
    const n = rf.getInternalNode(uid);
    if (!n) return;
    const { x, y } = n.internals.positionAbsolute;
    rf.setCenter(x + (n.measured.width ?? CARD_WIDTH) / 2, y + (n.measured.height ?? CARD_HEIGHT) / 2, { zoom: 1.1, duration: 300 });
    const el = document.querySelector<HTMLElement>(`[data-uid="${CSS.escape(uid)}"]`);
    el?.focus({ preventScroll: true });
  };
}
