import { describe, expect, it, vi } from "vitest";
import { buildGraph } from "../../graph/buildGraph";
import { getOrThrow } from "../../lib/guards";
import { FixtureSource } from "../FixtureSource";
import type { JiraSource } from "../JiraSource";
import { mockConfig, mockLinkTypes, mockSites } from "../mockData";
import { isAbortError, MultiSiteLoader, type SiteOutcome } from "../MultiSiteLoader";

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
      fetchByJql: (s, j, m) => {
        seen.push(`${s}: ${j}`);
        return inner.fetchByJql(s, j, m);
      },
      fetchEpic: (s, k, f) => inner.fetchEpic(s, k, f),
      fetchIssue: (s, k) => inner.fetchIssue(s, k),
      fetchRemoteLinks: (s, k) => inner.fetchRemoteLinks(s, k),
      fetchLinkTypes: (s) => inner.fetchLinkTypes(s),
      fetchPriorities: (s) => inner.fetchPriorities(s),
      fetchStatusHistory: (s, ids) => inner.fetchStatusHistory(s, ids),
      fetchStatuses: (s) => inner.fetchStatuses(s),
      fetchMyself: (s) => inner.fetchMyself(s),
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
    const res = await loader.load(
      { mode: "epic", siteId: "acme", key: "CORE-1" },
      narrowed.filter((s) => s.id === "acme"),
      narrowed,
    );
    if (res.kind !== "ok") throw new Error("expected ok");
    const g = buildGraph({ sites: narrowed, data: res.data });
    const full = g.nodes
      .filter((n) => !n.ghost)
      .map((n) => n.key)
      .sort();
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
    const full = buildGraph({ sites: narrowed, data: res.data })
      .nodes.filter((n) => !n.ghost)
      .map((n) => n.key)
      .sort();
    expect(full).toEqual(["CORE-11", "CORE-8", "WEB-2"]); // OPS-3 (project OPS) stays a ghost
  });

  it("reports one failing site and still returns the other", async () => {
    const loader = new MultiSiteLoader(new FixtureSource(mockSites, mockLinkTypes, new Set(["partner"])));
    const res = await loader.load({ mode: "jql", jql: "" }, selected, sites);
    if (res.kind !== "ok") throw new Error("expected ok");
    expect(res.errors).toMatchObject([{ siteId: "partner" }]);
    expect(res.errors[0].message).toContain("Simulated outage");
    expect(res.data.map((d) => d.siteId)).toEqual(["acme"]);
    // The cross-site target on the failed site degrades to a ghost rather than disappearing.
    const g = buildGraph({ sites, data: res.data });
    expect(g.nodes.find((n) => n.uid === "partner:PAY-3")).toMatchObject({ ghost: true });
  });

  it("loads each site's priorities, and a site whose priorities fail still loads", async () => {
    const inner = new FixtureSource(mockSites, mockLinkTypes);
    const source: JiraSource = {
      fetchByJql: (s, j, m) => inner.fetchByJql(s, j, m),
      fetchEpic: (s, k, f) => inner.fetchEpic(s, k, f),
      fetchIssue: (s, k) => inner.fetchIssue(s, k),
      fetchRemoteLinks: (s, k) => inner.fetchRemoteLinks(s, k),
      fetchLinkTypes: (s) => inner.fetchLinkTypes(s),
      fetchPriorities: (s) => (s === "partner" ? Promise.reject(new Error("403")) : inner.fetchPriorities(s)),
      fetchStatusHistory: (s, ids) => inner.fetchStatusHistory(s, ids),
      fetchStatuses: (s) => inner.fetchStatuses(s),
      fetchMyself: (s) => inner.fetchMyself(s),
    };
    const res = await new MultiSiteLoader(source).load({ mode: "jql", jql: "" }, selected, sites);
    if (res.kind !== "ok") throw new Error("expected ok");
    expect(res.errors).toEqual([]);
    expect(res.data.map((d) => [d.siteId, d.priorities?.map((p) => p.name)])).toEqual([
      ["acme", ["Highest", "High", "Medium", "Low", "Lowest"]],
      ["partner", []],
    ]);
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
    const full = g.nodes
      .filter((n) => !n.ghost)
      .map((n) => n.uid)
      .sort();
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
    expect(
      g.nodes
        .filter((n) => !n.ghost)
        .map((n) => n.uid)
        .sort(),
    ).toEqual(["acme:CORE-10", "acme:CORE-11", "acme:CORE-8", "acme:WEB-1", "acme:WEB-2", "acme:WEB-5"]);
    expect(g.nodes.find((n) => n.uid === "partner:PAY-3")).toMatchObject({ ghost: true });
  });

  it("never runs more than 4 requests per site at once", async () => {
    const inner = new FixtureSource(mockSites, mockLinkTypes);
    const active = new Map<string, number>();
    let peak = 0;
    const slow =
      <T>(siteId: string, fn: () => Promise<T>) =>
      async (): Promise<T> => {
        active.set(siteId, (active.get(siteId) ?? 0) + 1);
        peak = Math.max(peak, getOrThrow(active, siteId));
        await new Promise((r) => setTimeout(r, 2));
        try {
          return await fn();
        } finally {
          active.set(siteId, getOrThrow(active, siteId) - 1);
        }
      };
    const src: JiraSource = {
      fetchByJql: (s, j, m) => slow(s, () => inner.fetchByJql(s, j, m))(),
      fetchEpic: (s, k) => slow(s, () => inner.fetchEpic(s, k))(),
      fetchIssue: (s, k) => slow(s, () => inner.fetchIssue(s, k))(),
      fetchRemoteLinks: (s, k) => slow(s, () => inner.fetchRemoteLinks(s, k))(),
      fetchLinkTypes: (s) => slow(s, () => inner.fetchLinkTypes(s))(),
      fetchPriorities: (s) => slow(s, () => inner.fetchPriorities(s))(),
      fetchStatusHistory: (s, ids) => slow(s, () => inner.fetchStatusHistory(s, ids))(),
      fetchStatuses: (s) => slow(s, () => inner.fetchStatuses(s))(),
      fetchMyself: (s) => slow(s, () => inner.fetchMyself(s))(),
    };
    await new MultiSiteLoader(src).load({ mode: "jql", jql: "" }, selected, sites);
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1);
  });
});

