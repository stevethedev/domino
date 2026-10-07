import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Insights } from "../../graph/insights";
import { NO_ISSUES } from "../../graph/mine";
import { InsightTiles } from "../InsightsBar";

const insights: Insights = {
  blocked: new Set(["a", "b", "c"]),
  ready: new Set(),
  critical: { nodes: ["a"], edges: [] },
  openBlockers: new Map(),
  downstream: new Map(),
  unblockers: [],
  holdingUpByAssignee: new Map(),
  aging: new Map(),
  changed: new Map(),
  mine: NO_ISSUES,
};

const tiles = (props: Partial<Parameters<typeof InsightTiles>[0]>): string =>
  renderToStaticMarkup(createElement(InsightTiles, { summary: "", insights, highlight: "none", onHighlight: () => undefined, ...props }));

describe("InsightTiles", () => {
  it("says how many of each count the Display filters leave on screen", () => {
    const out = tiles({ drawn: new Set(["a"]) });
    expect(out).toContain("3</span>");
    expect(out).toContain("1 shown");
  });

  it("doesn't mention shown counts without filters", () => {
    expect(tiles({})).not.toContain("shown");
  });

  it("disables a tile with nothing to highlight, unless it's the one pressed", () => {
    const ready = (html: string): string | undefined => /<button[^>]*insight-ready[^>]*>/.exec(html)?.[0];
    expect(ready(tiles({}))).toContain("disabled");
    expect(ready(tiles({ highlight: "ready" }))).not.toContain("disabled");
  });
});
