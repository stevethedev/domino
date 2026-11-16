import { describe, expect, it, vi } from "vitest";
import { focusRequest } from "../focusRequest";
import { focusFirstOf } from "../useFocusReturn";

type FakeElement = HTMLElement & { focus: ReturnType<typeof vi.fn> };

/** A stand-in element: on the page and rendered unless told otherwise, and focusable. */
function fakeElement(opts: { connected?: boolean; rendered?: boolean; takesFocus?: boolean } = {}): FakeElement {
  const doc = { activeElement: null as unknown };
  const el = {
    isConnected: opts.connected ?? true,
    getClientRects: (): { length: number } => ({ length: (opts.rendered ?? true) ? 1 : 0 }),
    focus: vi.fn(() => {
      if (opts.takesFocus ?? true) doc.activeElement = el;
    }),
    ownerDocument: doc,
  };
  return el as unknown as FakeElement;
}

describe("focusFirstOf", () => {
  it("focuses the first candidate that's on the page", () => {
    const [first, second] = [fakeElement(), fakeElement()];
    expect(focusFirstOf([first, second])).toBe(true);
    expect(first.focus).toHaveBeenCalled();
    expect(second.focus).not.toHaveBeenCalled();
  });

  it("skips ones that are missing, removed, not rendered, or ignore focus", () => {
    const removed = fakeElement({ connected: false });
    const hidden = fakeElement({ rendered: false });
    const inert = fakeElement({ takesFocus: false });
    const target = fakeElement();
    expect(focusFirstOf([null, undefined, removed, hidden, inert, target])).toBe(true);
    expect(removed.focus).not.toHaveBeenCalled();
    expect(hidden.focus).not.toHaveBeenCalled();
    expect(target.focus).toHaveBeenCalled();
  });

  it("is false when none take focus", () => {
    expect(focusFirstOf([null, fakeElement({ connected: false })])).toBe(false);
    expect(focusFirstOf([])).toBe(false);
  });
});

describe("focusRequest", () => {
  it("waits for any of its ids", () => {
    expect([...focusRequest(["a", "epic-summary:e"], vi.fn(), vi.fn()).ids]).toEqual(["a", "epic-summary:e"]);
  });

  it("runs once, however many of its items answer, clearing itself first", () => {
    const calls: string[] = [];
    const request = focusRequest(
      ["a", "b"],
      () => calls.push("then"),
      () => calls.push("done"),
    );
    request.drawn();
    request.drawn();
    expect(calls).toEqual(["done", "then"]);
  });
});
