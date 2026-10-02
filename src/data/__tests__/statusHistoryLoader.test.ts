import { describe, expect, it } from "vitest";
import { buildGraph } from "../../graph/buildGraph";
import { computeTimeline, type Day } from "../../graph/schedule";
import type { Graph } from "../../graph/types";
import { defined, getOrThrow } from "../../lib/guards";
import { FixtureSource } from "../FixtureSource";
import { mockConfig, mockLinkTypes, mockSites } from "../mockData";
import { MultiSiteLoader } from "../MultiSiteLoader";
import { loadStatusHistory, type HistoryResult } from "../statusHistoryLoader";

const sites = mockConfig.sites;
const selected = sites.filter((s) => mockConfig.defaultSiteIds.includes(s.id));
const today = defined(mockSites.partner.generatedOn, "partner fixture generatedOn");

async function loadMock(fail = new Set<string>()): Promise<HistoryResult & { graph: Graph }> {
  const source = new FixtureSource(mockSites, mockLinkTypes, fail);
  const res = await new MultiSiteLoader(new FixtureSource(mockSites, mockLinkTypes)).load({ mode: "jql", jql: "" }, selected, sites);
  if (res.kind !== "ok") throw new Error("expected ok");
  const graph = buildGraph({ sites, data: res.data });
  return { graph, ...(await loadStatusHistory(source, graph)) };
}

describe("loadStatusHistory", () => {
  it("maps changelogs to status-category transitions by uid, oldest first", async () => {
    const { history, errors } = await loadMock();
    expect(errors).toEqual([]);
    expect(getOrThrow(history, "partner:PAY-1").map((c) => c.toCategory)).toEqual(["inprogress", "done"]);
    expect(getOrThrow(history, "partner:PAY-10").map((c) => c.toCategory)).toEqual(["inprogress", "inprogress"]); // In Progress -> In Review
    expect(history.has("acme:CORE-10")).toBe(false); // never started
    // Same key on two sites stays apart.
    expect(history.has("acme:CORE-7")).toBe(true);
    expect(history.has("partner:CORE-7")).toBe(false);
  });

  it("reports a failing site and keeps the other site's history", async () => {
    const { history, errors } = await loadMock(new Set(["partner"]));
    expect(errors).toMatchObject([{ siteId: "partner" }]);
    expect(errors[0].message).toContain("Status history unavailable");
    expect(history.has("acme:CORE-7")).toBe(true);
  });
});

describe("timeline on the mock data", () => {
  it("shows PAY-2 overrunning and its slip flowing down the cross-site chain", async () => {
    const { graph, history } = await loadMock();
    const t = computeTimeline(graph, history, { planStart: "2000-01-01", today, daysPerPoint: 1, defaultDays: 2 });
    expect(getOrThrow(t, "partner:PAY-1").progress.state).toBe("done");
    expect(getOrThrow(t, "partner:PAY-2").progress.state).toBe("started");
    expect(getOrThrow(t, "acme:CORE-10").progress.state).toBe("not-started");
    const end = (uid: string): Day => {
      const p = getOrThrow(t, uid).progress;
      return p.state === "done" ? p.actual.end : p.forecast.end;
    };
    // Each link in the chain finishes after its blocker.
    for (const [a, b] of [["partner:PAY-2", "partner:PAY-3"], ["partner:PAY-3", "acme:CORE-10"], ["acme:CORE-10", "acme:CORE-11"]]) {
      expect(end(b) > end(a), `${b} after ${a}`).toBe(true);
    }
  });
});
