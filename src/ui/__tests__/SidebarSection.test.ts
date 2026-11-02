import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { catchesLostFocus, SidebarSection } from "../SidebarSection";

const section = (props: Partial<Parameters<typeof SidebarSection>[0]>): string =>
  renderToStaticMarkup(createElement(SidebarSection, { id: "changes", title: "Since you last looked", children: "body", ...props }));

describe("SidebarSection", () => {
  it("is a toggle with its body when it has something to show", () => {
    const out = section({});
    expect(out).toContain('aria-expanded="true"');
    expect(out).toContain("body");
  });

  it("with nothing to show, is one line saying so: no toggle, no body", () => {
    const out = section({ empty: true });
    expect(out).not.toContain("<button");
    expect(out).not.toContain("body");
    expect(out.replace(/<[^>]+>/g, "")).toBe("Since you last looked · none");
    expect(out).toMatch(/<section class="sb-section empty"/);
  });

  it("with nothing to show, its heading can still take focus (for focus lost when its body goes away)", () => {
    expect(section({ empty: true })).toMatch(/<span class="sb-toggle" tabindex="-1"/);
  });

  it("doesn't color an empty section as needing attention", () => {
    expect(section({ empty: true, tone: "warn" })).not.toContain("tone-warn");
  });
});

describe("catchesLostFocus", () => {
  const at = (over: Partial<Parameters<typeof catchesLostFocus>[0]> = {}): boolean =>
    catchesLostFocus({ becameEmpty: true, hadFocus: true, focusOnPage: true, ...over });

  it("catches focus its own removed body dropped (Mark as seen)", () => {
    expect(at()).toBe(true);
  });

  it("leaves focus alone when the section never had it (first load empties it with focus on the page)", () => {
    expect(at({ hadFocus: false })).toBe(false);
  });

  it("leaves focus alone when it went somewhere else, or the section didn't just empty", () => {
    expect(at({ focusOnPage: false })).toBe(false);
    expect(at({ becameEmpty: false })).toBe(false);
  });
});
