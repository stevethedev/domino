import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { InfoTip, focusLeaves, tipShift } from "../InfoTip";
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

  it("floats by default, and fits its row in the sidebar", () => {
    expect(tip()).toContain('<div class="info-tip-text popover">');
    expect(tip({ inline: true })).toMatch(/^<details class="info-tip inline">/);
    expect(tip({ inline: true })).toContain('<div class="info-tip-text">');
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

describe("tipShift", () => {
  const bounds = { minLeft: 100, maxRight: 900 };

  it("leaves a tip that fits where it is", () => {
    expect(tipShift({ left: 300, right: 580, ...bounds })).toBe(0);
  });

  it("moves a tip that runs past the right edge (or under the details drawer) back inside", () => {
    expect(tipShift({ left: 700, right: 980, ...bounds })).toBe(-80);
  });

  it("never moves it past the left edge: a tip wider than the space starts at the left", () => {
    expect(tipShift({ left: 150, right: 1050, ...bounds })).toBe(-50);
  });
});
