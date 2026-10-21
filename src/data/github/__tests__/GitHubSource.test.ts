import { describe, expect, it } from "vitest";
import type { GitHubApi } from "../GitHubApi";
import type { GhNode, GhViewer } from "../githubTypes";
import { GitHubSource } from "../GitHubSource";

/** A GitHub that answers with whatever `nodes` holds now, counting requests. */
function fakeApi(nodes: Map<string, GhNode>): GitHubApi & { calls: number } {
  const api = {
    calls: 0,
    search: (): Promise<GhNode[]> => Promise.resolve([...nodes.values()]),
    issues: (_site: string, keys: readonly string[]): Promise<GhNode[]> => {
      api.calls++;
      return Promise.resolve(keys.flatMap((k) => nodes.get(k) ?? []));
    },
    subIssues: (): Promise<GhNode[]> => Promise.resolve([]),
    viewer: (): Promise<GhViewer> => Promise.resolve({ login: "me" }),
  };
  return api;
}

const ticket = (title: string, body = ""): GhNode => ({
  __typename: "Issue",
  number: 1,
  title,
  state: "OPEN",
  repository: { nameWithOwner: "Acme/Web" },
  body,
});

describe("GitHubSource", () => {
  it("fetches a ticket afresh each time it's asked for, so a refresh sees changes", async () => {
    const nodes = new Map([["acme/web#1", ticket("Before")]]);
    const source = new GitHubSource(fakeApi(nodes));
    expect((await source.fetchIssue("gh", "acme/web#1")).fields.summary).toBe("Before");
    nodes.set("acme/web#1", ticket("After"));
    expect((await source.fetchIssue("gh", "acme/web#1")).fields.summary).toBe("After");
  });

  it("finds tickets whatever case the key or GitHub's reply uses", async () => {
    const source = new GitHubSource(fakeApi(new Map([["acme/web#1", ticket("Hi")]])));
    expect((await source.fetchIssue("gh", "acme/web#1")).key).toBe("acme/web#1");
  });

  it("follows a renamed repo or transferred issue to where GitHub says it is now", async () => {
    const api = fakeApi(new Map());
    api.issues = (): Promise<GhNode[]> => Promise.resolve([{ ...ticket("Moved"), repository: { nameWithOwner: "acme/new" } }]);
    expect((await new GitHubSource(api).fetchIssue("gh", "acme/old#1")).key).toBe("acme/new#1");
  });

  it("doesn't take a lone reply that has no key for the ticket asked for", async () => {
    const api = fakeApi(new Map());
    api.issues = (): Promise<GhNode[]> => Promise.resolve([{ title: "no repository or number" }]);
    await expect(new GitHubSource(api).fetchIssue("gh", "acme/web#1")).rejects.toThrow("does not exist");
  });

  it("loads an epic's sub-issues whatever case its key was typed in", async () => {
    const parent: GhNode = { ...ticket("Epic"), subIssuesSummary: { total: 1 } };
    const child: GhNode = { ...ticket("Child"), number: 2 };
    const api = fakeApi(new Map([["acme/web#1", parent]]));
    let asked = "";
    api.subIssues = (_site: string, key: string): Promise<GhNode[]> => {
      asked = key;
      return Promise.resolve([child]);
    };
    const { children } = await new GitHubSource(api).fetchEpic("gh", "ACME/Web#1");
    expect(asked).toBe("acme/web#1");
    expect(children.map((c) => c.key)).toEqual(["acme/web#2"]);
  });

  it("doesn't let a reply that lands after clear() repopulate the cache", async () => {
    const nodes = new Map([["acme/web#1", ticket("Old account", "See https://acme.atlassian.net/browse/CORE-1")]]);
    const api = fakeApi(nodes);
    let resolveSearch: (nodes: GhNode[]) => void = () => undefined;
    api.search = (): Promise<GhNode[]> =>
      new Promise((resolve) => {
        resolveSearch = resolve;
      });
    const source = new GitHubSource(api);
    const pending = source.fetchByJql("gh", "org:acme");
    source.clear(); // a token or host change while the search is in flight
    resolveSearch([...nodes.values()]);
    await pending;
    nodes.set("acme/web#1", ticket("New account"));
    expect(await source.fetchRemoteLinks("gh", "acme/web#1")).toEqual([]);
    expect(api.calls).toBe(1);
  });

  it("keeps a renamed repo's tickets out when the new name is outside the site filter", async () => {
    const api = fakeApi(new Map());
    api.issues = (): Promise<GhNode[]> => Promise.resolve([{ ...ticket("Moved"), repository: { nameWithOwner: "acme/new" } }]);
    expect(await new GitHubSource(api).fetchByKeys("gh", ["acme/old#1"], "repo:acme/old")).toEqual([]);
  });

  it("fetches a description afresh, even for a ticket loaded earlier (it may be a ghost now)", async () => {
    const nodes = new Map([["acme/web#1", { ...ticket("T"), bodyText: "Before" }]]);
    const source = new GitHubSource(fakeApi(nodes));
    await source.fetchByJql("gh", "org:acme");
    nodes.set("acme/web#1", { ...ticket("T"), bodyText: "After" });
    expect(JSON.stringify(await source.fetchDescription("gh", "acme/web#1"))).toContain("After");
  });

  it("reuses a loaded ticket for its follow-up calls until it's cleared", async () => {
    const nodes = new Map([["acme/web#1", ticket("T", "See https://acme.atlassian.net/browse/CORE-1")]]);
    const api = fakeApi(nodes);
    const source = new GitHubSource(api);
    await source.fetchByJql("gh", "org:acme");
    expect(await source.fetchRemoteLinks("gh", "acme/web#1")).toHaveLength(1);
    expect(api.calls).toBe(0);
    nodes.set("acme/web#1", ticket("T"));
    source.clear();
    expect(await source.fetchRemoteLinks("gh", "acme/web#1")).toEqual([]);
    expect(api.calls).toBe(1);
  });
});
