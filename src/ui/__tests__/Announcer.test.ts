import { afterEach, describe, expect, it, vi } from "vitest";
import { announce, listen, regionFor, spokenText } from "../Announcer";

describe("regionFor", () => {
  const page = { polite: "page-polite", assertive: "page-assertive" };
  const dialog = { polite: "dialog-polite", assertive: "dialog-assertive" };

  it("is the page's regions while nothing else listens", () => {
    expect(regionFor([page], false)).toBe("page-polite");
    expect(regionFor([page], true)).toBe("page-assertive");
  });

  it("is an open modal's regions, the rest of the page being inert", () => {
    expect(regionFor([page, dialog], false)).toBe("dialog-polite");
    expect(regionFor([page, dialog], true)).toBe("dialog-assertive");
  });

  it("is nowhere before any regions mount", () => {
    expect(regionFor([], false)).toBeUndefined();
  });
});

/** A live region stand-in: only its text matters. */
const region = (): { textContent: string } => ({ textContent: "" });
const regions = (): { polite: { textContent: string }; assertive: { textContent: string } } => ({ polite: region(), assertive: region() });

describe("announce", () => {
  const unlisten: (() => void)[] = [];
  afterEach(() => {
    for (const stop of unlisten.splice(0)) stop();
    vi.useRealTimers();
  });

  it("reads messages from different sources in the same moment, in order", () => {
    vi.useFakeTimers();
    const page = regions();
    unlisten.push(listen(page));
    announce("Nothing found in change/outreach.", { source: "empty-search" });
    announce("No tickets match this scope.", { source: "canvas" });
    vi.runAllTimers();
    expect(page.polite.textContent).toBe("Nothing found in change/outreach. No tickets match this scope.");
  });

  it("lets a source's newer message replace its own one not yet read", () => {
    vi.useFakeTimers();
    const page = regions();
    unlisten.push(listen(page));
    announce("Showing 7 of 12 tickets", { source: "filters" });
    announce("Showing 5 of 12 tickets", { source: "filters" });
    vi.runAllTimers();
    expect(page.polite.textContent).toBe("Showing 5 of 12 tickets");
  });

  it("delivers to the regions listening when it's read, not when it was asked", () => {
    vi.useFakeTimers();
    const page = regions();
    const dialog = regions();
    unlisten.push(listen(page));
    announce("Saved.", { source: "settings" });
    unlisten.push(listen(dialog)); // Settings opened before the text went out
    vi.runAllTimers();
    expect(dialog.polite.textContent).toBe("Saved.");
    expect(page.polite.textContent).toBe("");
  });
});

/** Stand-ins for DOM nodes: text, or an element with attributes and children. */
const text = (data: string): Node => ({ nodeType: 3, textContent: data }) as unknown as Node;
const el = (attrs: Record<string, string>, ...childNodes: Node[]): Node =>
  ({ nodeType: 1, childNodes, getAttribute: (name: string) => attrs[name] ?? null }) as unknown as Node;

describe("spokenText", () => {
  it("leaves out aria-hidden parts, keeping text only screen readers see", () => {
    const loading = el(
      {},
      el({ "aria-hidden": "true" }, text("◐ Acme ✓ Partner")),
      el({ class: "sr-only" }, text("Loading 1 of 2 sites.")),
    );
    expect(spokenText(loading)).toBe("Loading 1 of 2 sites.");
  });

  it("joins the text of everything else", () => {
    expect(spokenText(el({}, text("All 3 tickets are "), el({}, text("hidden")), text(".")))).toBe("All 3 tickets are hidden.");
  });
});
