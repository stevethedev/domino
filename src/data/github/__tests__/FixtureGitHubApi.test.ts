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

  it("evaluates a search as GitHub's advanced search does: AND by default, OR, NOT and groups", async () => {
    const [web, api] = [await keys("repo:acme/web"), await keys("repo:acme/api")];
    expect(await keys("repo:acme/web repo:acme/api")).toEqual([]);
    expect((await keys("repo:acme/web OR repo:acme/api")).sort()).toEqual([...web, ...api].sort());
    expect(await keys("(org:acme) (is:open)")).toEqual(await keys("org:acme is:open"));
    expect(await keys("org:acme NOT repo:acme/web")).toEqual(await keys("org:acme -repo:acme/web"));
  });
});
