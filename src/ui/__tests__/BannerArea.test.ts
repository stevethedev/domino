import { describe, expect, it } from "vitest";
import { moreText, placesOf, rankBanners, type Severity } from "../BannerArea";

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
