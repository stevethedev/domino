import { describe, expect, it } from "vitest";
import type { ConfigStore } from "../../config/ConfigStore";
import type { SiteConfig } from "../../config/types";
import { buildGraph } from "../../graph/buildGraph";
import { FixtureSource } from "../FixtureSource";
import { FixtureGitHubApi } from "../github/FixtureGitHubApi";
import type { GhNode } from "../github/githubTypes";
import { GitHubSource } from "../github/GitHubSource";
import { mockConfig, mockGitHub, mockLinkTypes, mockSites } from "../mockData";
import { MultiSiteLoader } from "../MultiSiteLoader";
import { RoutingSource, SiteKinds } from "../RoutingSource";

const kinds = new SiteKinds();
kinds.update(mockConfig);
const source = new RoutingSource(
  new FixtureSource(mockSites, mockLinkTypes),
  new GitHubSource(new FixtureGitHubApi(mockGitHub)),
  kinds.kindOf,
);
const sites = mockConfig.sites;
const pick = (...ids: string[]): SiteConfig[] => sites.filter((s) => ids.includes(s.id));

describe("RoutingSource", () => {
  it("sends each site's calls to its kind's source", async () => {
    expect(kinds.kindOf("gh")).toBe("github");
    expect(kinds.kindOf("acme")).toBe("jira");
    expect((await source.fetchIssue("gh", "acme/web#42")).fields.status?.name).toBe("Merged");
    expect((await source.fetchIssue("acme", "CORE-1")).key).toBe("CORE-1");
    expect(await source.fetchMyself("gh")).toMatchObject({ accountId: "jonasberg", displayName: "Jonas Berg" });
  });
});

describe("SiteKinds.track", () => {
  it("reports every config or credential change, so cached GitHub data can be dropped", async () => {
    let changes = 0;
    const tracking = new SiteKinds(() => {
      changes++;
    });
    const config = mockConfig;
    const inner = {
      load: () => Promise.resolve(config),
      save: (c: typeof config) => Promise.resolve(c),
      reloadFile: () => Promise.resolve(config),
      startFresh: () => Promise.resolve({ config, setAside: null }),
      setSecret: () => Promise.resolve(),
    } as unknown as ConfigStore;
    const store = tracking.track(inner);
    await store.load();
    await store.save(config);
    await store.reloadFile();
    await store.startFresh();
    await store.setSecret("DOMINO_GITHUB_TOKEN", "new");
    expect(changes).toBe(5);
    expect(tracking.kindOf("gh")).toBe("github");
  });
});

