import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AgingBadge, BlockedCount, BlockersBadge, capBadges, CycleTag } from "../IssueCard";

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
