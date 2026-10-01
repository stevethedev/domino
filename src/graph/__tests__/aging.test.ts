import { describe, expect, it } from "vitest";
import type { RawIssue, RawStatusCategoryKey } from "../../data/jiraTypes";
import { AGING_DEFAULTS, computeAging, type AgingOptions } from "../aging";
import { openBlockerCounts } from "../analysis";
import { buildGraph } from "../buildGraph";
import type { StatusChange } from "../schedule";
import { BLOCKS, data, issue, link, site } from "./helpers";

const A = site("a");
// 2026-10-19 is a Monday.
const opts: AgingOptions = { today: "2026-10-19", daysPerPoint: 1, defaultDays: 2, ...AGING_DEFAULTS };

function make(key: string, cat: RawStatusCategoryKey, points: number | null, created?: string): RawIssue {
  const i = issue(key, cat);
  i.fields.customfield_10016 = points;
  if (created) i.fields.created = `${created}T09:00:00.000+0000`;
  return i;
}

function run(issues: RawIssue[], history: Record<string, StatusChange[]> = {}) {
  const g = buildGraph({ sites: [A], data: [data("a", issues)] });
  return computeAging(g, new Map(Object.entries(history)), openBlockerCounts(g), opts);
}

describe("computeAging", () => {
  it("flags in-progress work past twice its estimate as stuck", () => {
    const aging = run([make("S-1", "indeterminate", 2), make("S-2", "indeterminate", 5)], {
      "a:S-1": [{ at: "2026-10-12", toCategory: "inprogress" }], // 5 workdays > 2 x 2
      "a:S-2": [{ at: "2026-10-12", toCategory: "inprogress" }], // 5 workdays <= 2 x 5
    });
    expect(aging.get("a:S-1")).toEqual({ kind: "stuck", days: 5, estimateDays: 2 });
    expect(aging.has("a:S-2")).toBe(false);
  });

  it("flags blocked issues with no status change for the threshold as waiting", () => {
    const blocker = make("B-1", "indeterminate", 9, "2026-10-01");
    const old = make("W-1", "new", 1, "2026-10-01"); // 12 workdays, never moved
    const fresh = make("W-2", "new", 1, "2026-10-14"); // 3 workdays
    link("1", BLOCKS, blocker, old);
    link("2", BLOCKS, blocker, fresh);
    const aging = run([blocker, old, fresh]);
    expect(aging.get("a:W-1")).toEqual({ kind: "waiting", days: 12 });
    expect(aging.has("a:W-2")).toBe(false);
    expect(aging.has("a:B-1")).toBe(false); // not blocked itself, and no start date to judge
  });

  it("measures waiting from the last status change when there is one", () => {
    const blocker = make("B-1", "new", 1, "2026-09-01");
    const w = make("W-1", "indeterminate", 9, "2026-09-01");
    link("1", BLOCKS, blocker, w);
    const aging = run([blocker, w], { "a:W-1": [{ at: "2026-10-15", toCategory: "inprogress" }] });
    expect(aging.has("a:W-1")).toBe(false); // moved 2 workdays ago
  });

  it("never flags an epic itself", () => {
    const epic = make("E-1", "indeterminate", null);
    epic.fields.issuetype = { name: "Epic", hierarchyLevel: 1 };
    expect(run([epic], { "a:E-1": [{ at: "2026-09-01", toCategory: "inprogress" }] }).size).toBe(0);
  });

  it("ignores done work, ghosts, and issues without dates", () => {
    const blocker = make("B-1", "indeterminate", 1);
    const noDates = make("N-1", "new", 1); // blocked but no created date or history
    link("1", BLOCKS, blocker, noDates);
    expect(run([blocker, noDates, make("D-1", "done", 1, "2026-01-01")]).size).toBe(0);
  });
});
