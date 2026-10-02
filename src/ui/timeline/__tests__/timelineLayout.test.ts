import { describe, expect, it } from "vitest";
import type { TimelineEntry } from "../../../graph/schedule";
import type { GraphNode } from "../../../graph/types";
import type { Lane } from "../../../graph/layout";
import { LANE_HEIGHT, layoutRows, ROW_HEIGHT } from "../timelineLayout";

const node = (uid: string, ghost = false): GraphNode => ({
  uid,
  siteId: "a",
  siteLabel: "A",
  key: uid,
  summary: uid,
  issueType: "Story",
  statusName: "To Do",
  statusCategory: "todo",
  url: "",
  ghost,
});
const entry = (start: string): TimelineEntry => ({
  projected: { start, end: start },
  progress: { state: "not-started", forecast: { start, end: start } },
  varianceDays: 0,
});

describe("layoutRows", () => {
  it("orders rows by start, with ghosts (no loaded dates) after real issues", () => {
    const nodes = [node("late"), node("ghost", true), node("early")];
    const timeline = new Map([
      ["late", entry("2026-10-10")],
      ["ghost", entry("2026-10-01")],
      ["early", entry("2026-10-05")],
    ]);
    const { items } = layoutRows(nodes, timeline, undefined);
    expect(items.map((i) => (i.kind === "row" ? i.node.uid : i.lane.id))).toEqual(["early", "late", "ghost"]);
  });
});

describe("layoutRows with collapsed lanes", () => {
  const laneOf = (n: GraphNode): Lane => ({ id: `lane:${n.uid[0]}`, label: n.uid[0] });
  const late = (start: string, end: string): TimelineEntry => ({
    projected: { start, end: start },
    progress: { state: "not-started", forecast: { start, end } },
    varianceDays: 2,
  });
  const nodes = [node("a1"), node("a2"), node("b1"), node("aGhost", true)];
  const timeline = new Map([
    ["a1", entry("2026-10-05")],
    ["a2", late("2026-10-08", "2026-10-20")],
    ["b1", entry("2026-10-06")],
    ["aGhost", entry("2026-09-01")],
  ]);

  it("folds a collapsed lane's rows under its header (still mounted, for animation) and takes only the header's height", () => {
    const { items, height } = layoutRows(nodes, timeline, laneOf, new Set(["lane:a"]));
    const shown = (i: (typeof items)[number]): string =>
      i.kind === "row" ? `${i.node.uid}@${i.y}${i.folded ? " folded" : ""}` : `[${i.lane.id}${i.collapsed ? " collapsed" : ""}]@${i.y}`;
    expect(items.map(shown)).toEqual([
      "[lane:a collapsed]@0",
      "a1@0 folded",
      "a2@0 folded",
      "aGhost@0 folded",
      `[lane:b]@${LANE_HEIGHT}`,
      `b1@${2 * LANE_HEIGHT}`,
    ]);
    const header = items[0];
    expect(header.kind === "lane" && [header.count, header.late]).toEqual([3, 1]);
    expect(height).toBe(2 * LANE_HEIGHT + ROW_HEIGHT);
  });

  it("still returns every row, so date ranges and counts don't change when a lane folds", () => {
    const open = layoutRows(nodes, timeline, laneOf);
    const folded = layoutRows(nodes, timeline, laneOf, new Set(["lane:a", "lane:b"]));
    expect(folded.all.map((r) => r.node.uid)).toEqual(open.all.map((r) => r.node.uid));
  });

  it("ignores collapse without grouping (there's no header to fold into)", () => {
    const { items } = layoutRows(nodes, timeline, undefined, new Set(["all"]));
    expect(items.filter((i) => i.kind === "row" && !i.folded)).toHaveLength(4);
  });
});
