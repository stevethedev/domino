import { describe, expect, it } from "vitest";
import { tabStopOf } from "../useRovingStop";

const on =
  (...ids: string[]): ((id: string) => boolean) =>
  (id) =>
    ids.includes(id);

describe("tabStopOf", () => {
  it("is the item last focused, while it's still there", () => {
    expect(tabStopOf({ lastFocused: "b", selected: "c", has: on("a", "b", "c"), first: "a" })).toBe("b");
  });

  it("else the open issue, so Tab lands where the details are", () => {
    expect(tabStopOf({ lastFocused: "gone", selected: "c", has: on("a", "c"), first: "a" })).toBe("c");
    expect(tabStopOf({ lastFocused: null, selected: "c", has: on("a", "c"), first: "a" })).toBe("c");
  });

  it("else the first item, and nothing when there are none", () => {
    expect(tabStopOf({ lastFocused: "gone", selected: "also-gone", has: on("a"), first: "a" })).toBe("a");
    expect(tabStopOf({ lastFocused: null, selected: null, has: on(), first: undefined })).toBeUndefined();
  });
});
