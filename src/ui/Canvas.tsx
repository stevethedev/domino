import { Background, Controls, getNodesBounds, MiniMap, Panel, ReactFlow, useReactFlow, type Rect } from "@xyflow/react";
import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { blockingChain } from "../graph/analysis";
import { collapseEpics, shownEdgeId } from "../graph/collapse";
import { previewOf, type LinkPreview, type Move } from "../graph/traverse";
import { emphasis, type Highlight, type HighlightScope, type Insights } from "../graph/insights";
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  computeLayout,
  laneByAssignee,
  laneByEpic,
  laneBySite,
  type CardOrder,
  type LaneFn,
  type Layout,
} from "../graph/layout";
import { orderWithSummaries, type SortBy } from "../graph/sort";
import type { Graph, GraphEdge, GraphNode } from "../graph/types";
import { visibleSubgraph, type ViewFilters } from "../graph/visible";
import { openExternal } from "../platform";
import { LinkEdge, type LinkFlowEdge } from "./edges/LinkEdge";
import { captureElement } from "./capture";
import { ExportMenu } from "./ExportMenu";
import { SortChip } from "./SortChip";
import { COMPACT_BELOW_ZOOM, IssueCard, SiteGroup, type IssueFlowNode, type SiteGroupNode } from "./IssueCard";
import { isOneOf } from "../lib/guards";
import { prefersReducedMotion } from "../lib/motion";
import { fitKeyOf } from "./fitKey";

/** How long cards may slide after a sort change; longer than `--duration-base` so the slide finishes. */
const RESORT_MS = 400;

/** Margin around the graph in exports, in CSS pixels. */
const EXPORT_PADDING = 40;

/** Link and issue filters (display only; see visibleSubgraph). */
export type Filters = ViewFilters;
const GROUP_BY = ["none", "site", "epic", "assignee"] as const;
export type GroupBy = (typeof GROUP_BY)[number];
export const isGroupBy = isOneOf(GROUP_BY);
/**
 * `highlightScope` narrows the highlight to the signed-in user's issues ("At a glance" for me).
 * `sort` orders cards within each column (and lanes), and Timeline rows.
 */
export type ViewOptions = { groupBy: GroupBy; highlight: Highlight; highlightScope: HighlightScope; sort: SortBy };

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

/** A finished layout together with the cards and links it was computed for. */
type Drawn = Readonly<{ layout: Layout; nodes: readonly GraphNode[]; edges: readonly GraphEdge[] }>;

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

