import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { GraphNode } from "../../../graph/types";
import { TimelineRow, type RowFlags } from "../TimelineRow";

const node: GraphNode = {
  uid: "a:CORE-1",
  siteId: "a",
  siteLabel: "a",
  key: "CORE-1",
  summary: "Checkout v2",
  issueType: "Story",
  statusName: "To Do",
  statusCategory: "todo",
  url: "",
  ghost: false,
};

const row = (
  flags: Partial<RowFlags>,
  epic?: { projected: { start: string; end: string }; work: { start: string; end: string }; children: number },
  tabbable = false,
): string =>
  renderToStaticMarkup(
    createElement(TimelineRow, {
      row: {
        kind: "row",
        node,
        entry: {
          projected: { start: "2026-11-02", end: "2026-11-05" },
          progress: { state: "not-started", forecast: { start: "2026-11-02", end: "2026-11-05" } },
          varianceDays: 0,
        },
        y: 0,
        folded: false,
      },
      epic,
      rangeStart: "2026-11-01",
      scale: "day",
      today: "2026-11-02",
      flags: { dimmed: false, critical: false, ready: false, ...flags },
      selected: false,
      onSelect: () => undefined,
      onOpen: () => undefined,
      onHover: () => undefined,
      onTraverse: () => false,
      onRove: () => false,
      onFocusItem: () => undefined,
      tabbable,
    }),
  );

describe("TimelineRow", () => {
  it("names a critical-path row with a Critical badge, not only a coloured bar", () => {
    const out = row({ critical: true });
    expect(out).toContain('<span class="tag-critical">Critical</span>');
    expect(out).toMatch(/aria-label="[^"]*on critical path/);
  });

  it("keeps the Critical badge in sight when other badges fill the row (it's the highlight asked for)", () => {
    const out = row({ critical: true, missedReleases: ["Checkout 2.4"], aging: { kind: "stuck", days: 23, estimateDays: 5 } });
    const visible = out.split('class="badge-more"')[0];
    expect(visible).toContain("tag-critical");
  });

  it("says an epic row is on the critical path in its label too", () => {
    const span = { start: "2026-11-02", end: "2026-11-05" };
    expect(row({ critical: true }, { projected: span, work: span, children: 2 })).toMatch(/aria-label="Epic [^"]*on critical path/);
  });

  it("shows no Critical badge off the critical path", () => {
    expect(row({})).not.toContain("tag-critical");
  });

  it("is part of the timeline's one Tab stop: reachable by Tab only when it's the stop", () => {
    expect(row({}, undefined, true)).toMatch(/<div class="tl-row[^"]*"[^>]*tabindex="0"/);
    expect(row({}, undefined, false)).toMatch(/<div class="tl-row[^"]*"[^>]*tabindex="-1"/);
    expect(row({ stale: true }, undefined, true)).toMatch(/tabindex="-1"/);
  });

  it("names its keys: ←/→ follow links, ↑ ↓ Home End PgUp PgDn move through the timeline", () => {
    expect(row({})).toContain('aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Home End PageUp PageDown"');
  });
});
