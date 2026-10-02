import { Background, Controls, MiniMap, ReactFlow, useReactFlow } from "@xyflow/react";
import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { blockingChain } from "../graph/analysis";
import { collapseEpics, shownEdgeId } from "../graph/collapse";
import { emphasis, type Highlight, type HighlightScope, type Insights } from "../graph/insights";
import { CARD_HEIGHT, CARD_WIDTH, computeLayout, laneByAssignee, laneByEpic, laneBySite, type LaneFn, type Layout } from "../graph/layout";
import type { Graph } from "../graph/types";
import { visibleSubgraph, type ViewFilters } from "../graph/visible";
import { openExternal } from "../platform";
import { LinkEdge, type LinkFlowEdge } from "./edges/LinkEdge";
import { IssueCard, SiteGroup, type IssueFlowNode, type SiteGroupNode } from "./IssueCard";
import { isOneOf } from "../lib/guards";

/** Link and issue filters (display only; see visibleSubgraph). */
export type Filters = ViewFilters;
const GROUP_BY = ["none", "site", "epic", "assignee"] as const;
export type GroupBy = (typeof GROUP_BY)[number];
export const isGroupBy = isOneOf(GROUP_BY);
/** `highlightScope` narrows the highlight to the signed-in user's issues ("At a glance" for me). */
export type ViewOptions = { groupBy: GroupBy; highlight: Highlight; highlightScope: HighlightScope; collapseEpics: boolean };

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
const markerId = (k: MarkerKind): string => `domino-arrow-${k}`;

/** Arrowheads styled by CSS classes, so they follow the theme (React Flow's built-in markers take a fixed color). */
function ArrowMarkers(): ReactElement {
  return (
    <svg className="arrow-defs" aria-hidden="true">
      <defs>
        {MARKER_KINDS.map((k) => (
          <marker
            key={k}
            id={markerId(k)}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="9"
            markerHeight="9"
            orient="auto-start-reverse"
          >
            <path d="M0,0 L10,5 L0,10 z" className={`arrowhead arrowhead-${k}`} />
          </marker>
        ))}
      </defs>
    </svg>
  );
}

/** Lanes for the epic map: one per expanded epic (with a collapse action), the rest together. */
function epicMapLanes(expanded: ReadonlySet<string>): LaneFn | undefined {
  if (expanded.size === 0) return undefined;
  return (n) => {
    const epic = n.epic;
    if (!n.rollup && epic && expanded.has(epic.uid)) {
      return {
        id: `expanded:${epic.uid}`,
        label: epic.summary ? `${epic.key} · ${epic.summary}` : epic.key,
        url: epic.url,
        color: n.siteColor,
        collapseEpic: epic.uid,
      };
    }
    return { id: "epic-map", label: "Epics and other issues", last: true };
  };
}