export function Canvas({
  graph: loaded,
  insights,
  filters,
  view,
  showSiteBadges,
  foldedEpics,
  onToggleEpic,
  selectedUid,
  onSelect,
  onTraverse,
  linkPreview,
  scopeKey,
  stale,
  order,
  onClearSort,
}: {
  graph: Graph;
  insights: Insights;
  filters: Filters;
  view: ViewOptions;
  showSiteBadges: boolean;
  /** Epics folded into one summary card each (their lanes are collapsed while grouped by epic). */
  foldedEpics: ReadonlySet<string>;
  /** Folds or unfolds an epic's lane. */
  onToggleEpic: (epicUid: string) => void;
  /** The issue open in the details panel, if any. */
  selectedUid: string | null;
  onSelect: (uid: string) => void;
  onTraverse: (uid: string, move: Move) => boolean;
  /** Where the focused card's ← and → would go. */
  linkPreview: LinkPreview;
  /** The scope the graph belongs to: the view fits again when it changes. */
  scopeKey: string | null;
  /** Another scope is loading: this graph is the previous one, shown faded and not interactive. */
  stale: boolean;
  /** The user's sort (see `ticketComparator`); null keeps the dependency layout's own order. */
  order: CardOrder | null;
  /** Back to the natural order (the sort chip's ✕). */
  onClearSort: () => void;
}): ReactElement {
  const rf = useReactFlow();
  const [hovered, setHovered] = useState<string | null>(null);
  // Cards stay where the last finished layout put them until the next one is ready, so new data
  // never blanks the canvas while the layout worker runs.
  const [drawn, setDrawn] = useState<Drawn | null>(null);
  const fittedKey = useRef<string | null>(null);
  // Cards slide to their new places when the sort changes (not on other re-layouts); the global
  // reduced-motion rule makes it instant. Each re-sort restarts the timer, so a quick second
  // change still slides for the full time.
  const [resorts, setResorts] = useState(0);
  const [resorting, setResorting] = useState(false);
  const resortPending = useRef(false);
  // Keyed on the sort setting, not the comparator, which is rebuilt whenever the data it reads
  // changes (status history arriving, a refresh): those re-layouts don't slide.
  const sortId = `${view.sort.key}:${String(view.sort.reversed)}`;
  const lastSortId = useRef(sortId);
  if (lastSortId.current !== sortId) {
    lastSortId.current = sortId;
    resortPending.current = true;
  }
  useEffect(() => {
    if (resorts === 0) return;
    const timer = setTimeout(() => {
      setResorting(false);
    }, RESORT_MS);
    return (): void => {
      clearTimeout(timer);
    };
  }, [resorts]);
  const fitKey = useRef("");
  fitKey.current = fitKeyOf(scopeKey, view.groupBy);

  // Folded epics swap in a collapsed graph; everything below draws whichever graph is shown.
  const collapsed = useMemo(
    () => (foldedEpics.size > 0 ? collapseEpics(loaded, insights, foldedEpics) : null),
    [foldedEpics, loaded, insights],
  );
  const graph = collapsed?.graph ?? loaded;
  const laneOf = useMemo(() => lanesFor(view.groupBy, insights), [view.groupBy, insights]);

  const { nodes: vNodes, edges: vEdges } = useMemo(() => visibleSubgraph(graph, filters), [graph, filters]);
  // A folded epic's summary card sorts as its best ticket (it has no fields of its own).
  const layoutOrder = useMemo(
    () => (order && collapsed ? orderWithSummaries(order, new Map(loaded.nodes.map((n) => [n.uid, n]))) : order),
    [order, collapsed, loaded.nodes],
  );

  useEffect(() => {
    let cancelled = false;
    computeLayout(vNodes, vEdges, graph.brokenEdgeIds, laneOf, layoutOrder ?? undefined).then(
      (l) => {
        if (cancelled) return;
        setDrawn({ layout: l, nodes: vNodes, edges: vEdges });
        if (resortPending.current) {
          resortPending.current = false;
          setResorting(true);
          setResorts((n) => n + 1);
        }
        // Fit once per scope and grouping (see fitKeyOf), when there's something to fit. Never
        // zoom past 100%: small graphs stay card-sized.
        if (l.positions.size > 0 && fitKey.current !== fittedKey.current) {
          fittedKey.current = fitKey.current;
          requestAnimationFrame(() => {
            void rf.fitView({ padding: 0.2, maxZoom: 1, duration: prefersReducedMotion() ? 0 : 250 });
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
  }, [vNodes, vEdges, graph.brokenEdgeIds, laneOf, layoutOrder, rf]);

  // Highlights are computed on loaded issues; folded epics light up the summary each issue is shown as.
  const emphasized = useMemo(() => {
    const e = emphasis(view.highlight, insights, view.highlightScope);
    if (!e || !collapsed) return e;
    const nodes = new Set([...e.nodes].map((u) => collapsed.shownAs.get(u) ?? u));
    const edges = new Set(loaded.edges.filter((x) => e.edges.has(x.id)).flatMap((x) => shownEdgeId(x, collapsed.shownAs) ?? []));
    return { nodes, edges };
  }, [view.highlight, view.highlightScope, insights, collapsed, loaded.edges]);
  const chain = useMemo(() => (hovered ? blockingChain(graph, hovered) : null), [graph, hovered]);
  const byUid = useMemo(() => new Map(graph.nodes.map((n) => [n.uid, n])), [graph]);
  const visibleByUid = useMemo(() => new Map(vNodes.map((n) => [n.uid, n])), [vNodes]);
  const visibleEdgeById = useMemo(() => new Map(vEdges.map((e) => [e.id, e])), [vEdges]);

  const flowNodes = useMemo<FlowNode[]>(() => {
    if (!drawn) return [];
    const { layout } = drawn;
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
        fold: g.epicUid ? { folded: foldedEpics.has(g.epicUid), onToggle: toggleEpic(g.epicUid) } : undefined,
      },
      width: g.width,
      height: g.height,
      selectable: false,
      focusable: false,
      draggable: false,
      zIndex: -1,
    }));
    // Each card shows its latest data; cards the next layout drops stay until it's ready.
    const cards: IssueFlowNode[] = drawn.nodes.flatMap((laidOut) => {
      const n = visibleByUid.get(laidOut.uid) ?? laidOut;
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
            onTraverse,
            preview: previewOf(linkPreview, n.uid),
            onExpand: n.rollup ? toggleEpic(n.rollup.epicUid) : undefined,
            stale,
          },
          draggable: false,
          focusable: false, // the card itself is the tab stop
        },
      ];
    });
    return [...groups, ...cards];
  }, [
    drawn,
    visibleByUid,
    insights,
    showSiteBadges,
    chain,
    emphasized,
    view.highlight,
    foldedEpics,
    onToggleEpic,
    selectedUid,
    onSelect,
    onTraverse,
    linkPreview,
    stale,
  ]);

  const flowEdges = useMemo<LinkFlowEdge[]>(() => {
    return (drawn?.edges ?? []).map((laidOut) => {
      const e = visibleEdgeById.get(laidOut.id) ?? laidOut;
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
  }, [drawn, visibleEdgeById, graph.cycleEdgeIds, graph.brokenEdgeIds, byUid, chain, emphasized, view.highlight]);

  // Exports render React Flow's viewport (cards, lanes, edges; not the minimap or controls) framed to
  // the whole graph at real size, whatever the current pan and zoom.
  const graphBounds = (): Rect => getNodesBounds(rf.getNodes());
  const exportGraph = captureElement(
    () => document.querySelector<HTMLElement>(".canvas .react-flow__viewport"),
    () => {
      const b = graphBounds();
      const width = Math.ceil(b.width + 2 * EXPORT_PADDING);
      const height = Math.ceil(b.height + 2 * EXPORT_PADDING);
      const transform = `translate(${EXPORT_PADDING - b.x}px, ${EXPORT_PADDING - b.y}px) scale(1)`;
      return { width, height, style: { width: `${width}px`, height: `${height}px`, transform } };
    },
    async () => {
      // The capture copies the live page, so the page is adjusted for the moment it takes.
      // 1. Zoomed out, cards render their compact form (different markup). Show them at real size,
      //    which is how the export frames them, and restore the user's pan and zoom afterwards.
      const before = rf.getViewport();
      if (before.zoom < COMPACT_BELOW_ZOOM) {
        await rf.setViewport({ ...before, zoom: 1 });
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      }
      const viewport = document.querySelector(".canvas .react-flow__viewport");
      // 2. Edges reference the shared arrowhead <defs> outside the viewport: carry a copy into it.
      const defs = document.querySelector(".arrow-defs")?.cloneNode(true);
      if (defs && viewport) viewport.appendChild(defs);
      // 3. Edge layers are 0×0 SVGs that rely on overflow; give them the graph's size so nothing clips.
      const b = graphBounds();
      const edgeLayers = viewport ? [...viewport.querySelectorAll<SVGSVGElement>(".react-flow__edges svg")] : [];
      const previous = edgeLayers.map((svg) => svg.getAttribute("style"));
      for (const svg of edgeLayers) {
        svg.style.width = `${Math.ceil(b.x + b.width + EXPORT_PADDING)}px`;
        svg.style.height = `${Math.ceil(b.y + b.height + EXPORT_PADDING)}px`;
        svg.style.overflow = "visible";
      }
      return (): void => {
        if (defs instanceof Element) defs.remove();
        edgeLayers.forEach((svg, i) => {
          const style = previous[i];
          if (style === null) svg.removeAttribute("style");
          else svg.setAttribute("style", style);
        });
        if (before.zoom < COMPACT_BELOW_ZOOM) void rf.setViewport(before);
      };
    },
  );

  return (
    <>
      <ArrowMarkers />
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        className={resorting ? "resorting" : undefined}
        nodesConnectable={false}
        nodesDraggable={false}
        elementsSelectable={false}
        nodesFocusable={false}
        edgesFocusable={false}
        minZoom={0.1}
        maxZoom={2}
        // The previous scope's graph, while another loads: a picture, not something to work with.
        panOnDrag={!stale}
        zoomOnScroll={!stale}
        zoomOnPinch={!stale}
        zoomOnDoubleClick={!stale}
      >
        <Background gap={24} size={1} />
        {!stale && (
          <>
            <Panel position="top-right">
              <ExportMenu name="graph" capture={exportGraph} />
            </Panel>
            <Panel position="top-left">
              <SortChip sort={view.sort} onClear={onClearSort} />
            </Panel>
            <Controls showInteractive={false} position="bottom-left" />
            <MiniMap<FlowNode>
              pannable
              style={{ width: 170, height: 110 }}
              zoomable
              ariaLabel="Minimap, tinted by site"
              nodeColor={(n) => (n.type === "issue" ? (n.data.node.siteColor ?? "#9ca3af") : "transparent")}
              nodeStrokeColor={(n) => (n.type === "siteGroup" ? (n.data.color ?? "#9ca3af") : "transparent")}
            />
          </>
        )}
      </ReactFlow>
    </>
  );
}

/** Centers the viewport on a card and focuses it (used by the Warnings panel). */
export function useFocusNode(): (uid: string, moveFocus?: boolean, keepZoom?: boolean) => boolean {
  const rf = useReactFlow();
  /**
   * Centres the node at a readable zoom (and focuses it unless `moveFocus` is false). With
   * `keepZoom` (following links), it keeps the zoom and only pans when the card is off screen.
   * Returns false when the node isn't rendered yet.
   */
  return (uid: string, moveFocus = true, keepZoom = false): boolean => {
    const n = rf.getInternalNode(uid);
    if (!n) return false;
    const { x, y } = n.internals.positionAbsolute;
    const width = n.measured.width ?? CARD_WIDTH;
    const height = n.measured.height ?? CARD_HEIGHT;
    const card = document.querySelector<HTMLElement>(`[data-uid="${CSS.escape(uid)}"]`)?.getBoundingClientRect();
    const pane = document.querySelector(".canvas .react-flow")?.getBoundingClientRect();
    const onScreen =
      card && pane && card.left >= pane.left && card.right <= pane.right && card.top >= pane.top && card.bottom <= pane.bottom;
    if (!keepZoom) void rf.setCenter(x + width / 2, y + height / 2, { zoom: 1.1, duration: 300 });
    else if (!onScreen) void rf.setCenter(x + width / 2, y + height / 2, { zoom: rf.getZoom(), duration: 200 });
    if (moveFocus) document.querySelector<HTMLElement>(`[data-uid="${CSS.escape(uid)}"]`)?.focus({ preventScroll: true });
    return true;
  };
}
