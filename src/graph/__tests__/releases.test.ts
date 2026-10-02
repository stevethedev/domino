import { describe, expect, it } from "vitest";
import type { RawIssue, RawVersion } from "../../data/jiraTypes";
import { buildGraph } from "../buildGraph";
import { lastDayOf, releaseStatuses } from "../releases";
import type { TimelineEntry } from "../schedule";
import { data, issue, site } from "./helpers";

const version = (id: string, name: string, extra: Partial<RawVersion> = {}): RawVersion => ({ id, name, released: false, ...extra });
const planned = (i: RawIssue, ...versions: RawVersion[]): RawIssue => ({ ...i, fields: { ...i.fields, fixVersions: versions } });

/** An open issue forecast to occupy [start, end) (end exclusive), or a done one with that actual span. */
const open = (start: string, end: string): TimelineEntry => ({
  projected: { start, end },
  progress: { state: "not-started", forecast: { start, end } },
  varianceDays: 0,
});
const done = (start: string, end: string): TimelineEntry => ({
  projected: { start, end },
  progress: { state: "done", actual: { start, end } },
  varianceDays: 0,
});

const v24 = version("1", "2.4", { releaseDate: "2026-10-12" });
const v25 = version("2", "2.5", { releaseDate: "2026-11-01" });
const v18 = version("3", "1.8", { releaseDate: "2026-09-20", released: true });
const later = version("4", "Someday");
const old = version("5", "0.9", { archived: true, released: true });

const graph = buildGraph({
  sites: [site("a")],
  data: [
    data("a", [
      planned(issue("A-1"), v24), // finishes Oct 9: on time
      planned(issue("A-2"), v24, v25), // finishes Oct 14: late for 2.4, fine for 2.5
      planned(issue("A-3", "done"), v24, old), // done: never at risk
      planned(issue("A-4"), v18), // released already
      planned(issue("A-5"), later), // no date
      issue("A-6"), // no release
    ]),
  ],
});
const timeline = new Map<string, TimelineEntry>([
  ["a:A-1", open("2026-10-05", "2026-10-10")],
  ["a:A-2", open("2026-10-12", "2026-10-15")],
  ["a:A-3", done("2026-09-01", "2026-09-05")],
  ["a:A-4", open("2026-10-05", "2026-10-30")],
  ["a:A-5", open("2026-10-05", "2026-10-06")],
  ["a:A-6", open("2026-10-05", "2026-10-06")],
]);

describe("releases from fix versions", () => {
  it("reads fix versions onto issues, site-qualified, leaving archived ones out", () => {
    const a3 = graph.nodes.find((n) => n.key === "A-3");
    expect(a3?.releases).toEqual([{ uid: "a:version:1", siteId: "a", name: "2.4", date: "2026-10-12", released: false }]);
    expect(graph.nodes.find((n) => n.key === "A-6")?.releases).toBeUndefined();
  });

  it("ignores malformed versions and dates", () => {
    const odd = buildGraph({
      sites: [site("a")],
      data: [
        data("a", [
          planned(issue("A-1"), { id: "9", name: "x", releaseDate: "soon" }, { id: "8", name: "y", releaseDate: "2026-10-12garbage" }, {
            name: "no id",
          } as unknown as RawVersion),
        ]),
      ],
    });
    expect(odd.nodes[0]?.releases).toEqual([
      { uid: "a:version:9", siteId: "a", name: "x", date: undefined, released: false },
      { uid: "a:version:8", siteId: "a", name: "y", date: undefined, released: false },
    ]);
  });
});

describe("releaseStatuses", () => {
  const statuses = releaseStatuses(graph, timeline);
  const byName = new Map(statuses.map((s) => [s.release.name, s]));

  it("lists upcoming releases soonest first, then undated, then released", () => {
    expect(statuses.map((s) => s.release.name)).toEqual(["2.4", "2.5", "Someday", "1.8"]);
  });

  it("flags open issues forecast to finish after the release date", () => {
    expect(byName.get("2.4")).toEqual({
      release: expect.objectContaining({ name: "2.4" }) as unknown,
      issues: ["a:A-1", "a:A-2", "a:A-3"],
      open: ["a:A-1", "a:A-2"],
      atRisk: ["a:A-2"],
      forecastDone: "2026-10-14",
    });
    expect(byName.get("2.5")?.atRisk).toEqual([]);
  });

  it("finishing on the release day itself is on time", () => {
    const onTheDay = new Map(timeline).set("a:A-2", open("2026-10-12", "2026-10-13"));
    expect(releaseStatuses(graph, onTheDay).find((s) => s.release.name === "2.4")?.atRisk).toEqual([]);
  });

  it("puts nothing at risk for undated or released versions", () => {
    expect(byName.get("Someday")?.atRisk).toEqual([]);
    expect(byName.get("1.8")?.atRisk).toEqual([]);
  });

  it("sorts released versions latest first", () => {
    const r = (id: string, date: string): RawVersion => version(id, `r${id}`, { releaseDate: date, released: true });
    const g = buildGraph({
      sites: [site("a")],
      data: [data("a", [planned(issue("A-1"), r("1", "2026-01-05"), r("2", "2026-03-01"), r("3", "2025-12-31"))])],
    });
    expect(releaseStatuses(g, new Map()).map((s) => s.release.name)).toEqual(["r2", "r1", "r3"]);
  });
});

describe("lastDayOf", () => {
  it("is the day before the exclusive end", () => {
    expect(lastDayOf(open("2026-10-05", "2026-10-10"))).toBe("2026-10-09");
    expect(lastDayOf(done("2026-09-01", "2026-09-05"))).toBe("2026-09-04");
  });
});
