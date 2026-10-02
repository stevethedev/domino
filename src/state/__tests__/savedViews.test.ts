import { describe, expect, it } from "vitest";
import { defined } from "../../lib/guards";
import { parseSavedViews, upsertView, type SavedView } from "../savedViews";

const view = (name: string): SavedView => ({
  name,
  siteIds: ["acme"],
  scope: { mode: "epic", siteId: "acme", key: "CORE-1" },
  filters: { blocks: true, relates: false, duplicates: false, crossSite: true },
  view: { groupBy: "assignee", highlight: "blocked", highlightScope: "assigned", collapseEpics: false },
  mode: "timeline",
});

describe("saved views", () => {
  it("round-trips through JSON", () => {
    const views = [view("Standup"), view("Partner")];
    expect(parseSavedViews(JSON.parse(JSON.stringify(views)))).toEqual(views);
  });

  it("drops invalid entries instead of failing the whole list", () => {
    const stored = [view("Good"), { ...view("Bad mode"), mode: "kanban" }, { ...view("Bad scope"), scope: { mode: "seed", key: "X-1" } }, null, { name: "  " }];
    expect(defined(parseSavedViews(JSON.parse(JSON.stringify(stored))), "parsed views").map((v) => v.name)).toEqual(["Good"]);
    expect(parseSavedViews("nope")).toBeUndefined();
  });

  it("defaults collapseEpics for views saved before the epic map existed", () => {
    const old = { ...view("Old"), view: { groupBy: "none", highlight: "none" } };
    expect(defined(parseSavedViews([old]), "parsed views")[0].view.collapseEpics).toBe(false);
  });

  it("defaults highlightScope to everyone's issues for views saved before scoped highlights", () => {
    const old = { ...view("Old"), view: { groupBy: "none", highlight: "ready", collapseEpics: false } };
    expect(defined(parseSavedViews([old]), "parsed views")[0].view.highlightScope).toBe("all");
  });

  it("upsert replaces a same-named view (case-insensitive) and puts it first", () => {
    const next = upsertView([view("Standup"), view("Partner")], { ...view("standup"), mode: "graph" });
    expect(next.map((v) => [v.name, v.mode])).toEqual([["standup", "graph"], ["Partner", "timeline"]]);
  });
});
