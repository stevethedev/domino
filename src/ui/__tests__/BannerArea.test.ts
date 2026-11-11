import { describe, expect, it } from "vitest";
import {
  MORE,
  blurLeaves,
  childOrder,
  expandsToKeepFocus,
  focusTargetAfter,
  moreText,
  placesOf,
  rankBanners,
  type Severity,
} from "../BannerArea";

type Entry = { id: string; severity: Severity; seq: number };
const entry = (id: string, severity: Severity, seq: number): Entry => ({ id, severity, seq });

describe("rankBanners", () => {
  it("puts errors before warnings before info", () => {
    const ranked = rankBanners([entry("update", "info", 1), entry("empty", "warning", 2), entry("load", "error", 3)]);
    expect(ranked.map((b) => b.id)).toEqual(["load", "empty", "update"]);
  });

  it("breaks a tie with the newest first", () => {
    const ranked = rankBanners([entry("config", "error", 1), entry("load", "error", 4), entry("update-failed", "error", 2)]);
    expect(ranked.map((b) => b.id)).toEqual(["load", "update-failed", "config"]);
  });

  it("doesn't change what it was given", () => {
    const given = [entry("a", "info", 1), entry("b", "error", 2)];
    rankBanners(given);
    expect(given.map((b) => b.id)).toEqual(["a", "b"]);
  });
});

describe("placesOf", () => {
  const ranked = [entry("load", "error", 3), entry("empty", "warning", 2), entry("update", "info", 1)];

  it("shows only the top banner when folded", () => {
    expect(placesOf(ranked, false)).toEqual(new Map([["load", 0]]));
  });

  it("shows every banner, in rank order, when expanded", () => {
    expect(placesOf(ranked, true)).toEqual(
      new Map([
        ["load", 0],
        ["empty", 1],
        ["update", 2],
      ]),
    );
  });
});

describe("moreText", () => {
  it("counts the hidden banners", () => {
    expect(moreText(2, false)).toBe("+2 more");
  });

  it("offers to fold them away again", () => {
    expect(moreText(2, true)).toBe("Show fewer");
  });
});

describe("focusTargetAfter", () => {
  const shown = ["load", "empty", "update"];

  it("goes to the banner that took the dismissed one's place", () => {
    expect(focusTargetAfter(shown, 1)).toBe("empty");
  });

  it("goes to the one above when the last was dismissed", () => {
    expect(focusTargetAfter(shown, 3)).toBe("update");
  });

  it("has nowhere to go when none are left", () => {
    expect(focusTargetAfter([], 0)).toBeUndefined();
  });
});

describe("expandsToKeepFocus", () => {
  const registered = new Set(["load", "update"]);

  it("expands when the focused banner is folded away by a new top one", () => {
    expect(expandsToKeepFocus({ focused: "update", top: "load", registered, expanded: false })).toBe(true);
  });

  it("stays folded when the focused banner is still on top", () => {
    expect(expandsToKeepFocus({ focused: "load", top: "load", registered, expanded: false })).toBe(false);
  });

  it("stays folded when focus isn't in a banner, or its banner is gone", () => {
    expect(expandsToKeepFocus({ focused: null, top: "load", registered, expanded: false })).toBe(false);
    expect(expandsToKeepFocus({ focused: "empty", top: "load", registered, expanded: false })).toBe(false);
  });

  it("has nothing to do when already expanded", () => {
    expect(expandsToKeepFocus({ focused: "update", top: "load", registered, expanded: true })).toBe(false);
  });
});

describe("childOrder", () => {
  // Children by position key; three of them have a banner up, ranked load, update, config.
  const keys = [".0", ".1", ".2", ".3", ".4"];
  const slots = new Map([
    ["config", ".1"],
    ["update", ".2"],
    ["load", ".3"],
  ]);

  it("puts the top banner first, then the toggle, then the rest in rank order", () => {
    expect(childOrder(keys, slots, ["load", "update", "config"])).toEqual([".3", MORE, ".2", ".1", ".0", ".4"]);
  });

  it("has no toggle for a single banner", () => {
    expect(childOrder(keys, new Map([["load", ".3"]]), ["load"])).toEqual([".3", ".0", ".1", ".2", ".4"]);
  });
});

describe("blurLeaves", () => {
  it("stays when focus moved within the banner", () => {
    expect(blurLeaves(true, true)).toBe("stays");
  });

  it("leaves at once when focus went somewhere else, like the toggle", () => {
    expect(blurLeaves(false, true)).toBe("leaves");
  });

  it("can't tell yet when focus went nowhere, as when the banner is moved", () => {
    expect(blurLeaves(false, false)).toBe("unsure");
  });
});