export function Canvas({
  graph: loaded,
  insights,
  filters,
  view,
  showSiteBadges,
  expandedEpics,
  onToggleEpic,
  selectedUid,
  onSelect,
}: {
  graph: Graph;
  insights: Insights;
  filters: Filters;
  view: ViewOptions;
  showSiteBadges: boolean;
  /** Epics shown issue-by-issue while the epic map is on. */
  expandedEpics: ReadonlySet<string>;
  onToggleEpic: (epicUid: string) => void;
  /** The issue open in the details panel, if any. */
  selectedUid: string | null;
  onSelect: (uid: string) => void;
}): ReactElement {
  const rf = useReactFlow();
  const [hovered, setHovered] = useState<string | null>(null);
  const [layout, setLayout] = useState<Layout | null>(null);
  const fittedShape = useRef<string | null>(null);

  // The epic map swaps in a collapsed graph; everything below draws whichever graph is shown.
  const collapsed = useMemo(
    () => (view.collapseEpics ? collapseEpics(loaded, insights, expandedEpics) : null),
    [view.collapseEpics, loaded, insights, expandedEpics],
  );
  const graph = collapsed?.graph ?? loaded;
  const laneOf = useMemo(
    () => (view.collapseEpics ? epicMapLanes(expandedEpics) : lanesFor(view.groupBy, insights)),
    [view.collapseEpics, expandedEpics, view.groupBy, insights],
  );

  const { nodes: vNodes, edges: vEdges } = useMemo(() => visibleSubgraph(graph, filters), [graph, filters]);

  useEffect(() => {
    let cancelled = false;
    computeLayout(vNodes, vEdges, graph.brokenEdgeIds, laneOf).then(
      (l) => {
        if (cancelled) return;
        setLayout(l);
        // Re-fit only when the set of cards changes; re-layouts for new insights (e.g. status history
        // arriving) keep the user's viewport. Never zoom past 100%: small graphs stay card-sized.
        const shape = `${[...l.positions.keys()].sort().join("|")}#${l.groups.map((g) => g.id).join("|")}`;
        if (shape !== fittedShape.current) {
          fittedShape.current = shape;
          requestAnimationFrame(() => {
            void rf.fitView({ padding: 0.2, maxZoom: 1, duration: 250 });
          });
        }
      },
      // A failed layout keeps the previous one on screen; there is no layout error UI, so log it.
      (e: unknown) => {
        if (!cancelled) console.error("Graph layout failed", e);
      },
    );
    return (): void => {
      cancelled = true;
    };
  }, [vNodes, vEdges, graph.brokenEdgeIds, laneOf, rf]);

  // Highlights are computed on loaded issues; in the epic map they light up the node each issue is shown as.
  const emphasized = useMemo(() => {
    const e = emphasis(view.highlight, insights, view.highlightScope);
    if (!e || !collapsed) return e;
    const nodes = new Set([...e.nodes].map((u) => collapsed.shownAs.get(u) ?? u));
    const edges = new Set(loaded.edges.filter((x) => e.edges.has(x.id)).flatMap((x) => shownEdgeId(x, collapsed.shownAs) ?? []));
    return { nodes, edges };
  }, [view.highlight, view.highlightScope, insights, collapsed, loaded.edges]);
  const chain = useMemo(() => (hovered ? blockingChain(graph, hovered) : null), [graph, hovered]);
  const byUid = useMemo(() => new Map(graph.nodes.map((n) => [n.uid, n])), [graph]);

  const flowNodes = useMemo<FlowNode[]>(() => {
    if (!layout) return [];
    const toggleEpic = (epicUid: string) => (): void => {
      onToggleEpic(epicUid);
    };
    const groups: SiteGroupNode[] = layout.groups.map((g) => ({
      id: g.id,
      type: "siteGroup",
      position: { x: g.x, y: g.y },
      data: {
        label: g.label,
        color: g.color,
        url: g.url,
        onOpen: openExternal,
        onCollapse: g.collapseEpic ? toggleEpic(g.collapseEpic) : undefined,
      },
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
            aging: insights.aging.get(n.uid),
            change: insights.changed.get(n.uid)?.[0],
            showSite: showSiteBadges,
            dimmed: chain ? !chain.nodes.has(n.uid) : emphasized ? !isEmphasized : false,
            highlight: isEmphasized && view.highlight !== "none" ? view.highlight : null,
            selected: n.uid === selectedUid,
            onSelect,
            onOpen: openExternal,
            onHover: setHovered,
            onExpand: n.rollup ? toggleEpic(n.rollup.epicUid) : undefined,
          },
          draggable: false,
          focusable: false, // the card itself is the tab stop
        },
      ];
    });
    return [...groups, ...cards];
  }, [layout, vNodes, insights, showSiteBadges, chain, emphasized, view.highlight, onToggleEpic, selectedUid, onSelect]);

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
          sourceDone: e.aggregate ? e.aggregate.open === 0 : byUid.get(e.source)?.statusCategory === "done",
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
          nodeColor={(n) => (n.type === "issue" ? (n.data.node.siteColor ?? "#9ca3af") : "transparent")}
          nodeStrokeColor={(n) => (n.type === "siteGroup" ? (n.data.color ?? "#9ca3af") : "transparent")}
        />
      </ReactFlow>
    </>
  );
}

/** Centers the viewport on a card and focuses it (used by the Warnings panel). */
export function useFocusNode(): (uid: string) => boolean {
  const rf = useReactFlow();
  /** Returns false when the node isn't rendered (yet). */
  return (uid: string): boolean => {
    const n = rf.getInternalNode(uid);
    if (!n) return false;
    const { x, y } = n.internals.positionAbsolute;
    void rf.setCenter(x + (n.measured.width ?? CARD_WIDTH) / 2, y + (n.measured.height ?? CARD_HEIGHT) / 2, { zoom: 1.1, duration: 300 });
    const el = document.querySelector<HTMLElement>(`[data-uid="${CSS.escape(uid)}"]`);
    el?.focus({ preventScroll: true });
    return true;
  };
}
