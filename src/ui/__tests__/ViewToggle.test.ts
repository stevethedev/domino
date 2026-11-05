import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ViewToggle } from "../ViewToggle";
import { markupText } from "./markupText";

const out = renderToStaticMarkup(createElement(ViewToggle, { value: "graph", onChange: () => undefined }));

describe("ViewToggle", () => {
  // Like Find's "/": the key is shown, not only in the (folded) Legend or a hover title.
  it("shows each view's key, which screen readers get from aria-keyshortcuts instead", () => {
    expect(out).toContain('<kbd class="view-key" aria-hidden="true">g</kbd>');
    expect(out).toContain('<kbd class="view-key" aria-hidden="true">t</kbd>');
    expect(out).toContain('aria-keyshortcuts="g"');
    expect(markupText(out)).toBe("ViewGraphgTimelinet");
  });
});
