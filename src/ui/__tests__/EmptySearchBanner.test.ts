import { describe, expect, it } from "vitest";
import type { SiteConfig } from "../../config/types";
import type { LoadResult } from "../../data/MultiSiteLoader";
import type { RawIssue } from "../../data/jiraTypes";
import { emptyScopedSearches, keptDismissal } from "../EmptySearchBanner";

const jira = (id: string): SiteConfig => ({
  id,
  label: id,
  baseUrl: "https://acme.atlassian.net",
  auth: { type: "apiToken", email: "bot@example.com", secretRef: "DOMINO_TOKEN" },
  color: "#123456",
  enabled: true,
});
const github = (id: string, baseJql?: string): SiteConfig => ({
  id,
  kind: "github",
  label: id,
  baseUrl: "https://github.com",
  auth: { type: "githubToken", secretRef: "DOMINO_GITHUB_TOKEN" },
  color: "#123456",
  enabled: true,
  ...(baseJql ? { baseJql } : {}),
});

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

  it("leaves out a site whose refresh failed: its empty tickets are from before, and its error says why", () => {
    const scope = { mode: "jql", jql: "", github: "repo:change/outreach" } as const;
    const lagging = [{ siteId: "gh", takenAt: 0, message: "timeout" }];
    expect(emptyScopedSearches(scope, [github("gh")], loaded({ gh: 0 }), lagging)).toEqual([]);
  });
});

describe("keptDismissal", () => {
  const searches = [{ siteId: "gh", names: ["change/outreach"] }];

  it("keeps a dismissal while there's nothing settled to show (a load is running)", () => {
    expect(keptDismissal("key", null)).toBe("key");
    expect(keptDismissal("key", searches)).toBe("key");
  });

  it("forgets it once a settled load has no empty searches, so the same one coming back shows again", () => {
    expect(keptDismissal("key", [])).toBeNull();
    expect(keptDismissal(null, [])).toBeNull();
  });
});
