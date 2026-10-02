import { describe, expect, it } from "vitest";
import { criticalPath, openBlockerCounts } from "../analysis";
import { buildGraph } from "../buildGraph";
import { mockConfig, mockLinkTypes, mockSites } from "../../data/mockData";

// Mirrors the default JQL scope ("project in (...)") to check that the fixtures cover the spec's scenarios.
const inProjects =
  (keys: string[]) =>
  (k: string): boolean =>
    keys.includes(k.split("-")[0]);
const g = buildGraph({
  sites: mockConfig.sites,
  data: [
    {
      siteId: "acme",
      issues: mockSites.acme.issues.filter((i) => inProjects(["CORE", "WEB"])(i.key)),
      remoteLinks: mockSites.acme.remoteLinks,
      linkTypes: mockLinkTypes,
    },
    { siteId: "partner", issues: mockSites.partner.issues, remoteLinks: mockSites.partner.remoteLinks, linkTypes: mockLinkTypes },
  ],
});

describe("mock fixtures", () => {
  it("has about 30 issues including exactly 3 ghosts", () => {
    expect(g.nodes.length).toBeGreaterThanOrEqual(28);
    expect(
      g.nodes
        .filter((n) => n.ghost)
        .map((n) => n.uid)
        .sort(),
    ).toEqual(["acme:OPS-3", "legacy:LEG-4", "other.atlassian.net:EXT-9"]);
  });

  it("contains the 5-hop chain with a partner -> acme hop", () => {
    const hop = g.edges.filter((e) => e.source === "partner:PAY-3" && e.target === "acme:CORE-10");
    expect(hop).toHaveLength(1);
    expect(hop[0]).toMatchObject({ crossSite: true, kind: "blocks" });
    expect(criticalPath(g).nodes).toEqual(["partner:PAY-2", "partner:PAY-3", "acme:CORE-10", "acme:CORE-11", "acme:WEB-1"]);
  });

  it("contains CORE-7 on both sites, a cross-site 3-cycle, and an issue with 3+ blockers", () => {
    expect(g.nodes.filter((n) => n.key === "CORE-7")).toHaveLength(2);
    expect(g.cycles).toEqual([["acme:CORE-20", "acme:CORE-21", "partner:PAY-10"]]);
    expect(openBlockerCounts(g).get("acme:WEB-2")).toBe(4);
  });

  it("covers every status category and every link kind", () => {
    expect(new Set(g.nodes.filter((n) => !n.ghost).map((n) => n.statusCategory))).toEqual(new Set(["todo", "inprogress", "done"]));
    expect(new Set(g.edges.map((e) => e.kind))).toEqual(new Set(["blocks", "relates", "duplicates"]));
  });
});
