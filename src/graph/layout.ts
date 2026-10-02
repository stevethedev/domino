import ELK, { type ElkExtendedEdge, type ElkNode } from "elkjs/lib/elk.bundled.js";
import { getOrThrow } from "../lib/guards";
import type { GraphEdge, GraphNode } from "./types";

export const CARD_WIDTH = 280;
export const CARD_HEIGHT = 112;
const GROUP_PADDING_TOP = 44;
const LANE_PADDING = 20;
const LANE_GAP = 28;
const LANE_SPACING = 40;

/** Which swimlane a card belongs to. Lanes with `last` sort after all others (e.g. "No epic"). */
export type Lane = {
  id: string;
  label: string;
  color?: string;
  url?: string;
  last?: boolean;
  /** Set on an expanded epic's lane in the epic map: the epic to collapse again. */
  collapseEpic?: string;
};
export type LaneFn = (n: GraphNode) => Lane;

export type LayoutGroup = Lane & { x: number; y: number; width: number; height: number };
export type Layout = {
  /** Absolute when ungrouped; relative to the group when grouped. */
  positions: Map<string, { x: number; y: number; parent?: string }>;
  groups: LayoutGroup[];
};

const elk = new ELK();

const ROOT_OPTIONS: Record<string, string> = {
  "elk.algorithm": "layered",
  "elk.direction": "RIGHT",
  "elk.layered.spacing.nodeNodeBetweenLayers": "90",
  "elk.spacing.nodeNode": "28",
  "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
  "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
  "elk.separateConnectedComponents": "true",
  "elk.spacing.componentComponent": "60",
};

export const laneBySite: LaneFn = (n) => ({ id: `site:${n.siteId}`, label: n.siteLabel, color: n.siteColor });

export const laneByEpic: LaneFn = (n) => {
  if (n.epic) {
    return { id: `epic:${n.epic.uid}`, label: n.epic.summary ? `${n.epic.key} · ${n.epic.summary}` : n.epic.key, color: n.siteColor, url: n.epic.url };
  }
  return n.ghost ? { id: "epic:~ghost", label: "Outside scope", last: true } : { id: "epic:~none", label: "No epic", last: true };
};

/**
 * One lane per assignee (by display name, so the same person on two sites shares a lane),
 * labelled with how many of other people's open issues wait on theirs.
 */
export const laneByAssignee =
  (holdingUp: ReadonlyMap<string, number>): LaneFn =>
  (n) => {
    if (n.ghost) return { id: "assignee:~ghost", label: "Outside scope", last: true };
    if (!n.assigneeName) return { id: "assignee:~none", label: "Unassigned", last: true };
    const waiting = holdingUp.get(n.assigneeName) ?? 0;
    return {
      id: `assignee:${n.assigneeName}`,
      label: waiting ? `${n.assigneeName} · holding up ${waiting}` : n.assigneeName,
    };
  };

/**
 * Layered left-to-right layout. Only blocks edges that survived cycle breaking constrain
 * layering, so every blocker sits left of what it blocks; other link kinds are drawn but
 * don't pull nodes around.
 *
 * With `laneOf`, cards are grouped into labelled horizontal swimlanes (by site, epic, ...). ELK's global layering
 * (x) is kept so cross-site edges still flow left to right even when sites block each other
 * in both directions, which separate ELK containers cannot guarantee.
 */
export async function computeLayout(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  brokenEdgeIds: ReadonlySet<string>,
  laneOf?: LaneFn,
): Promise<Layout> {
  const visible = new Set(nodes.map((n) => n.uid));
  const sorted = [...nodes].sort((a, b) => a.uid.localeCompare(b.uid));
  const layoutEdges: ElkExtendedEdge[] = edges
    .filter((e) => e.kind === "blocks" && !brokenEdgeIds.has(e.id) && visible.has(e.source) && visible.has(e.target) && e.source !== e.target)
    .map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] }));
  const root: ElkNode = {
    id: "root",
    layoutOptions: ROOT_OPTIONS,
    children: sorted.map((n) => ({ id: n.uid, width: CARD_WIDTH, height: CARD_HEIGHT })),
    edges: layoutEdges,
  };
  const out = await elk.layout(root);
  const flat = new Map((out.children ?? []).map((c) => [c.id, { x: c.x ?? 0, y: c.y ?? 0 }]));
  if (!laneOf) return { positions: flat, groups: [] };
  // Edges drawn straight between cards; cycle-breaking back edges loop around the row instead.
  const links = edges.filter((e) => !brokenEdgeIds.has(e.id) && visible.has(e.source) && visible.has(e.target) && e.source !== e.target);
  return swimlanes(sorted, links, flat, laneOf);
}

