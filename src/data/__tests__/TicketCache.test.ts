import { describe, expect, it } from "vitest";
import type { DominoConfig } from "../../config/types";
import { issue } from "../../graph/__tests__/helpers";
import type { RawSiteData } from "../jiraTypes";
import { parseCachedScope, toPutEntry, type OkResult } from "../TicketCache";

const config: DominoConfig = {
  sites: [
    { id: "a", label: "A", baseUrl: "https://a.atlassian.net", auth: { type: "oauth3lo" }, color: "#111111", enabled: true },
    { id: "b", label: "B", baseUrl: "https://b.atlassian.net", auth: { type: "oauth3lo" }, color: "#222222", enabled: true },
  ],
  defaultSiteIds: ["a"],
  backend: "jira",
};
const siteData = (siteId: string): RawSiteData => ({
  siteId,
  issues: [issue(`${siteId.toUpperCase()}-1`)],
  remoteLinks: {},
  linkTypes: [],
});
const result: OkResult = { kind: "ok", data: [siteData("a"), siteData("b")], errors: [{ siteId: "c", message: "401" }] };

describe("toPutEntry", () => {
  it("sends each site with the address and account it was loaded with", () => {
    expect(toPutEntry("s", result, { a: 1, b: 2 }, config)).toEqual({
      scopeKey: "s",
      backend: "jira",
      sites: [
        { siteId: "a", takenAt: 1, data: siteData("a"), baseUrl: "https://a.atlassian.net", auth: { type: "oauth3lo" } },
        { siteId: "b", takenAt: 2, data: siteData("b"), baseUrl: "https://b.atlassian.net", auth: { type: "oauth3lo" } },
      ],
      errors: [{ siteId: "c", message: "401" }],
    });
  });

  it("skips sites no longer configured, or without a fetch time", () => {
    const removedB = { ...config, sites: config.sites.filter((s) => s.id !== "b") };
    expect(toPutEntry("s", result, { a: 1, b: 2 }, removedB).sites.map((s) => s.siteId)).toEqual(["a"]);
    expect(toPutEntry("s", result, { a: 1 }, config).sites.map((s) => s.siteId)).toEqual(["a"]);
  });
});

describe("parseCachedScope", () => {
  const wire = { scopeKey: "s", sites: [{ siteId: "a", takenAt: 5, data: siteData("a") }], errors: [] };

  it("turns the backend's entry into a load result with per-site ages", () => {
    expect(parseCachedScope(wire, "s")).toEqual({
      scopeKey: "s",
      result: { kind: "ok", data: [siteData("a")], errors: [] },
      ages: { a: 5 },
    });
  });

  it("rejects missing, mismatched or malformed entries", () => {
    const bad: unknown[] = [
      null,
      { ...wire, scopeKey: "other" },
      { ...wire, sites: [] },
      { ...wire, sites: [{ siteId: "a", takenAt: "5", data: siteData("a") }] },
      { ...wire, sites: [{ siteId: "a", takenAt: 5, data: { ...siteData("a"), siteId: "b" } }] },
      { ...wire, sites: [{ siteId: "a", takenAt: 5, data: { ...siteData("a"), issues: [{ key: 1 }] } }] },
      { ...wire, errors: [{ siteId: "a" }] },
    ];
    for (const raw of bad) expect(parseCachedScope(raw, "s")).toBeNull();
  });
});
