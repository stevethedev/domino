import { describe, expect, it } from "vitest";
import { defined } from "../../lib/guards";
import {
  canSaveView,
  MAX_SAVED_VIEWS,
  mergeViews,
  parseSavedViews,
  readViewsFile,
  upsertView,
  viewNotice,
  viewSites,
  viewsFile,
  type SavedView,
} from "../savedViews";
import type { SiteConfig } from "../../config/types";

const view = (name: string): SavedView => ({
  name,
  siteIds: ["acme"],
  scope: { mode: "epic", siteId: "acme", key: "CORE-1" },
  filters: {
    blocks: true,
    relates: false,
    duplicates: false,
    crossSite: true,
    issues: { hiddenCategories: ["done"], hiddenTypes: [], hiddenAssignees: [""], hiddenPriorities: ["Low"] },
    hideImplied: false,
  },
  view: { groupBy: "assignee", highlight: "blocked", highlightScope: "assigned", sort: { key: "priority", reversed: true } },
  mode: "timeline",
});

describe("saved views", () => {
  it("round-trips through JSON", () => {
    const views = [view("Standup"), view("Partner")];
    expect(parseSavedViews(JSON.parse(JSON.stringify(views)))).toEqual(views);
  });

  it("drops invalid entries instead of failing the whole list", () => {
    const stored = [
      view("Good"),
      { ...view("Bad mode"), mode: "kanban" },
      { ...view("Bad scope"), scope: { mode: "seed", key: "X-1" } },
      null,
      { name: "  " },
    ];
    expect(defined(parseSavedViews(JSON.parse(JSON.stringify(stored))), "parsed views").map((v) => v.name)).toEqual(["Good"]);
    expect(parseSavedViews("nope")).toBeUndefined();
  });

  it("opens views saved with the old epic map grouped by epic, with every epic folded", () => {
    const epicMap = { ...view("Epic map"), view: { groupBy: "site", highlight: "none", collapseEpics: true } };
    const plain = { ...view("Plain"), view: { groupBy: "site", highlight: "none", collapseEpics: false } };
    const [a, b] = defined(parseSavedViews([epicMap, plain]), "parsed views");
    expect(a.view).toEqual({ groupBy: "epic", highlight: "none", highlightScope: "all", sort: { key: "natural", reversed: false } });
    expect(a.epicFolds).toBe("all");
    expect(b.view.groupBy).toBe("site");
    expect(b).not.toHaveProperty("epicFolds");
  });

  it("round-trips epic folds and ignores malformed ones", () => {
    const folds = [
      { ...view("All"), epicFolds: "all" as const },
      { ...view("Some"), epicFolds: ["acme:CORE-1", "partner:PAY-20"] },
      { ...view("None"), epicFolds: [] },
    ];
    expect(parseSavedViews(JSON.parse(JSON.stringify(folds)))).toEqual(folds);
    const odd = defined(
      parseSavedViews([
        { ...view("Odd"), epicFolds: ["acme:CORE-1", 7] },
        { ...view("Bad"), epicFolds: "some" },
      ]),
      "views",
    );
    expect(odd.map((v) => v.epicFolds)).toEqual([["acme:CORE-1"], undefined]);
  });

  it("shows every issue for views saved before issue filters existed", () => {
    const old = { ...view("Old"), filters: { blocks: true, relates: false, duplicates: false, crossSite: true } };
    expect(defined(parseSavedViews([old]), "parsed views")[0].filters.issues).toEqual({
      hiddenCategories: [],
      hiddenTypes: [],
      hiddenAssignees: [],
      hiddenPriorities: [],
    });
  });

  it("shows every priority for views saved before priority filters existed", () => {
    const { hiddenPriorities: _, ...issues } = view("Old").filters.issues;
    const old = { ...view("Old"), filters: { ...view("Old").filters, issues } };
    expect(defined(parseSavedViews([old]), "parsed views")[0].filters.issues).toEqual({ ...issues, hiddenPriorities: [] });
  });

  it("keeps the natural order for views saved before sorting existed", () => {
    const old = { ...view("Old"), view: { groupBy: "none", highlight: "none", highlightScope: "all" } };
    expect(defined(parseSavedViews([old]), "parsed views")[0].view.sort).toEqual({ key: "natural", reversed: false });
  });

  it("defaults highlightScope to everyone's issues for views saved before scoped highlights", () => {
    const old = { ...view("Old"), view: { groupBy: "none", highlight: "ready", collapseEpics: false } };
    expect(defined(parseSavedViews([old]), "parsed views")[0].view.highlightScope).toBe("all");
  });

  it("can always update a view, but adds new ones only below the limit", () => {
    const full = Array.from({ length: MAX_SAVED_VIEWS }, (_, i) => view(`V${i}`));
    expect(canSaveView(full, "v3")).toBe(true);
    expect(canSaveView(full, "Another")).toBe(false);
    expect(canSaveView(full.slice(1), "Another")).toBe(true);
    // Upserting never trims: whatever was there stays.
    expect(upsertView(full, view("V0")).length).toBe(MAX_SAVED_VIEWS);
  });

  it("upsert replaces a same-named view (case-insensitive) and puts it first", () => {
    const next = upsertView([view("Standup"), view("Partner")], { ...view("standup"), mode: "graph" });
    expect(next.map((v) => [v.name, v.mode])).toEqual([
      ["standup", "graph"],
      ["Partner", "timeline"],
    ]);
  });
});

