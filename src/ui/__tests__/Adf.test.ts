import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { mockSites } from "../../data/mockData";
import { AdfDocument, hasContent } from "../Adf";

const html = (doc: unknown): string => renderToStaticMarkup(createElement(AdfDocument, { doc, onOpen: () => undefined }));
const doc = (...content: unknown[]): unknown => ({ type: "doc", version: 1, content });
const p = (...content: unknown[]): unknown => ({ type: "paragraph", content });
const text = (t: string, ...marks: unknown[]): unknown => ({ type: "text", text: t, marks });

describe("AdfDocument", () => {
  it("renders paragraphs, headings and marks as elements", () => {
    const out = html(
      doc(
        { type: "heading", attrs: { level: 2 }, content: [text("Goals")] },
        p(text("bold", { type: "strong" }), text(" "), text("em", { type: "em" }), text(" "), text("x()", { type: "code" })),
      ),
    );
    expect(out).toContain("<h4>Goals</h4>");
    expect(out).toContain("<strong>bold</strong>");
    expect(out).toContain("<em>em</em>");
    expect(out).toContain("<code>x()</code>");
  });

  it("keeps heading levels below the panel's own headings", () => {
    expect(html(doc({ type: "heading", attrs: { level: 1 }, content: [text("A")] }))).toContain("<h4>A</h4>");
    expect(html(doc({ type: "heading", attrs: { level: 6 }, content: [text("B")] }))).toContain("<h6>B</h6>");
  });

  it("escapes text: markup in a description is shown, never parsed", () => {
    const out = html(doc(p(text("<img src=x onerror=alert(1)>"))));
    expect(out).not.toContain("<img");
    expect(out).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("links only https URLs; anything else is plain text", () => {
    const link = (href: string): unknown => text("here", { type: "link", attrs: { href } });
    expect(html(doc(p(link("https://example.com/a"))))).toContain('href="https://example.com/a"');
    for (const bad of ["javascript:alert(1)", "http://example.com", "data:text/html,x", "file:///etc/passwd"]) {
      const out = html(doc(p(link(bad))));
      expect(out).not.toContain("<a");
      expect(out).toContain("here");
    }
  });

  it("renders lists, code, quotes, tables and task items", () => {
    const out = html(
      doc(
        { type: "bulletList", content: [{ type: "listItem", content: [p(text("one"))] }] },
        { type: "orderedList", content: [{ type: "listItem", content: [p(text("two"))] }] },
        { type: "codeBlock", content: [text("a\nb")] },
        { type: "blockquote", content: [p(text("q"))] },
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                { type: "tableHeader", content: [p(text("H"))] },
                { type: "tableCell", content: [p(text("C"))] },
              ],
            },
          ],
        },
        { type: "taskList", content: [{ type: "taskItem", attrs: { state: "DONE" }, content: [text("done")] }] },
      ),
    );
    expect(out).toContain("<ul><li><p>one</p></li></ul>");
    expect(out).toContain("<ol><li><p>two</p></li></ol>");
    expect(out).toContain("<pre><code>a\nb</code></pre>");
    expect(out).toContain("<blockquote><p>q</p></blockquote>");
    expect(out).toContain("<th><p>H</p></th><td><p>C</p></td>");
    expect(out).toMatch(/aria-checked="true"|☑/);
  });

  it("shows inline nodes by their text: mentions, emoji, status, dates, cards", () => {
    const out = html(
      doc(
        p(
          { type: "mention", attrs: { id: "a", text: "@Priya Raman" } },
          { type: "emoji", attrs: { shortName: ":rocket:", text: "🚀" } },
          { type: "status", attrs: { text: "SDK 4.2" } },
          { type: "date", attrs: { timestamp: "1793836800000" } },
          { type: "inlineCard", attrs: { url: "https://example.com/card" } },
        ),
      ),
    );
    expect(out).toContain("@Priya Raman");
    expect(out).toContain("🚀");
    expect(out).toContain("SDK 4.2");
    expect(out).toContain("Nov 5, 2026");
    expect(out).toContain('href="https://example.com/card"');
  });

  it("stands in for images and attachments, which need a Jira sign-in", () => {
    const out = html(doc({ type: "mediaSingle", content: [{ type: "media", attrs: { id: "m1", type: "file" } }] }));
    expect(out).toContain("Image");
    expect(out).not.toContain("<img");
  });

  it("skips unknown and malformed nodes without failing", () => {
    expect(() => html(doc({ type: "futureNode", content: [p(text("kept"))] }, null, 7, { content: "x" }))).not.toThrow();
    expect(html(doc({ type: "futureNode", content: [p(text("kept"))] }))).toContain("kept");
    expect(html("not a doc")).toBe("");
    expect(html(null)).toBe("");
  });

  it("ignores out-of-range dates instead of throwing", () => {
    for (const timestamp of ["1e16", "-1e16", "NaN", "soon"]) {
      expect(() => html(doc(p({ type: "date", attrs: { timestamp } })))).not.toThrow();
    }
  });

  it("only uses known panel types as classes", () => {
    const panel = (panelType: string): string => html(doc({ type: "panel", attrs: { panelType }, content: [p(text("x"))] }));
    expect(panel("warning")).toContain('class="adf-panel adf-panel-warning"');
    expect(panel("detail-description expanded")).toContain('class="adf-panel adf-panel-info"');
  });

  it("stops after a node budget, so a huge document can't freeze the panel", () => {
    const many = Array.from({ length: 50_000 }, (_, i) => p(text(`n${i}`)));
    const out = html(doc(...many));
    expect(out).toContain("n0");
    expect(out).not.toContain("n49999");
  });

  it("stops at a nesting limit instead of overflowing the stack", () => {
    let deep: unknown = text("bottom");
    for (let i = 0; i < 5000; i++) deep = { type: "blockquote", content: [deep] };
    expect(() => html(doc(deep))).not.toThrow();
  });

  it("renders every fixture description, each a well-formed document", () => {
    // Every node is an object with a type, so the fixtures exercise the renderer, not its skipping.
    const malformed = (n: unknown): boolean =>
      typeof n !== "object" ||
      n === null ||
      !("type" in n) ||
      typeof n.type !== "string" ||
      ("content" in n && Array.isArray(n.content) && n.content.some(malformed));
    for (const site of Object.values(mockSites)) {
      for (const d of Object.values(site.descriptions ?? {})) {
        expect(malformed(d)).toBe(false);
        expect(() => html(d)).not.toThrow();
      }
    }
  });
});

describe("hasContent", () => {
  it("is false for missing, empty and whitespace-only documents", () => {
    expect(hasContent(null)).toBe(false);
    expect(hasContent(doc())).toBe(false);
    expect(hasContent(doc(p()))).toBe(false);
    expect(hasContent(doc(p(text("  "))))).toBe(false);
    expect(hasContent(doc(p(text("x"))))).toBe(true);
    expect(hasContent(doc({ type: "mediaSingle", content: [{ type: "media", attrs: {} }] }))).toBe(true);
    // Empty containers have nothing to show either.
    expect(hasContent(doc({ type: "heading", attrs: { level: 2 }, content: [] }))).toBe(false);
    expect(hasContent(doc({ type: "bulletList", content: [{ type: "listItem", content: [p()] }] }))).toBe(false);
    expect(hasContent(doc({ type: "table", content: [{ type: "tableRow", content: [{ type: "tableCell", content: [p()] }] }] }))).toBe(
      false,
    );
    expect(hasContent(doc({ type: "rule" }))).toBe(true);
    expect(hasContent(doc(p({ type: "mention", attrs: { text: "@A" } })))).toBe(true);
  });
});
