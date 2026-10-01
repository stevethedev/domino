import { describe, expect, it } from "vitest";
import type { TimelineEntry } from "../../../graph/schedule";
import type { GraphNode } from "../../../graph/types";
import { layoutRows } from "../timelineLayout";

const node = (uid: string, ghost = false): GraphNode => ({
  uid, siteId: "a", siteLabel: "A", key: uid, summary: uid, issueType: "Story", statusName: "To Do", statusCategory: "todo", url: "", ghost,
});
const entry = (start: string): TimelineEntry => ({ projected: { start, end: start }, progress: { state: "not-started", forecast: { start, end: start } }, varianceDays: 0 });

describe("layoutRows", () => {
  it("orders rows by start, with ghosts (no loaded dates) after real issues", () => {
    const nodes = [node("late"), node("ghost", true), node("early")];
    const timeline = new Map([["late", entry("2026-10-10")], ["ghost", entry("2026-10-01")], ["early", entry("2026-10-05")]]);
    const { items } = layoutRows(nodes, timeline, undefined);
    expect(items.map((i) => (i.kind === "row" ? i.node.uid : i.lane.id))).toEqual(["early", "late", "ghost"]);
  });
});
