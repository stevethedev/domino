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
