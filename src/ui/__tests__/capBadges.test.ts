import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { GraphNode } from "../../graph/types";
import { AgingBadge, BlockedCount, BlockersBadge, capBadges, cardBadges, CriticalTag, CycleTag, rollupLabel, TypeKey } from "../IssueCard";

const shown = (n: number, slots: number, full?: number): string => {
  const { visible, rest } = capBadges(["a", "b", "c", "d"].slice(0, n), slots, full);
  return `${visible.join("")}${rest.length ? `+${rest.length}` : ""}`;
};

describe("capBadges", () => {
  it("fills a card's two slots, folding the rest into a +N chip", () => {
    expect([0, 1, 2, 3, 4].map((n) => shown(n, 2))).toEqual(["", "a", "ab", "a+2", "a+3"]);
  });

  it("shows at most `full` whole badges, so zoomed-out cards fit one badge and a +N", () => {
    expect([0, 1, 2, 3].map((n) => shown(n, 2, 1))).toEqual(["", "a", "a+1", "a+2"]);
  });
});

describe("badge words zoomed-out cards drop", () => {
  it("marks the words around a badge's number, so compact cards can show icon and number only", () => {
    const blockers = renderToStaticMarkup(createElement(BlockersBadge, { count: 2 }));
    expect(blockers).toContain('2<span class="badge-word"> blockers</span>');
    expect(blockers).toContain('title="2 open blockers"');
    const aging = renderToStaticMarkup(createElement(AgingBadge, { aging: { kind: "stuck", days: 19, estimateDays: 8 } }));
    expect(aging).toContain('<span class="badge-word">stuck </span>19d');
  });
});

describe("epic summary card badges", () => {
  it("drop their words zoomed out too, keeping them in the tooltip", () => {
    const cycle = renderToStaticMarkup(createElement(CycleTag, { title: "In a blocking cycle" }));
    expect(cycle).toContain('⟲<span class="badge-word"> Cycle</span>');
    expect(cycle).toContain('title="In a blocking cycle"');
    const blocked = renderToStaticMarkup(createElement(BlockedCount, { count: 3 }));
    expect(blocked).toContain('3<span class="badge-word"> blocked</span>');
    expect(blocked).toContain('title="3 tickets blocked"');
  });
});

describe("CriticalTag", () => {
  it("says Critical in words, so the critical path isn't shown by colour alone", () => {
    expect(renderToStaticMarkup(createElement(CriticalTag))).toBe('<span class="tag-critical">Critical</span>');
  });
});

describe("cardBadges", () => {
  const keys = (over: Partial<Parameters<typeof cardBadges>[0]> = {}): string[] =>
    cardBadges({ inCycle: true, openBlockers: 2, highlight: null, ...over }).map((b) => b.key);

  it("leads with a cycle, then blockers, when nothing is highlighted", () => {
    expect(keys({ change: "blocked" })).toEqual(["cycle", "blockers", "change"]);
  });

  it("leads with the badge that answers the highlight, so a capped or zoomed-out card still shows it", () => {
    expect(keys({ highlight: "critical" })[0]).toBe("critical");
    expect(keys({ highlight: "ready", inCycle: false, openBlockers: 0, change: "blocked" })[0]).toBe("ready");
  });
});

describe("rollupLabel", () => {
  const epic: GraphNode = {
    uid: "a:CORE-1",
    siteId: "a",
    siteLabel: "a",
    key: "CORE-1",
    summary: "Checkout v2",
    issueType: "Epic",
    statusName: "In Progress",
    statusCategory: "inprogress",
    url: "",
    ghost: false,
  };
  const rollup = { epicUid: epic.uid, members: ["a:CORE-2", "a:CORE-3"], done: 0, blocked: 0, aging: 0 };

  // The epic itself can be what matched (it folds into its own summary), even with no tickets loaded.
  it("says which highlight lit up a folded epic, not only by its ring, without claiming it's the tickets", () => {
    expect(rollupLabel(epic, rollup, "critical")).toContain("on the critical path (it or some of its tickets)");
    expect(rollupLabel(epic, rollup, "ready")).toContain("ready to start (it or some of its tickets)");
    expect(rollupLabel(epic, rollup, null)).not.toMatch(/critical|ready/);
  });
});

describe("TypeKey", () => {
  const out = renderToStaticMarkup(createElement(TypeKey));
  it("lists each type letter once, with the real icon and its name", () => {
    expect(out.match(/<li>/g)).toHaveLength(5);
    expect(out).toMatch(/<span class="type-icon type-story"[^>]*>S<\/span> Story/);
    expect(out).toMatch(/<span class="type-icon type-sub-task"[^>]*>s<\/span> Sub-task/);
    expect(out).not.toContain("Subtask");
  });
});