/** A JiraSource over the fixtures that calls `onCall` before each request. */
function watched(onCall: () => void, failSites: ReadonlySet<string> = new Set()): JiraSource {
  const inner = new FixtureSource(mockSites, mockLinkTypes, failSites);
  const via =
    <A extends unknown[], R>(fn: (...args: A) => Promise<R>) =>
    (...args: A): Promise<R> => {
      onCall();
      return fn(...args);
    };
  return {
    fetchByJql: via((s, j, m) => inner.fetchByJql(s, j, m)),
    fetchEpic: via((s, k, f) => inner.fetchEpic(s, k, f)),
    fetchIssue: via((s, k) => inner.fetchIssue(s, k)),
    fetchRemoteLinks: via((s, k) => inner.fetchRemoteLinks(s, k)),
    fetchLinkTypes: via((s) => inner.fetchLinkTypes(s)),
    fetchPriorities: via((s) => inner.fetchPriorities(s)),
    fetchStatusHistory: via((s, ids) => inner.fetchStatusHistory(s, ids)),
    fetchStatuses: via((s) => inner.fetchStatuses(s)),
    fetchMyself: via((s) => inner.fetchMyself(s)),
  };
}

describe("MultiSiteLoader progress", () => {
  const progress = (): { events: [string, SiteOutcome][]; onSiteDone: (siteId: string, outcome: SiteOutcome) => void } => {
    const events: [string, SiteOutcome][] = [];
    return { events, onSiteDone: (siteId, outcome) => events.push([siteId, outcome]) };
  };

  it("reports each site once as it finishes a JQL load", async () => {
    const { events, onSiteDone } = progress();
    await new MultiSiteLoader(new FixtureSource(mockSites, mockLinkTypes)).load({ mode: "jql", jql: "" }, selected, sites, { onSiteDone });
    expect(events.sort()).toEqual([
      ["acme", "loaded"],
      ["partner", "loaded"],
    ]);
  });

  it("reports a failing site as failed as soon as it fails", async () => {
    const { events, onSiteDone } = progress();
    const loader = new MultiSiteLoader(new FixtureSource(mockSites, mockLinkTypes, new Set(["partner"])));
    await loader.load({ mode: "jql", jql: "" }, selected, sites, { onSiteDone });
    expect(events.sort()).toEqual([
      ["acme", "loaded"],
      ["partner", "failed"],
    ]);
  });

  it("reports sites of an epic load once the expansion across sites is done", async () => {
    let requests = 0;
    const doneAt: number[] = [];
    const loader = new MultiSiteLoader(watched(() => requests++));
    await loader.load({ mode: "epic", siteId: "acme", key: "CORE-1" }, selected, sites, {
      onSiteDone: () => doneAt.push(requests),
    });
    expect(doneAt).toHaveLength(2);
    expect(doneAt.every((n) => n === requests)).toBe(true); // no request was made after any report
  });

  it("reports no site as loaded when the load goes over the cap", async () => {
    const { events, onSiteDone } = progress();
    const res = await new MultiSiteLoader(new FixtureSource(mockSites, mockLinkTypes), { maxNodes: 3 }).load(
      { mode: "jql", jql: "" },
      selected,
      sites,
      { onSiteDone },
    );
    expect(res.kind).toBe("overCap");
    expect(events.filter(([, outcome]) => outcome === "loaded").length).toBeLessThan(selected.length);
  });

  it("never fails a load because the progress callback throws", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await new MultiSiteLoader(new FixtureSource(mockSites, mockLinkTypes)).load({ mode: "jql", jql: "" }, selected, sites, {
      onSiteDone: () => {
        throw new Error("UI bug");
      },
    });
    quiet.mockRestore();
    expect(res.kind).toBe("ok");
  });
});

describe("MultiSiteLoader cancellation", () => {
  it("starts no more requests once aborted, and rejects with an AbortError", async () => {
    const controller = new AbortController();
    let afterAbort = 0;
    const watchedSource = watched(() => {
      if (controller.signal.aborted) afterAbort++;
    });
    const events: [string, SiteOutcome][] = [];
    // Abort while the first search is in flight: the rest of the load must not start.
    const source: JiraSource = {
      ...watchedSource,
      fetchByJql: (s, j, m) => {
        const inFlight = watchedSource.fetchByJql(s, j, m);
        controller.abort();
        return inFlight;
      },
    };
    const loading = new MultiSiteLoader(source).load({ mode: "jql", jql: "" }, selected, sites, {
      signal: controller.signal,
      onSiteDone: (siteId, outcome) => events.push([siteId, outcome]),
    });
    await expect(loading).rejects.toSatisfy(isAbortError);
    expect(afterAbort).toBe(0);
    expect(events.filter(([, outcome]) => outcome === "failed")).toEqual([]); // an abort isn't a site failure
  });

  it("rejects right away when the signal is already aborted", async () => {
    let requests = 0;
    const loading = new MultiSiteLoader(watched(() => requests++)).load({ mode: "jql", jql: "" }, selected, sites, {
      signal: AbortSignal.abort(),
    });
    await expect(loading).rejects.toSatisfy(isAbortError);
    expect(requests).toBe(0);
  });
});