describe("sharing saved views", () => {
  it("round-trips through a views file", () => {
    const views = [view("Standup"), view("Partner")];
    expect(readViewsFile(viewsFile(views))).toEqual(views);
  });

  it("accepts a bare list too, and drops invalid entries", () => {
    const text = JSON.stringify([view("Good"), { name: "Broken" }]);
    expect(readViewsFile(text).map((v) => v.name)).toEqual(["Good"]);
  });

  it("explains files that aren't saved views", () => {
    expect(() => readViewsFile("not json")).toThrow("isn't JSON");
    expect(() => readViewsFile(JSON.stringify({ format: "something else", views: [] }))).toThrow("doesn't contain Domino saved views");
    expect(() => readViewsFile(JSON.stringify([{ bogus: true }]))).toThrow("doesn't contain Domino saved views");
  });

  it("merges imported views, replacing same-named ones and keeping import order first", () => {
    const merged = mergeViews([view("Standup"), view("Mine")], [{ ...view("standup"), mode: "graph" }, view("Partner")]);
    expect(merged.views.map((v) => [v.name, v.mode])).toEqual([
      ["standup", "graph"],
      ["Partner", "timeline"],
      ["Mine", "timeline"],
    ]);
    expect(merged).toMatchObject({ added: ["Partner"], replaced: ["standup"], skipped: [] });
  });

  it("never drops existing views to make room: imports past the limit are skipped and reported", () => {
    const mine = Array.from({ length: MAX_SAVED_VIEWS - 1 }, (_, i) => view(`Mine ${i}`));
    const merged = mergeViews(mine, [view("New 1"), view("Mine 3"), view("New 2")]);
    expect(merged.views).toHaveLength(MAX_SAVED_VIEWS);
    expect(merged.views.map((v) => v.name)).toEqual(expect.arrayContaining(mine.map((v) => v.name)));
    expect(merged).toMatchObject({ added: ["New 1"], replaced: ["Mine 3"], skipped: ["New 2"] });
  });

  it("takes the first of a name repeated in the file", () => {
    const merged = mergeViews([], [{ ...view("Dup"), mode: "graph" }, view("dup")]);
    expect(merged.views.map((v) => [v.name, v.mode])).toEqual([["Dup", "graph"]]);
    expect(merged.added).toEqual(["Dup"]);
  });
});

describe("viewSites", () => {
  const site = (id: string, enabled = true): SiteConfig => ({
    id,
    label: id.toUpperCase(),
    baseUrl: `https://${id}.atlassian.net`,
    auth: { type: "oauth3lo" },
    color: "#000000",
    enabled,
  });
  const sites = [site("acme"), site("partner"), site("legacy", false)];

  it("keeps the view's sites you have, and names the ones you don't", () => {
    const r = viewSites({ siteIds: ["acme", "legacy", "theirs"], scope: { mode: "jql", jql: "" } }, sites);
    expect(r).toEqual({ siteIds: ["acme"], missing: ["LEGACY (turned off)", "theirs"], scopeUsable: true });
  });

  it("can't use an epic or seed scope on a site you don't have", () => {
    expect(viewSites({ siteIds: ["acme"], scope: { mode: "epic", siteId: "theirs", key: "X-1" } }, sites).scopeUsable).toBe(false);
    expect(viewSites({ siteIds: ["acme"], scope: { mode: "seed", siteId: "acme", key: "X-1", depth: 2 } }, sites).scopeUsable).toBe(true);
    // The scope's site must be among the view's own sites: loading runs only on the selected ones.
    expect(viewSites({ siteIds: ["partner"], scope: { mode: "epic", siteId: "acme", key: "X-1" } }, sites).scopeUsable).toBe(false);
  });
});

describe("importing past the limit", () => {
  it("reports every entry a big file couldn't add, and still applies updates near its end", () => {
    const mine = [view("Keep me")];
    const file = viewsFile([
      ...Array.from({ length: MAX_SAVED_VIEWS + 19 }, (_, i) => view(`New ${i}`)),
      { ...view("Keep me"), mode: "graph" },
    ]);
    const merged = mergeViews(mine, readViewsFile(file));
    expect(merged.views).toHaveLength(MAX_SAVED_VIEWS);
    expect(merged.replaced).toEqual(["Keep me"]);
    expect(merged.added).toHaveLength(MAX_SAVED_VIEWS - 1);
    expect(merged.skipped).toHaveLength(20);
    expect(merged.views.find((v) => v.name === "Keep me")?.mode).toBe("graph");
  });
});

describe("viewNotice", () => {
  it("says nothing when the view applied in full", () => {
    expect(viewNotice("Standup", 1, { siteIds: ["acme"], missing: [], scopeUsable: true })).toBeNull();
  });

  it("explains a view saved with no sites", () => {
    expect(viewNotice("Empty", 0, { siteIds: [], missing: [], scopeUsable: true })).toBe(
      "“Empty” was saved with no sites selected, so your sites and query stay as they were; its filters and layout were applied.",
    );
  });

  it("names the sites it couldn't use", () => {
    expect(viewNotice("Theirs", 1, { siteIds: [], missing: ["theirs"], scopeUsable: true })).toContain(
      "uses sites you don't have here (theirs)",
    );
    expect(viewNotice("Mixed", 2, { siteIds: ["acme"], missing: ["theirs"], scopeUsable: true })).toBe(
      "“Mixed” also uses theirs, which you don't have here; it's showing the rest.",
    );
  });
});
