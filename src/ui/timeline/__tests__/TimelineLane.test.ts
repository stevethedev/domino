import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { laneKey, TimelineLane } from "../TimelineLane";
import type { TimelineLaneModel } from "../timelineLayout";

const item = (over: Partial<TimelineLaneModel> = {}): TimelineLaneModel => ({
  kind: "lane",
  lane: { id: "epic:a:E-1", label: "E-1 · Checkout", url: "https://a.example/E-1" },
  y: 0,
  count: 3,
  collapsed: false,
  late: 0,
  span: null,
  ...over,
});
const header = (over: Partial<Parameters<typeof TimelineLane>[0]> = {}): string =>
  renderToStaticMarkup(
    createElement(TimelineLane, {
      item: item(),
      onToggle: () => undefined,
      onOpen: () => undefined,
      onRove: () => false,
      onFocusItem: () => undefined,
      tabbable: false,
      rangeStart: null,
      scale: "week",
      ...over,
    }),
  );

describe("laneKey", () => {
  it("folds an open lane with ←, and unfolds a folded one with →", () => {
    expect(laneKey("ArrowLeft", false)).toBe("fold");
    expect(laneKey("ArrowRight", true)).toBe("unfold");
  });

  // Still the header's key: left alone, it would pan the chart sideways.
  it("keeps ←/→ when the lane is already that way, changing nothing", () => {
    expect(laneKey("ArrowLeft", true)).toBe("stay");
    expect(laneKey("ArrowRight", false)).toBe("stay");
  });

  it("leaves other keys to the timeline", () => {
    expect(laneKey("ArrowDown", false)).toBeNull();
    expect(laneKey("Enter", true)).toBeNull();
  });
});

describe("TimelineLane", () => {
  it("is part of the timeline's one Tab stop: reachable by Tab only when it's the stop", () => {
    expect(header({ tabbable: true })).toMatch(/<button type="button" class="tl-lane-toggle" tabindex="0"/);
    expect(header({ tabbable: false })).toMatch(/<button type="button" class="tl-lane-toggle" tabindex="-1"/);
  });

  it("names its keys, and carries the lane id arrow keys find it by", () => {
    const out = header();
    expect(out).toContain('aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Home End PageUp PageDown"');
    expect(out).toContain('data-tl-lane="epic:a:E-1"');
  });

  // ⌘/Ctrl+Enter on the header opens it instead, so the button needn't be a Tab stop of its own.
  it("keeps the epic's Jira button out of the Tab order", () => {
    expect(header()).toMatch(/<button type="button" class="link-btn tl-lane-name" tabindex="-1"/);
  });
});
