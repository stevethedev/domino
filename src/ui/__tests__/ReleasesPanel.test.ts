import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ReleaseStatus } from "../../graph/releases";
import { ReleasesPanel } from "../ReleasesPanel";
import { markupText } from "./markupText";

const status = (over: Partial<ReleaseStatus> = {}): ReleaseStatus => ({
  release: { uid: "r1", siteId: "acme", name: "Partner SDK 3.0", date: "2026-11-13", released: false },
  issues: ["a", "b", "c"],
  open: ["a", "b", "c"],
  atRisk: [],
  ...over,
});

const panel = (releases: readonly ReleaseStatus[]): string =>
  renderToStaticMarkup(
    createElement(ReleasesPanel, { releases, nodes: new Map(), today: "2026-11-02", showSite: false, onPick: () => undefined }),
  );

describe("ReleasesPanel", () => {
  it("gives the name its own line and puts the date with the status, so a long name can't push the card wider", () => {
    const out = panel([status()]);
    const head = /<div class="release-head">(.*?)<\/div>/.exec(out)?.[1] ?? "";
    expect(head).toContain("Partner SDK 3.0");
    expect(head).not.toContain("Nov 13");
    const line = /<p class="release-status">(.*?)<\/p>/.exec(out)?.[1] ?? "";
    expect(markupText(line)).toBe("Nov 13 · in 11 days · 3 open · on track");
  });

  it("says when a release has no date", () => {
    const line = /<p class="release-status">(.*?)<\/p>/.exec(panel([status({ release: { ...status().release, date: undefined } })]))?.[1];
    expect(markupText(line ?? "")).toBe("No release date · 3 open");
  });
});
