import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { InfoTip, focusLeaves, tipFit } from "../InfoTip";
import { markupText } from "./markupText";

const tip = (props: Partial<Parameters<typeof InfoTip>[0]> = {}): string =>
  renderToStaticMarkup(createElement(InfoTip, { id: "tip-1", label: "Days / point", children: "How long a point takes.", ...props }));

describe("InfoTip", () => {
  it("is a disclosure named for the field it explains, its ⓘ hidden from screen readers", () => {
    const out = tip();
    expect(out).toMatch(/^<details class="info-tip">/);
    expect(out).toMatch(/<summary aria-label="About Days \/ point"><span aria-hidden="true">ⓘ<\/span><\/summary>/);
  });

  // Chrome leaves text inside a closed <details> out of a description, so the copy the field's
  // aria-describedby points at sits outside it, hidden.
  it("keeps a hidden copy of the explanation, outside the details, for the field's aria-describedby", () => {
    const out = tip();
    expect(out).toMatch(/<\/details><div id="tip-1" hidden="">How long a point takes\.<\/div>$/);
    expect(out.match(/id="tip-1"/g)).toHaveLength(1);
    expect(markupText(out)).toBe("ⓘHow long a point takes.How long a point takes.");
  });

  // Clicking its text (to read or select it) moves focus to the panel, inside the tip, so it stays open.
  it("floats by default, and fits its row in the sidebar; its panel takes focus when clicked", () => {
    expect(tip()).toContain('<div class="info-tip-text popover" tabindex="-1">');
    expect(tip({ inline: true })).toMatch(/^<details class="info-tip inline">/);
    expect(tip({ inline: true })).toContain('<div class="info-tip-text" tabindex="-1">');
  });
});

describe("focusLeaves", () => {
  const inside = { id: "inside" };
  const box = { contains: (n: unknown): boolean => n === inside };

  it("is true when focus moves out of the tip, or off the page", () => {
    expect(focusLeaves(box, { id: "elsewhere" })).toBe(true);
    expect(focusLeaves(box, null)).toBe(true);
  });

  it("is false while focus stays inside the tip", () => {
    expect(focusLeaves(box, inside)).toBe(false);
  });
});

describe("tipFit", () => {
  const bounds = { minLeft: 100, maxRight: 900 };

  it("leaves a tip that fits where it is", () => {
    expect(tipFit({ left: 300, right: 580, ...bounds })).toEqual({ shift: 0 });
  });

  it("moves a tip that runs past the right edge (or under the details drawer) back inside", () => {
    expect(tipFit({ left: 700, right: 980, ...bounds })).toEqual({ shift: -80 });
  });

  // 850px window: 248px sidebar and 360px drawer leave 242px, less than the tip's 280px.
  it("narrows a tip wider than the space, so it wraps, and starts it at the left edge", () => {
    expect(tipFit({ left: 300, right: 580, minLeft: 248, maxRight: 490 })).toEqual({ maxWidth: 242, shift: -52 });
  });
});
