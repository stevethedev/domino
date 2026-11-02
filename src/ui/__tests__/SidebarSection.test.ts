import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SidebarSection } from "../SidebarSection";

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
