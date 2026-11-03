import { describe, expect, it } from "vitest";
import type { GraphEdge } from "../../graph/types";
import type { Rect } from "@xyflow/react";
import { awaitsIdentities, firstView, MIN_READABLE_ZOOM } from "../firstView";

const pane = { width: 1200, height: 800 };
const small = { x: 0, y: 0, width: 900, height: 500 };
const wide = { x: 100, y: 50, width: 4000, height: 1200 };

const blocks = (source: string, target: string): GraphEdge => ({
  id: `${source}>${target}`,
  source,
  target,
  kind: "blocks",
  linkType: "blocks",
  linkId: `${source}>${target}`,
  crossSite: false,
});

const edges = [blocks("b1", "me1"), blocks("b2", "me1"), blocks("me1", "x"), blocks("top", "u1"), blocks("top", "u2")];
const drawn = new Set(["b1", "b2", "me1", "me2", "x", "top", "u1", "u2", "other"]);
const keyOf = (uid: string): string => uid.toUpperCase();
// Every card sits at the origin unless placed: any subset fits.
const card = (x: number): Rect => ({ x, y: 0, width: 280, height: 120 });
const boundsAt =
  (at: Readonly<Record<string, number>>) =>
  (uids: readonly string[]): Rect => {
    const xs = uids.map((u) => at[u] ?? 0);
    const left = Math.min(...xs);
    return { ...card(left), width: Math.max(...xs) - left + 280 };
  };
const view = (over: Partial<Parameters<typeof firstView>[0]> = {}): ReturnType<typeof firstView> =>
  firstView({
    bounds: wide,
    boundsOf: boundsAt({}),
    pane,
    drawn,
    edges,
    mine: new Set(["me1", "me2"]),
    unblockers: [{ uid: "top" }],
    downstream: new Map(),
    keyOf,
    ...over,
  });

describe("firstView", () => {
  it("fits everything when it fits at a readable zoom", () => {
    expect(view({ bounds: small })).toEqual({ kind: "all" });
  });

  it("otherwise shows your tickets and what directly blocks them", () => {
    const v = view();
    expect(v.kind).toBe("subset");
    if (v.kind !== "subset") return;
    expect([...v.uids].sort()).toEqual(["b1", "b2", "me1", "me2"]);
    expect(v.notice).toBe("Showing your 2 tickets and their blockers");
  });

  it("leaves out your tickets that aren't drawn (filtered, or folded into an epic)", () => {
    const v = view({ mine: new Set(["me2", "hidden"]) });
    expect(v.kind === "subset" && v.uids).toEqual(["me2"]);
    expect(v.kind === "subset" && v.notice).toBe("Showing your ticket");
  });

  it("with none of yours drawn, shows the ticket that unblocks the most and what it unblocks", () => {
    const v = view({ mine: new Set() });
    expect(v.kind === "subset" && [...v.uids].sort()).toEqual(["top", "u1", "u2"]);
    expect(v.kind === "subset" && v.notice).toBe("Showing TOP, which unblocks the most, and the 2 tickets it unblocks");
  });

  it("with neither, starts at the top-left of the graph at the readable zoom", () => {
    const v = view({ mine: new Set(), unblockers: [] });
    expect(v.kind).toBe("corner");
    if (v.kind !== "corner") return;
    expect(v.notice).toBe("Showing the start of the graph");
    expect(v.viewport.zoom).toBe(MIN_READABLE_ZOOM);
    // The graph's top-left corner sits as far inside the pane as fitView's padding would put it.
    expect(wide.x * v.viewport.zoom + v.viewport.x).toBeCloseTo((1200 - 1200 / 1.2) / 2);
    expect(wide.y * v.viewport.zoom + v.viewport.y).toBeCloseTo((800 - 800 / 1.2) / 2);
  });

  it("is never fooled by an empty pane (not measured yet): it fits everything", () => {
    expect(view({ pane: { width: 0, height: 0 } })).toEqual({ kind: "all" });
  });

  it("narrows to one of your tickets when yours and their blockers don't fit at a readable zoom", () => {
    const v = view({ boundsOf: boundsAt({ me1: 0, me2: 4000 }) });
    expect(v.kind === "subset" && v.uids).toEqual(["me1"]);
    expect(v.kind === "subset" && v.notice).toBe("Showing 1 of your 2 tickets");
  });

  it("narrows to your one ticket, without its blockers, when they don't fit together", () => {
    const v = view({ mine: new Set(["me1"]), boundsOf: boundsAt({ b1: 4000 }) });
    expect(v.kind === "subset" && v.uids).toEqual(["me1"]);
    expect(v.kind === "subset" && v.notice).toBe("Showing your ticket");
  });

  it("narrows to the top unblocker alone when it and what it unblocks don't fit", () => {
    const v = view({ mine: new Set(), boundsOf: boundsAt({ u2: 4000 }) });
    expect(v.kind === "subset" && v.uids).toEqual(["top"]);
    expect(v.kind === "subset" && v.notice).toBe("Showing TOP, which unblocks the most");
  });

  it("with none of the top unblockers drawn, picks the drawn ticket with the most open work downstream", () => {
    const downstream = new Map([
      ["hiddenTop", new Set(["a", "b", "c"])],
      ["me1", new Set(["x"])],
      ["top", new Set(["u1", "u2"])],
    ]);
    const v = view({ mine: new Set(), unblockers: [{ uid: "hiddenTop" }], downstream });
    expect(v.kind === "subset" && v.uids[0]).toBe("top");
  });
});

describe("awaitsIdentities", () => {
  it("is true for a partial first view fitted before identities loaded", () => {
    expect(awaitsIdentities({ kind: "corner", viewport: { x: 0, y: 0, zoom: 1 }, notice: "" }, new Set())).toBe(true);
    expect(awaitsIdentities({ kind: "subset", uids: ["top"], notice: "" }, new Set())).toBe(true);
  });

  it("is false once identities are known, or when the whole graph is shown", () => {
    expect(awaitsIdentities({ kind: "subset", uids: ["me1"], notice: "" }, new Set(["me1"]))).toBe(false);
    expect(awaitsIdentities({ kind: "all" }, new Set())).toBe(false);
  });
});