function swimlanes(
  nodes: readonly GraphNode[],
  links: readonly GraphEdge[],
  flat: Map<string, { x: number; y: number }>,
  laneOf: LaneFn,
): Layout {
  const byLane = new Map<string, { lane: Lane; members: GraphNode[] }>();
  for (const n of nodes) {
    const lane = laneOf(n);
    let entry = byLane.get(lane.id);
    if (!entry) byLane.set(lane.id, (entry = { lane, members: [] }));
    entry.members.push(n);
  }
  // Lanes in order of their topmost card in the flat layout, so the picture stays familiar;
  // catch-all lanes ("No epic", "Outside scope") go last.
  const topY = (members: GraphNode[]): number => Math.min(...members.map((n) => getOrThrow(flat, n.uid).y));
  const lanes = [...byLane.values()].sort(
    (a, b) => Number(!!a.lane.last) - Number(!!b.lane.last) || topY(a.members) - topY(b.members) || a.lane.id.localeCompare(b.lane.id),
  );
  const positions: Layout["positions"] = new Map();
  const groups: LayoutGroup[] = [];
  const minX = Math.min(...nodes.map((n) => getOrThrow(flat, n.uid).x));
  let top = 0;
  for (const { lane, members } of lanes) {
    // Rows come from the flat layout and move as whole units, so cards ELK put on one row stay on
    // one lane row (straight chains stay straight). Flat rows are then packed greedily, top to
    // bottom, into the first lane row they fit (see `fitsRow`).
    const byFlatRow = new Map<number, string[]>(); // flat y -> uids
    for (const n of members) {
      const { y } = getOrThrow(flat, n.uid);
      byFlatRow.set(y, [...(byFlatRow.get(y) ?? []), n.uid]);
    }
    const rows: string[][] = []; // lane row -> uids
    const rowOf = new Map<string, number>(); // uid -> lane row
    for (const [, uids] of [...byFlatRow].sort(([a], [b]) => a - b)) {
      let r = rows.findIndex((placed) => fitsRow(placed, uids, links, flat));
      if (r === -1) r = rows.push([]) - 1;
      rows[r].push(...uids);
      for (const uid of uids) rowOf.set(uid, r);
    }
    const xs = members.map((n) => getOrThrow(flat, n.uid).x);
    const left = Math.min(...xs) - minX;
    const width = Math.max(...xs) - Math.min(...xs) + CARD_WIDTH + 2 * LANE_PADDING;
    const height = GROUP_PADDING_TOP + rows.length * (CARD_HEIGHT + LANE_GAP) - LANE_GAP + LANE_PADDING;
    const id = `group:${lane.id}`;
    groups.push({ ...lane, id, x: left, y: top, width, height });
    for (const n of members) {
      positions.set(n.uid, {
        x: getOrThrow(flat, n.uid).x - minX - left + LANE_PADDING,
        y: GROUP_PADDING_TOP + getOrThrow(rowOf, n.uid) * (CARD_HEIGHT + LANE_GAP),
        parent: id,
      });
    }
    top += height + LANE_SPACING;
  }
  return { positions, groups };
}

/**
 * Whether `incoming` cards can share a lane row with `placed` ones: no two cards collide
 * horizontally, and no link between two cards on the row runs straight over a third card
 * (which would read as part of the chain).
 */
function fitsRow(
  placed: readonly string[],
  incoming: readonly string[],
  links: readonly GraphEdge[],
  flat: ReadonlyMap<string, { x: number; y: number }>,
): boolean {
  const x = (uid: string): number => getOrThrow(flat, uid).x;
  if (incoming.some((a) => placed.some((b) => Math.abs(x(a) - x(b)) < CARD_WIDTH + LANE_GAP / 2))) return false;
  const row = [...placed, ...incoming];
  const onRow = new Set(row);
  return links.every(({ source, target }) => {
    if (!onRow.has(source) || !onRow.has(target)) return true;
    const [lo, hi] = [x(source), x(target)].sort((a, b) => a - b);
    return row.every((uid) => uid === source || uid === target || x(uid) <= lo || x(uid) >= hi);
  });
}
