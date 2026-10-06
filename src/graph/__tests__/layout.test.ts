import { describe, expect, it } from "vitest";
import { getOrThrow } from "../../lib/guards";
import { buildGraph } from "../buildGraph";
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  computeLayout,
  laneByEpic,
  laneBySite,
  type LaneFn,
  type Layout,
  epicLaneId,
  foldedEpicUids,
  withEpicFolds,
} from "../layout";
import { mockConfig, mockLinkTypes, mockSites } from "../../data/mockData";
import type { GraphEdge, GraphNode } from "../types";

const g = buildGraph({
  sites: mockConfig.sites,
  data: Object.entries(mockSites).map(([siteId, s]) => ({ siteId, ...s, linkTypes: mockLinkTypes })),
});

const MODES: [string, LaneFn | undefined][] = [
  ["none", undefined],
  ["site", laneBySite],
  ["epic", laneByEpic],
];

describe.each(MODES)("computeLayout (group by %s)", (mode, laneOf) => {
  it("places every blocker left of what it blocks and never overlaps cards", async () => {
    const layout = await computeLayout(g.nodes, g.edges, g.brokenEdgeIds, laneOf);
    const groupPos = new Map(layout.groups.map((gr) => [gr.id, gr]));
    const abs = (uid: string): { x: number; y: number } => {
      const p = getOrThrow(layout.positions, uid);
      const parent = p.parent ? getOrThrow(groupPos, p.parent) : { x: 0, y: 0 };
      return { x: p.x + parent.x, y: p.y + parent.y };
    };
    expect(layout.positions.size).toBe(g.nodes.length);

    for (const e of g.edges) {
      if (e.kind !== "blocks" || g.brokenEdgeIds.has(e.id)) continue;
      expect(abs(e.source).x, `${e.source} -> ${e.target}`).toBeLessThan(abs(e.target).x);
    }

    const boxes = g.nodes.map((n) => ({ uid: n.uid, ...abs(n.uid) }));
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const [a, b] = [boxes[i], boxes[j]];
        const overlap = a.x < b.x + CARD_WIDTH && b.x < a.x + CARD_WIDTH && a.y < b.y + CARD_HEIGHT && b.y < a.y + CARD_HEIGHT;
        expect(overlap, `${a.uid} overlaps ${b.uid}`).toBe(false);
      }
    }
    if (mode === "site") expect(layout.groups.map((gr) => gr.label).sort()).toEqual(["Acme", "Legacy", "Partner", "other.atlassian.net"]);
    if (mode === "epic") {
      const labels = layout.groups.map((gr) => gr.label);
      expect(labels).toContain("CORE-1 · Checkout v2");
      expect(labels).toContain("PAY-20 · Tokenized payments for Acme");
      expect(labels.slice(-2)).toEqual(["No epic", "Outside scope"]); // catch-alls last
      const lane = (uid: string): string | undefined => getOrThrow(layout.positions, uid).parent;
      expect(lane("acme:CORE-16")).toBe(lane("acme:CORE-11")); // sub-task joins its story's epic
      expect(lane("acme:CORE-1")).toBe(lane("acme:CORE-10")); // the epic sits in its own lane
    }
  });
});

describe("swimlanes keep the layout's rows", () => {
  it("cards on one row in the flat layout stay on one row inside their lane", async () => {
    const flat = await computeLayout(g.nodes, g.edges, g.brokenEdgeIds, undefined);
    const lanes = await computeLayout(g.nodes, g.edges, g.brokenEdgeIds, laneBySite);
    // Same lane and same flat row => same lane row.
    const lane = (uid: string): string | undefined => getOrThrow(lanes.positions, uid).parent;
    const pairs: [string, string][] = [];
    const uids = [...flat.positions.keys()];
    for (const a of uids)
      for (const b of uids)
        if (a < b && lane(a) === lane(b) && getOrThrow(flat.positions, a).y === getOrThrow(flat.positions, b).y) pairs.push([a, b]);
    expect(pairs.length).toBeGreaterThan(0);
    for (const [a, b] of pairs) expect(getOrThrow(lanes.positions, a).y, `${a} vs ${b}`).toBe(getOrThrow(lanes.positions, b).y);
  });
});

