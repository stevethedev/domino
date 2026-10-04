import { describe, expect, it } from "vitest";
import { defined } from "../../lib/guards";
import { mergeViews, parseSavedViews, readViewsFile, upsertView, viewsFile, type SavedView } from "../savedViews";

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
  view: { groupBy: "assignee", highlight: "blocked", highlightScope: "assigned" },
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
    expect(a.view).toEqual({ groupBy: "epic", highlight: "none", highlightScope: "all" });
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

  it("defaults highlightScope to everyone's issues for views saved before scoped highlights", () => {
    const old = { ...view("Old"), view: { groupBy: "none", highlight: "ready", collapseEpics: false } };
    expect(defined(parseSavedViews([old]), "parsed views")[0].view.highlightScope).toBe("all");
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
    expect(merged.map((v) => [v.name, v.mode])).toEqual([
      ["standup", "graph"],
      ["Partner", "timeline"],
      ["Mine", "timeline"],
    ]);
  });
});
