import { describe, expect, it } from "vitest";
import { buildGraph } from "../buildGraph";
import { CARD_HEIGHT, CARD_WIDTH, computeLayout, laneByEpic, laneBySite, type LaneFn } from "../layout";
import { mockConfig, mockLinkTypes, mockSites } from "../../data/mockData";

const g = buildGraph({
  sites: mockConfig.sites,
  data: Object.entries(mockSites).map(([siteId, s]) => ({ siteId, ...s, linkTypes: mockLinkTypes })),
});

const MODES: [string, LaneFn | undefined][] = [["none", undefined], ["site", laneBySite], ["epic", laneByEpic]];

describe.each(MODES)("computeLayout (group by %s)", (mode, laneOf) => {
  it("places every blocker left of what it blocks and never overlaps cards", async () => {
    const layout = await computeLayout(g.nodes, g.edges, g.brokenEdgeIds, laneOf);
    const groupPos = new Map(layout.groups.map((gr) => [gr.id, gr]));
    const abs = (uid: string) => {
      const p = layout.positions.get(uid)!;
      const parent = p.parent ? groupPos.get(p.parent)! : { x: 0, y: 0 };
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
      const lane = (uid: string) => layout.positions.get(uid)!.parent;
      expect(lane("acme:CORE-16")).toBe(lane("acme:CORE-11")); // sub-task joins its story's epic
      expect(lane("acme:CORE-1")).toBe(lane("acme:CORE-10")); // the epic sits in its own lane
    }
  });
});