describe("swimlanes stay compact", () => {
  it("merges flat rows into one lane row when their cards don't collide", async () => {
    const flat = await computeLayout(g.nodes, g.edges, g.brokenEdgeIds, undefined);
    const lanes = await computeLayout(g.nodes, g.edges, g.brokenEdgeIds, laneBySite);
    for (const group of lanes.groups) {
      const members = [...lanes.positions].filter(([, p]) => p.parent === group.id).map(([uid]) => uid);
      const flatRows = new Set(members.map((u) => getOrThrow(flat.positions, u).y)).size;
      const laneRows = new Set(members.map((u) => getOrThrow(lanes.positions, u).y)).size;
      expect(laneRows, group.label).toBeLessThanOrEqual(flatRows);
    }
    // At least one lane got denser than one-row-per-flat-row.
    const denser = lanes.groups.some((group) => {
      const members = [...lanes.positions].filter(([, p]) => p.parent === group.id).map(([uid]) => uid);
      return (
        new Set(members.map((u) => getOrThrow(lanes.positions, u).y)).size <
        new Set(members.map((u) => getOrThrow(flat.positions, u).y)).size
      );
    });
    expect(denser).toBe(true);
  });

  // A link between two cards on one lane row is drawn straight along it; a third card in between would read as part of the chain.
  const expectNoLinkOverCards = (
    layout: Layout,
    nodes: readonly GraphNode[],
    edges: readonly GraphEdge[],
    broken: ReadonlySet<string> = new Set(),
  ): void => {
    const rowKey = (uid: string): string => {
      const p = getOrThrow(layout.positions, uid);
      return `${p.parent ?? ""}|${p.y}`;
    };
    for (const e of edges) {
      if (broken.has(e.id) || e.source === e.target || !layout.positions.has(e.source) || !layout.positions.has(e.target)) continue;
      if (rowKey(e.source) !== rowKey(e.target)) continue;
      const [lo, hi] = [getOrThrow(layout.positions, e.source).x, getOrThrow(layout.positions, e.target).x].sort((p, q) => p - q);
      for (const n of nodes) {
        if (n.uid === e.source || n.uid === e.target || rowKey(n.uid) !== rowKey(e.source)) continue;
        const x = getOrThrow(layout.positions, n.uid).x;
        expect(x > lo && x < hi, `${n.uid} sits on ${e.source} -> ${e.target}`).toBe(false);
      }
    }
  };

  it("never packs a card onto a skip-layer link", async () => {
    // A->C skips a layer; packing X (its own flat row) beside A and C would put it on that line.
    const node = (key: string): GraphNode => ({
      uid: `s:${key}`,
      siteId: "s",
      siteLabel: "S",
      key,
      summary: key,
      issueType: "Story",
      statusName: "To Do",
      statusCategory: "todo",
      url: "",
      ghost: false,
    });
    const edge = (s: string, t: string): GraphEdge => ({
      id: `${s}>${t}`,
      source: `s:${s}`,
      target: `s:${t}`,
      kind: "blocks",
      linkType: "blocks",
      linkId: `${s}>${t}`,
      crossSite: false,
    });
    const nodes = ["A", "X", "C", "P", "Q", "R"].map(node);
    const edges = [
      ["A", "X"],
      ["X", "C"],
      ["A", "C"],
      ["P", "Q"],
      ["Q", "R"],
      ["P", "R"],
      ["A", "R"],
    ].map(([s, t]) => edge(s, t));
    expectNoLinkOverCards(await computeLayout(nodes, edges, new Set(), laneBySite), nodes, edges);
  });

  it.each(MODES.filter(([, laneOf]) => laneOf))("never packs a card onto a link in the mock data (%s)", async (_, laneOf) => {
    expectNoLinkOverCards(await computeLayout(g.nodes, g.edges, g.brokenEdgeIds, laneOf), g.nodes, g.edges, g.brokenEdgeIds);
  });
});

describe("epic lane ids", () => {
  it("names an epic's lane, and reads folded epics back out of collapsed lanes", () => {
    expect(epicLaneId("a:E-1")).toBe("epic:a:E-1");
    // Other lanes (sites, assignees, the catch-all epic lanes) aren't epics.
    expect(foldedEpicUids(["epic:a:E-1", "site:a", "assignee:Noor", "epic:~none", "epic:~ghost", "epic:b:E-2"])).toEqual(
      new Set(["a:E-1", "b:E-2"]),
    );
  });
});

