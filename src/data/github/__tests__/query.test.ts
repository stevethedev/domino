import { describe, expect, it } from "vitest";
import { combineGitHubQuery, inRepoScope, repoScopeOf } from "../query";

describe("combineGitHubQuery", () => {
  it("joins the site filter and the query with a space (GitHub ANDs terms)", () => {
    expect(combineGitHubQuery(" org:acme ", "is:open ")).toBe("org:acme is:open");
    expect(combineGitHubQuery("", "is:open")).toBe("is:open");
    expect(combineGitHubQuery("", " ")).toBe("");
    expect(combineGitHubQuery("org:acme -repo:acme/legacy", "is:open")).toBe("org:acme -repo:acme/legacy is:open");
  });

  it("sends only the repos both allow when both name some (GitHub would OR them)", () => {
    expect(combineGitHubQuery("repo:acme/web repo:acme/api", "repo:acme/api is:open")).toBe("is:open repo:acme/api");
    expect(combineGitHubQuery("org:acme is:issue", "repo:Acme/API")).toBe("is:issue repo:acme/api");
    expect(combineGitHubQuery("org:acme", "org:acme label:bug")).toBe("label:bug org:acme");
    expect(combineGitHubQuery("user:octo", "repo:octo/tools repo:acme/web")).toBe("repo:octo/tools");
    expect(combineGitHubQuery("org:acme -repo:acme/old", "repo:acme/api")).toBe("-repo:acme/old repo:acme/api");
  });

  it("reads a quoted phrase as words to search for, not as qualifiers", () => {
    expect(combineGitHubQuery("org:acme", '"mentions repo:other/tools here"')).toBe('org:acme "mentions repo:other/tools here"');
    expect(combineGitHubQuery("repo:acme/web repo:acme/api", 'label:"needs  review" repo:acme/api')).toBe(
      'label:"needs  review" repo:acme/api',
    );
    expect(repoScopeOf('"see repo:other/tools" is:open')).toBeNull();
    expect(repoScopeOf('label:"foo repo:other/tools')).toBeNull(); // an unclosed quote runs to the end
  });

  it("reads a quoted owner or repo as that owner or repo", () => {
    expect(combineGitHubQuery("org:acme", 'repo:"acme/web" is:open')).toBe("is:open repo:acme/web");
    expect(combineGitHubQuery('org:"acme"', 'org:acme label:"a b"')).toBe('label:"a b" org:acme');
    expect(inRepoScope(repoScopeOf('repo:"Acme/Web"'), "acme/web#1")).toBe(true);
    expect(inRepoScope(repoScopeOf('org:acme -repo:"acme/old"'), "acme/old#1")).toBe(false);
    expect(inRepoScope(repoScopeOf('org:acme -org:"other"'), "other/x#1")).toBe(false);
  });

  it("joins a Boolean or grouped search as written, rather than rewriting its qualifiers", () => {
    expect(combineGitHubQuery("org:acme", "repo:acme/web OR repo:acme/api")).toBe("org:acme repo:acme/web OR repo:acme/api");
    expect(combineGitHubQuery("org:acme", "(repo:acme/web OR repo:acme/api) is:open")).toBe(
      "org:acme (repo:acme/web OR repo:acme/api) is:open",
    );
    expect(combineGitHubQuery("org:acme", 'repo:acme/web "this OR that"')).toBe('"this OR that" repo:acme/web'); // quoted: plain text
  });

  it("is null when the site and the query share no repo", () => {
    expect(combineGitHubQuery("repo:acme/web", "repo:acme/api")).toBeNull();
    expect(combineGitHubQuery("org:acme", "org:other")).toBeNull();
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

  it("keeps excluded owners and repos out", () => {
    const scope = repoScopeOf("org:acme -repo:acme/legacy");
    expect(inRepoScope(scope, "acme/web#1")).toBe(true);
    expect(inRepoScope(scope, "acme/legacy#2")).toBe(false);
    const onlyExcluded = repoScopeOf("-repo:acme/legacy -org:other is:open");
    expect(inRepoScope(onlyExcluded, "acme/web#1")).toBe(true);
    expect(inRepoScope(onlyExcluded, "Acme/Legacy#2")).toBe(false);
    expect(inRepoScope(onlyExcluded, "other/x#3")).toBe(false);
  });

  it("reads grouped and NOT-ed qualifiers as GitHub does", () => {
    const grouped = repoScopeOf("(repo:acme/web OR repo:acme/api) is:open");
    expect(["acme/web#1", "acme/api#2", "acme/other#3"].map((k) => inRepoScope(grouped, k))).toEqual([true, true, false]);
    const not = repoScopeOf("org:acme NOT repo:acme/old");
    expect(["acme/web#1", "acme/old#2"].map((k) => inRepoScope(not, k))).toEqual([true, false]);
    const notGroup = repoScopeOf("org:acme NOT (repo:acme/a OR repo:acme/b) is:open");
    expect(["acme/a#1", "acme/b#2", "acme/c#3"].map((k) => inRepoScope(notGroup, k))).toEqual([false, false, true]);
    expect(inRepoScope(repoScopeOf("org:acme NOT -repo:acme/x"), "acme/x#1")).toBe(true); // excluded twice: included
  });

  it("allows any repo when the filter names none", () => {
    expect(repoScopeOf("is:open label:bug")).toBeNull();
    expect(inRepoScope(repoScopeOf(undefined), "x/y#1")).toBe(true);
  });
});
