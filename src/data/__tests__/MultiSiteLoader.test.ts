import { describe, expect, it } from "vitest";
import { buildGraph } from "../../graph/buildGraph";
import { FixtureSource } from "../FixtureSource";
import type { JiraSource } from "../JiraSource";
import { mockConfig, mockLinkTypes, mockSites } from "../mockData";
import { MultiSiteLoader } from "../MultiSiteLoader";

const sites = mockConfig.sites;
const selected = sites.filter((s) => mockConfig.defaultSiteIds.includes(s.id));

describe("MultiSiteLoader", () => {
  it("merges JQL results from every selected site using default JQL", async () => {
    const loader = new MultiSiteLoader(new FixtureSource(mockSites, mockLinkTypes));
    const res = await loader.load({ mode: "jql", jql: "" }, selected, sites);
    expect(res.kind).toBe("ok");
    if (res.kind !== "ok") return;
    expect(res.errors).toEqual([]);
    expect(res.data.map((d) => [d.siteId, d.issues.length])).toEqual([
      ["acme", 17],
      ["partner", 11],
    ]);
  });

  it("ANDs each site's filter onto the query, per site", async () => {
    const seen: string[] = [];
    const inner = new FixtureSource(mockSites, mockLinkTypes);
    const spy: JiraSource = {
      ...inner,
      fetchByJql: (s, j, m) => (seen.push(`${s}: ${j}`), inner.fetchByJql(s, j, m)),
      fetchEpic: (s, k, f) => inner.fetchEpic(s, k, f),
      fetchIssue: (s, k) => inner.fetchIssue(s, k),
      fetchRemoteLinks: (s, k) => inner.fetchRemoteLinks(s, k),
      fetchLinkTypes: (s) => inner.fetchLinkTypes(s),
    };
    await new MultiSiteLoader(spy).load({ mode: "jql", jql: "statusCategory != Done" }, selected, sites);
    expect(seen.sort()).toEqual([
      "acme: (project in (CORE, WEB)) AND (statusCategory != Done)",
      "partner: (project in (PAY, CORE)) AND (statusCategory != Done)",
    ]);
  });

  it("applies the site filter to epic children and to linked issues, leaving the rest as ghosts", async () => {
    const narrowed = sites.map((s) => (s.id === "acme" ? { ...s, baseJql: "project = CORE" } : s));
    const loader = new MultiSiteLoader(new FixtureSource(mockSites, mockLinkTypes));
    const res = await loader.load({ mode: "epic", siteId: "acme", key: "CORE-1" }, narrowed.filter((s) => s.id === "acme"), narrowed);
    if (res.kind !== "ok") throw new Error("expected ok");
    const g = buildGraph({ sites: narrowed, data: res.data });
    const full = g.nodes.filter((n) => !n.ghost).map((n) => n.key).sort();
    // Children in CORE: CORE-10, CORE-11. Their WEB links (WEB-1, WEB-2) fail the filter and stay ghosts,
    // and so aren't expanded further.
    expect(full).toEqual(["CORE-10", "CORE-11"]);
    expect(g.nodes.find((n) => n.key === "WEB-1")).toMatchObject({ ghost: true });
  });

  it("still loads a seed issue the site filter would exclude", async () => {
    const narrowed = sites.map((s) => (s.id === "acme" ? { ...s, baseJql: "project = CORE" } : s));
    const res = await new MultiSiteLoader(new FixtureSource(mockSites, mockLinkTypes)).load(
      { mode: "seed", siteId: "acme", key: "WEB-2", depth: 1 },
      narrowed.filter((s) => s.id === "acme"),
      narrowed,
    );
    if (res.kind !== "ok") throw new Error("expected ok");
    const full = buildGraph({ sites: narrowed, data: res.data }).nodes.filter((n) => !n.ghost).map((n) => n.key).sort();
    expect(full).toEqual(["CORE-11", "CORE-8", "WEB-2"]); // OPS-3 (project OPS) stays a ghost
  });

  it("reports one failing site and still returns the other", async () => {
    const loader = new MultiSiteLoader(new FixtureSource(mockSites, mockLinkTypes, new Set(["partner"])));
    const res = await loader.load({ mode: "jql", jql: "" }, selected, sites);
    if (res.kind !== "ok") throw new Error("expected ok");
    expect(res.errors).toEqual([{ siteId: "partner", message: expect.stringContaining("Simulated outage") }]);
    expect(res.data.map((d) => d.siteId)).toEqual(["acme"]);
    // The cross-site target on the failed site degrades to a ghost rather than disappearing.
    const g = buildGraph({ sites, data: res.data });
    expect(g.nodes.find((n) => n.uid === "partner:PAY-3")).toMatchObject({ ghost: true });
  });

  it("refuses to load more than the node cap, counting ghosts", async () => {
    const loader = new MultiSiteLoader(new FixtureSource(mockSites, mockLinkTypes), { maxNodes: 20 });
    const res = await loader.load({ mode: "jql", jql: "" }, selected, sites);
    expect(res.kind).toBe("overCap");
  });

  it("epic mode loads children plus one hop of link targets as full nodes", async () => {
    const loader = new MultiSiteLoader(new FixtureSource(mockSites, mockLinkTypes));
    const res = await loader.load({ mode: "epic", siteId: "acme", key: "CORE-1" }, selected, sites);
    if (res.kind !== "ok") throw new Error("expected ok");
    const g = buildGraph({ sites, data: res.data });
    const full = g.nodes.filter((n) => !n.ghost).map((n) => n.uid).sort();
    // children: CORE-10, CORE-11, WEB-1, WEB-2; one hop: CORE-8, WEB-5, partner:PAY-3.
    // OPS-3 is linked too, but acme's site filter (project in (CORE, WEB)) keeps it a ghost.
    expect(full).toEqual(["acme:CORE-10", "acme:CORE-11", "acme:CORE-8", "acme:WEB-1", "acme:WEB-2", "acme:WEB-5", "partner:PAY-3"]);
    expect(g.nodes.find((n) => n.uid === "acme:OPS-3")).toMatchObject({ ghost: true });
    expect(g.nodes.find((n) => n.uid === "acme:CORE-7")).toMatchObject({ ghost: true }); // two hops away
  });

  it("seed mode walks BFS to the given depth and only into selected sites", async () => {
    const loader = new MultiSiteLoader(new FixtureSource(mockSites, mockLinkTypes));
    const acmeOnly = sites.filter((s) => s.id === "acme");
    const res = await loader.load({ mode: "seed", siteId: "acme", key: "CORE-11", depth: 2 }, acmeOnly, sites);
    if (res.kind !== "ok") throw new Error("expected ok");
    const g = buildGraph({ sites, data: res.data });
    expect(g.nodes.filter((n) => !n.ghost).map((n) => n.uid).sort()).toEqual([
      "acme:CORE-10", "acme:CORE-11", "acme:CORE-8", "acme:WEB-1", "acme:WEB-2", "acme:WEB-5",
    ]);
    expect(g.nodes.find((n) => n.uid === "partner:PAY-3")).toMatchObject({ ghost: true });
  });

  it("never runs more than 4 requests per site at once", async () => {
    const inner = new FixtureSource(mockSites, mockLinkTypes);
    const active = new Map<string, number>();
    let peak = 0;
    const slow = <T,>(siteId: string, fn: () => Promise<T>) => async () => {
      active.set(siteId, (active.get(siteId) ?? 0) + 1);
      peak = Math.max(peak, active.get(siteId)!);
      await new Promise((r) => setTimeout(r, 2));
      try {
        return await fn();
      } finally {
        active.set(siteId, active.get(siteId)! - 1);
      }
    };
    const src: JiraSource = {
      fetchByJql: (s, j, m) => slow(s, () => inner.fetchByJql(s, j, m))(),
      fetchEpic: (s, k) => slow(s, () => inner.fetchEpic(s, k))(),
      fetchIssue: (s, k) => slow(s, () => inner.fetchIssue(s, k))(),
      fetchRemoteLinks: (s, k) => slow(s, () => inner.fetchRemoteLinks(s, k))(),
      fetchLinkTypes: (s) => slow(s, () => inner.fetchLinkTypes(s))(),
    };
    await new MultiSiteLoader(src).load({ mode: "jql", jql: "" }, selected, sites);
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1);
  });
});
