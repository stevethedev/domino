import { describe, expect, it } from "vitest";
import { combineGitHubQuery, inRepoScope, repoScopeOf } from "../query";

describe("combineGitHubQuery", () => {
  it("joins the site filter and the query with a space (GitHub ANDs terms)", () => {
    expect(combineGitHubQuery(" org:acme ", "is:open ")).toBe("org:acme is:open");
    expect(combineGitHubQuery("", "is:open")).toBe("is:open");
    expect(combineGitHubQuery("", " ")).toBe("");
  });
});

describe("repoScopeOf / inRepoScope", () => {
  it("keeps linked tickets to the owners and repos the filter names", () => {
    const scope = repoScopeOf("org:Acme repo:other/tools is:open -repo:acme/legacy");
    expect(inRepoScope(scope, "acme/web#1")).toBe(true);
    expect(inRepoScope(scope, "other/tools#2")).toBe(true);
    expect(inRepoScope(scope, "other/web#3")).toBe(false);
    expect(inRepoScope(scope, "not a key")).toBe(false);
  });

  it("allows any repo when the filter names none", () => {
    expect(repoScopeOf("is:open label:bug")).toBeNull();
    expect(inRepoScope(repoScopeOf(undefined), "x/y#1")).toBe(true);
  });
});
