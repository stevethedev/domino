import { describe, expect, it } from "vitest";
import { edgeOpacity } from "../edges/LinkEdge";

describe("edgeOpacity", () => {
  it("draws a link at full strength, a duplicate lighter, and one from finished work lighter still", () => {
    expect(edgeOpacity({ kind: "blocks", sourceDone: false, dimmed: false })).toBe(1);
    expect(edgeOpacity({ kind: "duplicates", sourceDone: false, dimmed: false })).toBe(0.4);
    expect(edgeOpacity({ kind: "blocks", sourceDone: true, dimmed: false })).toBe(0.25);
  });

  it("keeps a link outside the highlight at 30%, still traceable", () => {
    expect(edgeOpacity({ kind: "blocks", sourceDone: false, dimmed: true })).toBeCloseTo(0.3);
    expect(edgeOpacity({ kind: "duplicates", sourceDone: false, dimmed: true })).toBeCloseTo(0.12);
  });
});
