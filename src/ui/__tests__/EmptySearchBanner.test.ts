import { describe, expect, it } from "vitest";
import type { SiteConfig } from "../../config/types";
import type { LoadResult } from "../../data/MultiSiteLoader";
import type { RawIssue } from "../../data/jiraTypes";
import { emptyScopedSearches } from "../EmptySearchBanner";

const github = (id: string, baseJql?: string): SiteConfig =>
  ({ id, kind: "github", label: id, baseUrl: "https://github.com", enabled: true, ...(baseJql ? { baseJql } : {}) }) as SiteConfig;
const jira = (id: string): SiteConfig => ({ id, label: id, baseUrl: "https://acme.atlassian.net", enabled: true }) as SiteConfig;

const loaded = (counts: Record<string, number>, errors: LoadResult["errors"] = []): LoadResult => ({
  kind: "ok",
  data: Object.entries(counts).map(([siteId, n]) => ({
    siteId,
    issues: Array.from({ length: n }, (_, i) => ({ key: `${siteId}#${i}` }) as RawIssue),
    remoteLinks: {},
    linkTypes: [],
  })),
  errors,
});

describe("emptyScopedSearches", () => {
  it("names the repositories and owners a GitHub search that found nothing was limited to", () => {
    const scope = { mode: "jql", jql: "", github: "repo:Change/Outreach is:pr (assignee:me OR author:me)" } as const;
    expect(emptyScopedSearches(scope, [github("gh")], loaded({ gh: 0 }))).toEqual([{ siteId: "gh", names: ["change/outreach"] }]);
  });

  it("reads the site's filter too", () => {
    const scope = { mode: "jql", jql: "", github: "is:open" } as const;
    expect(emptyScopedSearches(scope, [github("gh", "org:change")], loaded({ gh: 0 }))).toEqual([{ siteId: "gh", names: ["change"] }]);
  });

  it("says nothing when the search found tickets, names no repository, or the site failed", () => {
    const scope = { mode: "jql", jql: "", github: "repo:change/outreach" } as const;
    expect(emptyScopedSearches(scope, [github("gh")], loaded({ gh: 2 }))).toEqual([]);
    expect(emptyScopedSearches({ mode: "jql", jql: "", github: "is:open" }, [github("gh")], loaded({ gh: 0 }))).toEqual([]);
    expect(emptyScopedSearches({ mode: "jql", jql: "", github: "-repo:change/old" }, [github("gh")], loaded({ gh: 0 }))).toEqual([]);
    // A failed site is left out of the data; its error says why.
    expect(emptyScopedSearches(scope, [github("gh")], loaded({}, [{ siteId: "gh", message: "401" }]))).toEqual([]);
  });

  it("leaves Jira sites, other modes and over-cap loads alone", () => {
    const scope = { mode: "jql", jql: "project = X", github: "repo:change/outreach" } as const;
    expect(emptyScopedSearches(scope, [jira("j")], loaded({ j: 0 }))).toEqual([]);
    expect(emptyScopedSearches({ mode: "epic", siteId: "gh", key: "change/outreach#1" }, [github("gh")], loaded({ gh: 0 }))).toEqual([]);
    expect(emptyScopedSearches(scope, [github("gh")], { kind: "overCap", count: 301, errors: [] })).toEqual([]);
  });
});
