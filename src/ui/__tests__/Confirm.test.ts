import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi, type Mock } from "vitest";
import { Confirm, confirmKey } from "../Confirm";
import { markupText } from "./markupText";

const confirm = (inline = false): string =>
  renderToStaticMarkup(
    createElement(Confirm, {
      label: "Remove Acme",
      inline,
      confirm: { label: "Remove", run: vi.fn() },
      cancel: { label: "Keep", run: vi.fn() },
      children: "Remove Acme?",
    }),
  );

describe("Confirm", () => {
  it("is a group named for what it asks, described by its question", () => {
    const out = confirm();
    const describedBy = /^<div role="group" aria-label="Remove Acme" aria-describedby="([^"]+)"/.exec(out)?.[1];
    expect(describedBy).toBeDefined();
    expect(out).toContain(`<div id="${describedBy ?? ""}" class="banner-text">Remove Acme?</div>`);
  });

  it("offers the risky choice as a danger button, then the safe one", () => {
    const out = confirm();
    expect(out).toContain('<button type="button" class="danger">Remove</button><button type="button">Keep</button>');
    expect(markupText(out)).toBe("Remove Acme?RemoveKeep");
  });

  it("is a banner by default, and fits a row or list item inline", () => {
    expect(confirm()).toContain('class="banner warn actionable"');
    expect(confirm(true)).toContain('class="confirm-inline"');
    expect(confirm(true)).toContain('class="confirm-question"');
  });
});

/** A key event stand-in: which key, and whether it was stopped. */
const key = (k: string): { key: string; preventDefault: Mock<() => void>; stopPropagation: Mock<() => void> } => ({
  key: k,
  preventDefault: vi.fn<() => void>(),
  stopPropagation: vi.fn<() => void>(),
});

describe("confirmKey", () => {
  it("takes Esc as the safe choice, and keeps it from the menu or dialog around it", () => {
    const cancel = vi.fn();
    const esc = key("Escape");
    confirmKey(esc, cancel);
    expect(cancel).toHaveBeenCalledOnce();
    expect(esc.stopPropagation).toHaveBeenCalled();
    expect(esc.preventDefault).toHaveBeenCalled(); // or a dialog closes on it natively
  });

  it("leaves other keys alone", () => {
    const cancel = vi.fn();
    const enter = key("Enter");
    confirmKey(enter, cancel);
    expect(cancel).not.toHaveBeenCalled();
    expect(enter.stopPropagation).not.toHaveBeenCalled();
    expect(enter.preventDefault).not.toHaveBeenCalled();
  });
});
