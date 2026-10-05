import { describe, expect, it } from "vitest";
import { NO_ISSUE_FILTERS, type ViewFilters } from "../../graph/visible";
import { fitKeyOf } from "../fitKey";

const FILTERS: ViewFilters = {
  blocks: true,
  relates: false,
  duplicates: false,
  crossSite: true,
  issues: NO_ISSUE_FILTERS,
  hideImplied: true,
};

describe("fitKeyOf", () => {
  const base = fitKeyOf("scope-a", "none", FILTERS, new Set());

  it("is the same for the same scope and view settings, whatever the data", () => {
    // Built from equal but distinct values, as a refresh or re-render would produce them.
    expect(fitKeyOf("scope-a", "none", { ...FILTERS, issues: { ...NO_ISSUE_FILTERS } }, new Set())).toBe(base);
  });

  it("ignores the order folds were made in", () => {
    expect(fitKeyOf("s", "epic", FILTERS, new Set(["a:E-1", "a:E-2"]))).toBe(fitKeyOf("s", "epic", FILTERS, new Set(["a:E-2", "a:E-1"])));
  });

  it("changes with the scope, grouping, filters or folds", () => {
    const changed = [
      fitKeyOf("scope-b", "none", FILTERS, new Set()),
      fitKeyOf(null, "none", FILTERS, new Set()),
      fitKeyOf("scope-a", "epic", FILTERS, new Set()),
      fitKeyOf("scope-a", "none", { ...FILTERS, relates: true }, new Set()),
      fitKeyOf("scope-a", "none", { ...FILTERS, issues: { ...NO_ISSUE_FILTERS, hiddenTypes: ["Bug"] } }, new Set()),
      fitKeyOf("scope-a", "none", FILTERS, new Set(["a:E-1"])),
    ];
    for (const key of changed) expect(key).not.toBe(base);
  });
});
