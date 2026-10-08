import { describe, expect, it } from "vitest";
import { fmtDay } from "../../format";
import type { TimelineEntry } from "../../../graph/schedule";
import type { GraphNode } from "../../../graph/types";
import type { Lane } from "../../../graph/layout";
import { ticketComparator } from "../../../graph/sort";
import {
  dayAt,
  drawnBar,
  roomAfter,
  unobscuredWidth,
  LABEL_WIDTH,
  LANE_HEIGHT,
  layoutRows,
  mergeFoldedArrows,
  PX_PER_DAY,
  ROW_HEIGHT,
  rowsMoved,
  scrollLeftFor,
  spanLabel,
  stackFlags,
  summarizeEpics,
  ticks,
  varianceLabel,
} from "../timelineLayout";

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

  it("gives each lane the span of its issues' work, for a folded lane's summary bar (ghosts have no dates)", () => {
    const { items } = layoutRows(nodes, timeline, laneOf, new Set(["lane:a"]));
    const header = items[0];
    // a1's zero-length span (this file's `entry` helper) counts as undated and is left out.
    expect(header.kind === "lane" && header.span).toEqual({ start: "2026-10-08", end: "2026-10-20" });
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

describe("stackFlags", () => {
  it("keeps flags that clear each other on one line", () => {
    const lines = stackFlags([
      { id: "a", right: 100, width: 50 },
      { id: "b", right: 200, width: 50 },
    ]);
    expect([...lines]).toEqual([
      ["a", 0],
      ["b", 0],
    ]);
  });

  it("moves an overlapping flag to the next free line, and reuses lines once clear", () => {
    const lines = stackFlags([
      { id: "c", right: 300, width: 80 }, // clears a: back on line 0
      { id: "b", right: 130, width: 80 }, // overlaps a (ends at 100, b starts at 50)
      { id: "a", right: 100, width: 80 },
    ]);
    expect(lines.get("a")).toBe(0);
    expect(lines.get("b")).toBe(1);
    expect(lines.get("c")).toBe(0);
  });

  it("needs the gap between flags on a line", () => {
    const lines = stackFlags([
      { id: "a", right: 100, width: 50 },
      { id: "b", right: 152, width: 50 }, // starts at 102: only 2px after a
    ]);
    expect(lines.get("b")).toBe(1);
  });
});

describe("layoutRows with a sort", () => {
  const byUidDesc = (a: GraphNode, b: GraphNode): number => Number(a.ghost) - Number(b.ghost) || b.uid.localeCompare(a.uid);
  const rowsOf = (items: ReturnType<typeof layoutRows>["items"]): string[] => items.map((i) => (i.kind === "row" ? i.node.uid : i.lane.id));

  it("orders rows by the sort instead of start date, ghosts still last", () => {
    const nodes = [node("a1"), node("a3"), node("g", true), node("a2")];
    const timeline = new Map([
      ["a1", entry("2026-10-01")],
      ["a2", entry("2026-10-02")],
      ["a3", entry("2026-10-03")],
      ["g", entry("2026-09-01")],
    ]);
    expect(rowsOf(layoutRows(nodes, timeline, undefined, new Set(), byUidDesc).items)).toEqual(["a3", "a2", "a1", "g"]);
  });

  it("falls back to start date on ties", () => {
    const tie = (): number => 0;
    const nodes = [node("late"), node("early")];
    const timeline = new Map([
      ["late", entry("2026-10-10")],
      ["early", entry("2026-10-05")],
    ]);
    expect(rowsOf(layoutRows(nodes, timeline, undefined, new Set(), tie).items)).toEqual(["early", "late"]);
  });

  it("with the real comparator, breaks ties by start date before key", () => {
    // Same priority; key order (A-1, A-2) is the opposite of start order.
    const nodes = [
      { ...node("A-1"), key: "A-1", priority: { name: "High", rank: 1 } },
      { ...node("A-2"), key: "A-2", priority: { name: "High", rank: 1 } },
    ];
    const timeline = new Map([
      ["A-1", entry("2026-10-20")],
      ["A-2", entry("2026-10-05")],
    ]);
    const order = ticketComparator(
      { key: "priority", reversed: false },
      { openBlockers: new Map(), downstream: new Map(), forecast: new Map() },
      { ties: "leave" },
    );
    expect(rowsOf(layoutRows(nodes, timeline, undefined, new Set(), order ?? undefined).items)).toEqual(["A-2", "A-1"]);
  });

  it("with the real comparator, breaks value-and-start ties by natural key (CORE-9 before CORE-10)", () => {
    const nodes = [
      { ...node("a:CORE-10"), key: "CORE-10", priority: { name: "High", rank: 1 } },
      { ...node("a:CORE-9"), key: "CORE-9", priority: { name: "High", rank: 1 } },
    ];
    const timeline = new Map([
      ["a:CORE-10", entry("2026-10-05")],
      ["a:CORE-9", entry("2026-10-05")],
    ]);
    const order = ticketComparator(
      { key: "priority", reversed: false },
      { openBlockers: new Map(), downstream: new Map(), forecast: new Map() },
      { ties: "leave" },
    );
    expect(rowsOf(layoutRows(nodes, timeline, undefined, new Set(), order ?? undefined).items)).toEqual(["a:CORE-9", "a:CORE-10"]);
  });

  it("orders lanes by their first row under the sort, catch-alls last", () => {
    const laneOf = (n: GraphNode): Lane =>
      n.uid.startsWith("z") ? { id: "lane:none", label: "None", last: true } : { id: `lane:${n.uid[0]}`, label: n.uid[0] };
    const nodes = [node("a1"), node("b1"), node("z9")];
    const timeline = new Map([
      ["a1", entry("2026-10-01")],
      ["b1", entry("2026-10-05")],
      ["z9", entry("2026-09-01")],
    ]);
    const lanes = layoutRows(nodes, timeline, laneOf, new Set(), byUidDesc).items.flatMap((i) => (i.kind === "lane" ? [i.lane.id] : []));
    expect(lanes).toEqual(["lane:b", "lane:a", "lane:none"]);
  });
});

describe("rowsMoved", () => {
  const at = (entries: [string, number][]): ReadonlyMap<string, number> => new Map(entries);
  it("is true when a row that's in both layouts is at a new height", () => {
    expect(
      rowsMoved(
        at([
          ["a", 0],
          ["b", 40],
        ]),
        at([
          ["a", 40],
          ["b", 0],
        ]),
      ),
    ).toBe(true);
  });
  it("is false when rows stay put, even if rows were added or removed", () => {
    expect(
      rowsMoved(
        at([
          ["a", 0],
          ["b", 40],
        ]),
        at([
          ["a", 0],
          ["b", 40],
        ]),
      ),
    ).toBe(false);
    expect(
      rowsMoved(
        at([["a", 0]]),
        at([
          ["a", 0],
          ["c", 40],
        ]),
      ),
    ).toBe(false);
    expect(
      rowsMoved(
        at([
          ["a", 0],
          ["b", 40],
        ]),
        at([["a", 0]]),
      ),
    ).toBe(false);
  });
});

describe("ticks", () => {
  const month = (d: string): string =>
    new Intl.DateTimeFormat(undefined, { month: "short", timeZone: "UTC", calendar: "gregory" }).format(new Date(`${d}T00:00:00Z`));

  it("names the month on the day scale where it starts, and on the first tick", () => {
    const t = ticks({ start: "2026-10-30", end: "2026-11-02" }, "day");
    expect(t[0].label).toContain(month("2026-10-30"));
    expect(t[0].label).toContain("30");
    const first = t.find((x) => x.day === "2026-11-01");
    expect(first?.label).toContain(month("2026-11-01"));
    expect(first?.major).toBe(true);
    expect(t.find((x) => x.day === "2026-10-31")?.label).not.toContain(month("2026-10-31")); // ordinary days stay short
  });

  it("gives the year on the week scale on the first tick and where a year begins", () => {
    const t = ticks({ start: "2026-12-14", end: "2027-01-12" }, "week");
    expect(t[0].label).toContain("2026");
    expect(t.find((x) => x.day === "2027-01-04")?.label).toContain("2027");
    expect(t.find((x) => x.day === "2026-12-21")?.label).not.toContain("2026");
  });
});

describe("varianceLabel", () => {
  // Measured against the estimate, not the due date (the ◆), so it never says "late".
  it("says how the forecast compares with the estimate", () => {
    expect(varianceLabel(3)).toBe("+3d over estimate");
    expect(varianceLabel(-2)).toBe("2d under estimate");
    expect(varianceLabel(0)).toBe("on estimate");
  });
});

describe("scrolling to a day", () => {
  const width = LABEL_WIDTH + 800; // 800px of chart beside the sticky labels

  it("puts a day at a fraction of the visible chart, never before the start", () => {
    // Day 40 at day scale is 1120px in; a quarter of 800px is 200px.
    expect(scrollLeftFor("2026-01-01", "2026-02-10", "day", width, 0.25)).toBe(40 * PX_PER_DAY.day - 200);
    expect(scrollLeftFor("2026-01-01", "2026-01-02", "day", width, 0.25)).toBe(0);
  });

  it("reads back the day at that fraction, so a new scale can keep it in place", () => {
    const left = scrollLeftFor("2026-01-01", "2026-02-10", "week", width, 0.5);
    expect(dayAt("2026-01-01", left, "week", width, 0.5)).toBe("2026-02-10");
  });
});

describe("spanLabel", () => {
  it("names the first and last days, or says the dates are unknown for an empty span", () => {
    expect(spanLabel({ start: "2026-10-05", end: "2026-10-08" })).toBe(`${fmtDay("2026-10-05")} – ${fmtDay("2026-10-07")}`);
    expect(spanLabel({ start: "2026-10-05", end: "2026-10-05" })).toBe("dates unknown");
  });
});

describe("lane span with undated work", () => {
  it("leaves out an empty (undated) span", () => {
    const undated: TimelineEntry = {
      projected: { start: "2026-10-05", end: "2026-10-05" },
      progress: { state: "unknown", forecast: { start: "2026-10-05", end: "2026-10-05" } },
      varianceDays: 0,
    };
    const dated: TimelineEntry = {
      projected: { start: "2026-10-01", end: "2026-10-03" },
      progress: { state: "not-started", forecast: { start: "2026-10-01", end: "2026-10-03" } },
      varianceDays: 0,
    };
    const laneOf = (): Lane => ({ id: "l", label: "L" });
    const { items } = layoutRows(
      [node("u"), node("d")],
      new Map([
        ["u", undated],
        ["d", dated],
      ]),
      laneOf,
      new Set(["l"]),
    );
    const header = items[0];
    expect(header.kind === "lane" && header.span).toEqual({ start: "2026-10-01", end: "2026-10-03" });
    const onlyUndated = layoutRows([node("u")], new Map([["u", undated]]), laneOf, new Set(["l"])).items[0];
    expect(onlyUndated.kind === "lane" && onlyUndated.span).toBeNull();
  });
});

describe("drawnBar", () => {
  it("treats an undated (empty-span) Done ticket as having no position, like a ghost", () => {
    const undated: TimelineEntry = {
      projected: { start: "2026-10-05", end: "2026-10-05" },
      progress: { state: "unknown", forecast: { start: "2026-10-05", end: "2026-10-05" } },
      varianceDays: 0,
    };
    expect(drawnBar(node("u"), undated, undefined).positionless).toBe(true);
    expect(drawnBar(node("d"), entry("2026-10-05"), undefined).positionless).toBe(true); // the test helper's empty span too
  });

  it("treats an epic summary with no dated work as having no position", () => {
    const empty = { start: "2026-10-05", end: "2026-10-05" };
    expect(drawnBar(node("e"), entry("2026-10-05"), { projected: empty, work: empty, children: 2 }).positionless).toBe(true);
    const dated = { start: "2026-10-05", end: "2026-10-08" };
    expect(drawnBar(node("e"), entry("2026-10-05"), { projected: dated, work: dated, children: 2 }).positionless).toBe(false);
  });
});

describe("roomAfter", () => {
  it("leaves enough chart after today to scroll it a quarter of the way in", () => {
    // 800px of visible chart: today at a quarter needs 600px after it.
    expect(roomAfter(1000, LABEL_WIDTH + 800, 0.25)).toBe(1600);
  });
});

describe("unobscuredWidth", () => {
  it("is the box's width, less what the details drawer covers on its right", () => {
    expect(unobscuredWidth(100, 1100)).toBe(1000);
    expect(unobscuredWidth(100, 1100, 740)).toBe(640);
    expect(unobscuredWidth(100, 1100, 1200)).toBe(1000); // a drawer elsewhere covers nothing
  });
});

describe("summarizeEpics with undated children", () => {
  const child = (uid: string): GraphNode => ({ ...node(uid), epic: { uid: "E", key: "E", summary: "Epic", url: "" } });
  const span = (start: string, end: string): TimelineEntry => ({
    projected: { start, end },
    progress: { state: "not-started", forecast: { start, end } },
    varianceDays: 0,
  });

  it("leaves an undated child's empty placeholder out of the epic's envelope", () => {
    const e = summarizeEpics(
      [child("a"), child("b")],
      new Map([
        ["a", span("2026-09-29", "2026-09-30")],
        ["b", span("2026-10-05", "2026-10-05")],
      ]),
    ).get("E");
    expect(e?.work).toEqual({ start: "2026-09-29", end: "2026-09-30" });
    expect(e?.projected).toEqual({ start: "2026-09-29", end: "2026-09-30" });
  });
});

type Flags = { violated: boolean; inCycle: boolean; critical: boolean; dimmed: boolean };

describe("mergeFoldedArrows", () => {
  const arrow = (id: string, source: string, target: string): { edge: { id: string; source: string; target: string } } => ({
    edge: { id, source, target },
  });

  it("draws one arrow per pair of ends, a folded lane counting as one end", () => {
    const folded = new Map([
      ["a1", "lane:A"],
      ["a2", "lane:A"],
    ]);
    const kept = mergeFoldedArrows([arrow("1", "a1", "x"), arrow("2", "a2", "x"), arrow("3", "a1", "y"), arrow("4", "z", "x")], folded);
    expect(kept.map((a) => a.edge.id)).toEqual(["1", "3", "4"]);
  });

  it("keeps the warnings of the arrows it merges: a cycle or late start never hides behind a plain one", () => {
    const flagged = (id: string, source: string, f: Partial<Flags>): { edge: { id: string; source: string; target: string } } & Flags => ({
      edge: { id, source, target: "x" },
      violated: false,
      inCycle: false,
      critical: false,
      dimmed: true,
      ...f,
    });
    const [merged] = mergeFoldedArrows(
      [flagged("1", "a1", {}), flagged("2", "a2", { inCycle: true, violated: true, dimmed: false })],
      new Map([
        ["a1", "lane:A"],
        ["a2", "lane:A"],
      ]),
    );
    expect(merged).toMatchObject({ inCycle: true, violated: true, critical: false, dimmed: false });
  });

  it("keeps every arrow between unfolded rows", () => {
    expect(mergeFoldedArrows([arrow("1", "a", "x"), arrow("2", "b", "x")], new Map()).map((a) => a.edge.id)).toEqual(["1", "2"]);
  });
});
