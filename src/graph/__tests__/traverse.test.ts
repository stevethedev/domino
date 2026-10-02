import { describe, expect, it } from "vitest";
import { linkedIssues, step, type TraverseLayout } from "../traverse";
import type { GraphEdge } from "../types";

const edge = (source: string, target: string, kind: GraphEdge["kind"] = "blocks"): GraphEdge => ({
  id: `${source}->${target}:${kind}`,
  source,
  target,
  kind,
  linkType: kind,
  linkId: `${source}-${target}`,
  crossSite: false,
});

// A blocks B and C; B and C both block D. E relates to A (not a blocking link).
const edges = [edge("A", "B"), edge("A", "C"), edge("B", "D"), edge("C", "D"), edge("A", "E", "relates")];

/**
 * Columns left to right, cards top to bottom, as drawn:   A   B   D
 *                                                         F   C
 * A sits level with B; F is an unlinked card below A.
 */
const at: Record<string, readonly [number, number]> = { A: [0, 0], F: [0, 1], B: [1, 0], C: [1, 1], D: [2, 0] };
const pos = (uid: string): readonly [number, number] => at[uid] ?? [Infinity, Infinity];
const layout: TraverseLayout = {
  linked: (uid, d) => linkedIssues(uid, edges, d).sort((a, b) => pos(a)[1] - pos(b)[1]),
  closest: (from, options) => [...options].sort((a, b) => Math.abs(pos(a)[1] - pos(from)[1]) - Math.abs(pos(b)[1] - pos(from)[1]))[0],
  beside: (uid, d) => {
    const [x, y] = pos(uid);
    const column = Object.keys(at).filter((u) => pos(u)[0] === x && (d === "next" ? pos(u)[1] > y : pos(u)[1] < y));
    return column.sort((a, b) => Math.abs(pos(a)[1] - y) - Math.abs(pos(b)[1] - y))[0];
  },
};

describe("linkedIssues", () => {
  it("follows blocking links only, each issue once", () => {
    expect(linkedIssues("A", edges, "downstream")).toEqual(["B", "C"]);
    expect(linkedIssues("D", edges, "upstream")).toEqual(["B", "C"]);
    expect(linkedIssues("A", [...edges, edge("A", "B")], "downstream")).toEqual(["B", "C"]);
    expect(linkedIssues("A", edges, "upstream")).toEqual([]);
  });

  it("ignores self-links", () => {
    expect(linkedIssues("A", [edge("A", "A")], "downstream")).toEqual([]);
  });
});

describe("step", () => {
  it("goes to the linked issue straight ahead and remembers the alternatives", () => {
    expect(step("A", "downstream", null, layout)).toEqual({
      target: "B",
      trail: { at: "B", from: "A", direction: "downstream", options: ["B", "C"] },
    });
    // D (row 0) is blocked by B (row 0) and C (row 1): straight ahead is B.
    expect(step("D", "upstream", null, layout)?.target).toBe("B");
  });

  it("returns nothing when there's no link that way", () => {
    expect(step("A", "upstream", null, layout)).toBeNull();
    expect(step("D", "downstream", null, layout)).toBeNull();
  });

  it("moves between the alternatives with ↑/↓, top to bottom", () => {
    const toB = step("A", "downstream", null, layout);
    const toC = step("B", "next", toB?.trail ?? null, layout);
    expect(toC).toEqual({ target: "C", trail: { at: "C", from: "A", direction: "downstream", options: ["B", "C"] } });
    expect(step("C", "previous", toC?.trail ?? null, layout)?.target).toBe("B");
  });

  it("past the last alternative, ↑/↓ carry on to the next card in the column", () => {
    const toB = step("A", "downstream", null, layout);
    // B is the top alternative; nothing is above it in its column.
    expect(step("B", "previous", toB?.trail ?? null, layout)).toBeNull();
    const toC = step("B", "next", toB?.trail ?? null, layout);
    expect(step("C", "next", toC?.trail ?? null, layout)).toBeNull();
  });

  it("without a step to switch within, ↑/↓ move to the card above or below", () => {
    expect(step("A", "next", null, layout)).toEqual({ target: "F", trail: null });
    expect(step("F", "previous", null, layout)).toEqual({ target: "A", trail: null });
    expect(step("D", "next", null, layout)).toBeNull();
  });

  it("goes back the way it came, even when that isn't the link straight ahead", () => {
    const toC = step("B", "next", step("A", "downstream", null, layout)?.trail ?? null, layout); // A → C
    const toD = step("C", "downstream", toC?.trail ?? null, layout); // C → D
    expect(toD?.target).toBe("D");
    // Straight ahead of D is B, but it came from C, so ← returns to C.
    expect(step("D", "upstream", toD?.trail ?? null, layout)?.target).toBe("C");
  });

  it("forgets the trail once focus has moved elsewhere", () => {
    const trail = step("A", "downstream", null, layout)?.trail ?? null; // at B
    // On C without a live trail, ↓ looks for a card below C: there is none.
    expect(step("C", "next", trail, layout)).toBeNull();
    // On D with a trail for B, ← is a fresh step: straight ahead is B.
    expect(step("D", "upstream", { at: "B", from: "C", direction: "downstream", options: ["D"] }, layout)?.target).toBe("B");
  });
});
