import { describe, expect, it } from "vitest";
import { buildGraph } from "../../graph/buildGraph";
import { defined } from "../../lib/guards";
import { FixtureSource } from "../FixtureSource";
import { combineJql, presetById } from "../jqlPresets";
import { mockConfig, mockLinkTypes, mockSites } from "../mockData";
import { matchesMockJql, parseMockJql, splitTopLevelAnd } from "../mockJql";
import { MultiSiteLoader } from "../MultiSiteLoader";

describe("combineJql", () => {
  it("ANDs the filter onto the base and keeps ORDER BY last", () => {
    expect(combineJql("project = CHANGE ORDER BY rank", "statusCategory != Done")).toBe(
      "(project = CHANGE) AND (statusCategory != Done) ORDER BY rank",
    );
    expect(combineJql("", "statusCategory != Done")).toBe("statusCategory != Done");
    expect(combineJql("project = A", "")).toBe("project = A");
    expect(combineJql("ORDER BY rank", "")).toBe("ORDER BY rank");
  });

  it("keeps the site filter binding when the query uses OR", () => {
    // Unparenthesized, this would be ((project = A) AND x = 1) OR y = 2 — y leaking across the whole site.
    expect(combineJql("project = A", "x = 1 OR y = 2")).toBe("(project = A) AND (x = 1 OR y = 2)");
  });

  it("lets the query's ORDER BY win and never nests ORDER BY in parentheses", () => {
    expect(combineJql("project = A ORDER BY rank", "x = 1 ORDER BY updated DESC")).toBe("(project = A) AND (x = 1) ORDER BY updated DESC");
  });
});

describe("mock JQL", () => {
  it("splits only on top-level AND", () => {
    expect(splitTopLevelAnd('(project = A AND key in (A-1)) AND issueLinkType in (blocks, "is blocked by")')).toEqual([
      "project = A",
      "key in (A-1)",
      'issueLinkType in (blocks, "is blocked by")',
    ]);
  });

  it("matches issueLinkType by direction", () => {
    const acme = mockSites.acme.issues;
    const blocks = parseMockJql("issueLinkType = blocks");
    const blocked = parseMockJql('issueLinkType = "is blocked by"');
    const web2 = defined(
      acme.find((i) => i.key === "WEB-2"),
      "WEB-2",
    );
    expect(matchesMockJql(web2, blocks)).toBe(false);
    expect(matchesMockJql(web2, blocked)).toBe(true);
  });

  it("rejects what it can't evaluate", () => {
    expect(() => parseMockJql("labels = x")).toThrow();
    expect(() => parseMockJql("project = A OR project = B")).toThrow(/OR/);
  });
});

describe("default preset on the mock data", () => {
  it("drops Done and unlinked issues but keeps the chain and the cross-site cycle", async () => {
    const selected = mockConfig.sites.filter((s) => mockConfig.defaultSiteIds.includes(s.id));
    const res = await new MultiSiteLoader(new FixtureSource(mockSites, mockLinkTypes)).load(
      { mode: "jql", jql: presetById("open-blockers").jql },
      selected,
      mockConfig.sites,
    );
    if (res.kind !== "ok") throw new Error("expected ok");
    const g = buildGraph({ sites: mockConfig.sites, data: res.data });
    const full = g.nodes.filter((n) => !n.ghost);
    expect(full.every((n) => n.statusCategory !== "done")).toBe(true);
    expect(full.some((n) => n.key === "WEB-3")).toBe(false); // duplicates-only
    expect(full.length).toBeLessThan(20);
    expect(g.cycles).toEqual([["acme:CORE-20", "acme:CORE-21", "partner:PAY-10"]]);
    expect(g.edges.some((e) => e.source === "partner:PAY-3" && e.target === "acme:CORE-10")).toBe(true);
  });
});