describe("withEpicFolds", () => {
  it("replaces the epic folds and keeps every other collapsed lane", () => {
    const lanes = ["epic:a:E-1", "site:a", "epic:~none", "assignee:Noor", "epic:a:E-2"];
    expect(withEpicFolds(lanes, ["a:E-3", "a:E-2"])).toEqual(
      new Set(["site:a", "epic:~none", "assignee:Noor", "epic:a:E-3", "epic:a:E-2"]),
    );
    expect(withEpicFolds(lanes, [])).toEqual(new Set(["site:a", "epic:~none", "assignee:Noor"]));
  });
});

describe("computeLayout with a sort", () => {
  // Reverse natural key order: easy to tell apart from the default uid order.
  const order = (a: GraphNode, b: GraphNode): number =>
    b.key.localeCompare(a.key, undefined, { numeric: true }) || b.uid.localeCompare(a.uid);

  /** Absolute card positions, grouped by column (x), each column top to bottom. */
  const columns = (layout: Layout): GraphNode[][] => {
    const groupPos = new Map(layout.groups.map((gr) => [gr.id, gr]));
    const abs = (uid: string): { x: number; y: number } => {
      const p = getOrThrow(layout.positions, uid);
      const parent = p.parent ? getOrThrow(groupPos, p.parent) : { x: 0, y: 0 };
      return { x: p.x + parent.x, y: p.y + parent.y };
    };
    const byX = new Map<number, GraphNode[]>();
    for (const n of g.nodes) byX.set(abs(n.uid).x, [...(byX.get(abs(n.uid).x) ?? []), n]);
    return [...byX.values()].map((col) => col.sort((a, b) => abs(a.uid).y - abs(b.uid).y));
  };

  it.each(MODES)("keeps every column in sorted order (group by %s)", async (_mode, laneOf) => {
    const layout = await computeLayout(g.nodes, g.edges, g.brokenEdgeIds, laneOf, order);
    for (const col of columns(layout)) {
      // Within a lane (or the whole graph), top to bottom follows the sort.
      const byLane = new Map<string, GraphNode[]>();
      for (const n of col) {
        const lane = getOrThrow(layout.positions, n.uid).parent ?? "all";
        byLane.set(lane, [...(byLane.get(lane) ?? []), n]);
      }
      for (const cards of byLane.values()) expect(cards.map((n) => n.uid)).toEqual([...cards].sort(order).map((n) => n.uid));
    }
  });

  it.each(MODES)("still puts blockers left of what they block, without overlaps (group by %s)", async (_mode, laneOf) => {
    const layout = await computeLayout(g.nodes, g.edges, g.brokenEdgeIds, laneOf, order);
    const groupPos = new Map(layout.groups.map((gr) => [gr.id, gr]));
    const abs = (uid: string): { x: number; y: number } => {
      const p = getOrThrow(layout.positions, uid);
      const parent = p.parent ? getOrThrow(groupPos, p.parent) : { x: 0, y: 0 };
      return { x: p.x + parent.x, y: p.y + parent.y };
    };
    for (const e of g.edges) {
      if (e.kind === "blocks" && !g.brokenEdgeIds.has(e.id)) expect(abs(e.source).x).toBeLessThan(abs(e.target).x);
    }
    const boxes = g.nodes.map((n) => ({ uid: n.uid, ...abs(n.uid) }));
    for (const [i, a] of boxes.entries()) {
      for (const b of boxes.slice(i + 1)) {
        const overlap = a.x < b.x + CARD_WIDTH && b.x < a.x + CARD_WIDTH && a.y < b.y + CARD_HEIGHT && b.y < a.y + CARD_HEIGHT;
        expect(overlap, `${a.uid} overlaps ${b.uid}`).toBe(false);
      }
    }
  });

  it("orders lanes by their first card under the sort, catch-alls last", async () => {
    const layout = await computeLayout(g.nodes, g.edges, g.brokenEdgeIds, laneByEpic, order);
    const lanes = layout.groups.filter((gr) => !gr.last);
    const firstOf = (groupId: string): GraphNode =>
      [...g.nodes].filter((n) => getOrThrow(layout.positions, n.uid).parent === groupId).sort(order)[0];
    const firsts = lanes.map((gr) => firstOf(gr.id));
    expect(firsts.map((n) => n.uid)).toEqual([...firsts].sort(order).map((n) => n.uid));
    expect(layout.groups.slice(-2).every((gr) => gr.last)).toBe(true);
  });
});
