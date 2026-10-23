import { describe, expect, it } from "vitest";
import { mockGitHub } from "../../mockData";
import { FixtureGitHubApi } from "../FixtureGitHubApi";
import { keyOf } from "../toRaw";

const keys = async (query: string): Promise<(string | null)[]> =>
  (await new FixtureGitHubApi(mockGitHub).search("gh", query)).map((n) => keyOf(n));

describe("FixtureGitHubApi", () => {
  it.each([
    ['org:"acme" is:open', "org:acme is:open"],
    ['repo:"acme/api"', "repo:acme/api"],
    ['org:acme -repo:"acme/api"', "org:acme -repo:acme/api"],
  ])("reads the quoted value in %s as the value", async (quoted, plain) => {
    const want = await keys(plain);
    expect(want).not.toEqual([]);
    expect(await keys(quoted)).toEqual(want);
  });
});