describe("loading Jira and GitHub sites together", () => {
  it("runs each site's own query: JQL on Jira, the GitHub search on GitHub", async () => {
    const res = await new MultiSiteLoader(source).load({ mode: "jql", jql: "project = CORE", github: "is:pr" }, pick("acme", "gh"), sites);
    if (res.kind !== "ok") throw new Error("expected ok");
    expect(res.errors).toEqual([]);
    const gh = res.data.find((d) => d.siteId === "gh");
    expect(gh?.issues.map((i) => i.key)).toEqual(["acme/web#42", "acme/web#45"]);
    expect(res.data.find((d) => d.siteId === "acme")?.issues.every((i) => i.key.startsWith("CORE-"))).toBe(true);
  });

  it("follows links both ways across Jira and GitHub when seeding", async () => {
    // CORE-10 links PR acme/web#42, which closes web#32, a sub-issue of web#30.
    const res = await new MultiSiteLoader(source).load(
      { mode: "seed", siteId: "acme", key: "CORE-10", depth: 2 },
      pick("acme", "gh"),
      sites,
    );
    if (res.kind !== "ok") throw new Error("expected ok");
    const g = buildGraph({ sites, data: res.data });
    const loaded = new Set(g.nodes.filter((n) => !n.ghost).map((n) => n.uid));
    expect(loaded).toContain("gh:acme/web#42");
    expect(loaded).toContain("gh:acme/web#32");
    expect(g.edges).toContainEqual(expect.objectContaining({ source: "acme:CORE-10", target: "gh:acme/web#42", crossSite: true }));
    expect(g.edges).toContainEqual(expect.objectContaining({ source: "gh:acme/web#42", target: "gh:acme/web#32", linkType: "closes" }));
    expect(g.nodes.find((n) => n.uid === "gh:acme/web#32")?.epic?.uid).toBe("gh:acme/web#30");
  });

  it("links a GitHub issue to the Jira ticket its body mentions", async () => {
    const res = await new MultiSiteLoader(source).load(
      { mode: "seed", siteId: "gh", key: "acme/api#12", depth: 1 },
      pick("acme", "gh"),
      sites,
    );
    if (res.kind !== "ok") throw new Error("expected ok");
    const g = buildGraph({ sites, data: res.data });
    expect(g.nodes.find((n) => n.uid === "acme:CORE-11")?.ghost).toBe(false);
    expect(g.edges).toContainEqual(expect.objectContaining({ source: "gh:acme/api#12", target: "acme:CORE-11", kind: "relates" }));
    expect(g.edges).toContainEqual(expect.objectContaining({ source: "gh:acme/api#12", target: "gh:acme/web#31", kind: "blocks" }));
  });

  it("loads a GitHub parent issue with its sub-issues as an epic", async () => {
    const res = await new MultiSiteLoader(source).load({ mode: "epic", siteId: "gh", key: "acme/web#30" }, pick("gh"), sites);
    if (res.kind !== "ok") throw new Error("expected ok");
    expect(res.errors).toEqual([]);
    const g = buildGraph({ sites, data: res.data });
    expect(
      g.nodes
        .filter((n) => n.epic?.uid === "gh:acme/web#30" && !n.ghost)
        .map((n) => n.key)
        .sort(),
    ).toEqual(["acme/web#31", "acme/web#32"]);
  });

  it("keeps linked tickets outside a GitHub site's repos as ghosts", async () => {
    const narrowed = sites.map((s) => (s.id === "gh" ? { ...s, baseJql: "repo:acme/web" } : s));
    const res = await new MultiSiteLoader(source).load(
      { mode: "seed", siteId: "gh", key: "acme/web#31", depth: 1 },
      narrowed.filter((s) => s.id === "gh"),
      narrowed,
    );
    if (res.kind !== "ok") throw new Error("expected ok");
    const g = buildGraph({ sites: narrowed, data: res.data });
    expect(g.nodes.find((n) => n.uid === "gh:acme/api#12")?.ghost).toBe(true);
    expect(g.nodes.find((n) => n.uid === "gh:acme/web#45")?.ghost).toBe(false);
  });

  it("keeps a query from widening the site's repos (GitHub ORs repeated repo qualifiers)", async () => {
    const narrowed = sites.map((s) => (s.id === "gh" ? { ...s, baseJql: "repo:acme/web" } : s));
    const res = await new MultiSiteLoader(source).load(
      { mode: "jql", jql: "", github: "repo:acme/api" },
      narrowed.filter((s) => s.id === "gh"),
      narrowed,
    );
    if (res.kind !== "ok") throw new Error("expected ok");
    expect(res.data[0]?.issues.every((i) => i.key.startsWith("acme/web#"))).toBe(true);
  });

  it("lets a query's repo qualifiers narrow the site's repos", async () => {
    const narrowed = sites.map((s) => (s.id === "gh" ? { ...s, baseJql: "repo:acme/web repo:acme/api" } : s));
    const res = await new MultiSiteLoader(source).load(
      { mode: "jql", jql: "", github: "repo:acme/api" },
      narrowed.filter((s) => s.id === "gh"),
      narrowed,
    );
    if (res.kind !== "ok") throw new Error("expected ok");
    const keys = res.data[0]?.issues.map((i) => i.key) ?? [];
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.every((k) => k.startsWith("acme/api#"))).toBe(true);
  });

  it("counts only the repos both the site and the query allow toward the cap", async () => {
    const narrowed = sites.map((s) => (s.id === "gh" ? { ...s, baseJql: "repo:acme/web repo:acme/api" } : s));
    // Searched as GitHub would OR them, both repos return 7 tickets: over a cap of 4. acme/api alone is 2.
    const res = await new MultiSiteLoader(source, { maxNodes: 4 }).load(
      { mode: "jql", jql: "", github: "repo:acme/api" },
      narrowed.filter((s) => s.id === "gh"),
      narrowed,
    );
    if (res.kind !== "ok") throw new Error("expected ok");
    expect(res.data[0]?.issues).toHaveLength(2);
  });

  it("connects a link to a renamed repo's old name to the ticket GitHub answers with", async () => {
    // acme/web has been renamed acme/site: GitHub answers for acme/web#42 under its new name.
    const fixture = new FixtureGitHubApi(mockGitHub);
    const renamed = new FixtureGitHubApi(mockGitHub);
    renamed.issues = async (siteId, keys): Promise<GhNode[]> =>
      (await fixture.issues(siteId, keys)).map((n) => ({ ...n, repository: { nameWithOwner: "acme/site" } }));
    const routed = new RoutingSource(new FixtureSource(mockSites, mockLinkTypes), new GitHubSource(renamed), kinds.kindOf);
    const res = await new MultiSiteLoader(routed).load(
      { mode: "seed", siteId: "acme", key: "CORE-10", depth: 1 },
      pick("acme", "gh"),
      sites,
    );
    if (res.kind !== "ok") throw new Error("expected ok");
    const g = buildGraph({ sites, data: res.data });
    expect(g.nodes.find((n) => n.uid === "gh:acme/site#42")?.ghost).toBe(false);
    expect(g.nodes.some((n) => n.uid === "gh:acme/web#42")).toBe(false);
    expect(g.edges).toContainEqual(expect.objectContaining({ source: "acme:CORE-10", target: "gh:acme/site#42" }));
  });

  it("connects a renamed repo's old name reached after the ticket loaded under its new one", async () => {
    // Seeded as acme/site#42 (acme/web's new name), which links to CORE-10; CORE-10, a round later,
    // links back to it under the old name, acme/web#42.
    const fixture = new FixtureGitHubApi(mockGitHub);
    const renamed = new FixtureGitHubApi(mockGitHub);
    const answer = async (siteId: string, key: string): Promise<GhNode[]> =>
      (await fixture.issues(siteId, [key.replace(/^acme\/site#/, "acme/web#")])).map((n) => ({
        ...n,
        body: "Fixes https://acme.atlassian.net/browse/CORE-10",
        repository: { nameWithOwner: "acme/site" },
        requestedKey: key,
      }));
    renamed.issues = async (siteId, keys): Promise<GhNode[]> => (await Promise.all(keys.map((k) => answer(siteId, k)))).flat();
    const routed = new RoutingSource(new FixtureSource(mockSites, mockLinkTypes), new GitHubSource(renamed), kinds.kindOf);
    const res = await new MultiSiteLoader(routed).load(
      { mode: "seed", siteId: "gh", key: "acme/site#42", depth: 2 },
      pick("acme", "gh"),
      sites,
    );
    if (res.kind !== "ok") throw new Error("expected ok");
    const g = buildGraph({ sites, data: res.data });
    expect(g.nodes.some((n) => n.uid === "acme:CORE-10")).toBe(true);
    expect(g.nodes.some((n) => n.uid === "gh:acme/web#42")).toBe(false);
    expect(g.edges).toContainEqual(expect.objectContaining({ source: "acme:CORE-10", target: "gh:acme/site#42" }));
  });

  it("finds a GitHub ticket the seed's body mentions, though only the mentioned ticket's timeline records it", async () => {
    const ticket = (number: number, body: string): GhNode => ({
      __typename: "Issue",
      number,
      title: `T${number}`,
      state: "OPEN",
      repository: { nameWithOwner: "acme/web" },
      url: `https://github.com/acme/web/issues/${number}`,
      body,
    });
    const api = new FixtureGitHubApi({ issues: [ticket(1, "Follows acme/web#2."), ticket(2, "")], viewer: mockGitHub.viewer });
    const routed = new RoutingSource(new FixtureSource(mockSites, mockLinkTypes), new GitHubSource(api), kinds.kindOf);
    const res = await new MultiSiteLoader(routed).load({ mode: "seed", siteId: "gh", key: "acme/web#1", depth: 1 }, pick("gh"), sites);
    if (res.kind !== "ok") throw new Error("expected ok");
    expect(res.data[0]?.issues.map((i) => i.key).sort()).toEqual(["acme/web#1", "acme/web#2"]);
  });

  it("keeps the tickets a grouped GitHub search returns, from every repo it names", async () => {
    const api = new FixtureGitHubApi(mockGitHub);
    // As GitHub answers it (the fixture's search subset can't read groups).
    api.search = (): Promise<GhNode[]> =>
      Promise.resolve(
        mockGitHub.issues.filter((n) => ["acme/web", "acme/api"].includes((n.repository?.nameWithOwner ?? "").toLowerCase())),
      );
    const routed = new RoutingSource(new FixtureSource(mockSites, mockLinkTypes), new GitHubSource(api), kinds.kindOf);
    const res = await new MultiSiteLoader(routed).load(
      { mode: "jql", jql: "", github: "(repo:acme/web OR repo:acme/api) is:open" },
      pick("gh"),
      sites,
    );
    if (res.kind !== "ok") throw new Error("expected ok");
    const repos = new Set(res.data[0]?.issues.map((i) => i.key.split("#")[0]));
    expect(repos).toEqual(new Set(["acme/web", "acme/api"]));
  });

  it("follows links from a seed whose key GitHub spells differently", async () => {
    const res = await new MultiSiteLoader(source).load({ mode: "seed", siteId: "gh", key: "ACME/Web#31", depth: 1 }, pick("gh"), sites);
    if (res.kind !== "ok") throw new Error("expected ok");
    expect(res.data[0]?.issues.map((i) => i.key)).toContain("acme/api#12");
  });

  it("finds tickets by key whatever their case, in the browser preview too", async () => {
    expect((await source.fetchByKeys("gh", ["ACME/Web#42"])).map((i) => i.key)).toEqual(["acme/web#42"]);
  });

  it("rejects a Jira key on a GitHub site", async () => {
    const res = await new MultiSiteLoader(source).load({ mode: "seed", siteId: "gh", key: "CORE-1", depth: 1 }, pick("gh"), sites);
    expect(res.errors).toEqual([{ siteId: "gh", message: '"CORE-1" is not a valid ticket key (expected one like acme/web#12)' }]);
  });
});
