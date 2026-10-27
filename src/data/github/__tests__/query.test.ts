import { describe, expect, it } from "vitest";
import { combineGitHubQuery, inRepoScope, repoScopeOf } from "../query";

describe("combineGitHubQuery", () => {
  it("ANDs the site filter and the query as two groups (advanced search)", () => {
    expect(combineGitHubQuery(" org:acme ", "is:open ")).toBe("(org:acme) (is:open)");
    expect(combineGitHubQuery("", "is:open")).toBe("is:open");
    expect(combineGitHubQuery("org:acme", " ")).toBe("org:acme");
    expect(combineGitHubQuery("", " ")).toBe("");
  });

  it("keeps a query's OR inside its own group, so the site filter still applies to every branch", () => {
    expect(combineGitHubQuery("org:acme is:open", "label:bug OR label:feature")).toBe("(org:acme is:open) (label:bug OR label:feature)");
    expect(combineGitHubQuery("org:acme", "(repo:acme/web OR label:security)")).toBe("(org:acme) ((repo:acme/web OR label:security))");
  });

  it("reads repeated owner or repo qualifiers as either one, as filters written for the old search meant", () => {
    expect(combineGitHubQuery("repo:acme/web repo:acme/api", "is:open")).toBe("((repo:acme/web OR repo:acme/api)) (is:open)");
    expect(combineGitHubQuery("org:acme -repo:acme/old is:issue", "")).toBe("org:acme -repo:acme/old is:issue"); // one: as written
    expect(combineGitHubQuery("org:acme", "repo:acme/web OR repo:acme/api")).toBe("(org:acme) (repo:acme/web OR repo:acme/api)");
  });

  it("balances a side's parentheses before grouping it", () => {
    expect(combineGitHubQuery("(org:acme", "is:open")).toBe("((org:acme)) (is:open)");
    expect(combineGitHubQuery("org:acme)", "is:open")).toBe("(org:acme) (is:open)");
    expect(combineGitHubQuery('(org:acme "foo', "is:open")).toBe('((org:acme "foo")) (is:open)'); // the quote closes first
    expect(combineGitHubQuery('label:"foo', "is:open")).toBe('(label:"foo") (is:open)'); // and without a group too
    expect(combineGitHubQuery("org:acme", 'label:"a (b" is:open')).toBe('(org:acme) (label:"a (b" is:open)'); // quoted: as written
  });

  it("reads a quoted phrase as words to search for, not as qualifiers", () => {
    expect(combineGitHubQuery("org:acme", '"mentions repo:other/tools here"')).toBe('(org:acme) ("mentions repo:other/tools here")');
    expect(repoScopeOf('"see repo:other/tools" is:open')).toBeNull();
    expect(repoScopeOf('label:"foo repo:other/tools')).toBeNull(); // an unclosed quote runs to the end
  });

  it("reads a quoted owner or repo as that owner or repo", () => {
    expect(inRepoScope(repoScopeOf('repo:"Acme/Web"'), "acme/web#1")).toBe(true);
    expect(inRepoScope(repoScopeOf('org:acme -repo:"acme/old"'), "acme/old#1")).toBe(false);
    expect(inRepoScope(repoScopeOf('org:acme -org:"other"'), "other/x#1")).toBe(false);
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
    // Only acme/b can match here; a bound may be broader than the search, never narrower.
    const nested = repoScopeOf("org:acme NOT ((repo:acme/a) OR NOT repo:acme/b)");
    expect(["acme/b#2", "other/x#3"].map((k) => inRepoScope(nested, k))).toEqual([true, false]);
  });

  it("excludes under NOT only what the NOT-ed part names exactly", () => {
    // NOT (org:a repo:b/x) shuts out only tickets in both, so neither a nor b/x can be excluded.
    const both = repoScopeOf("NOT (org:a repo:b/x)");
    expect(["a/y#1", "b/x#2"].map((k) => inRepoScope(both, k))).toEqual([true, true]);
    expect(inRepoScope(repoScopeOf("NOT (org:a -repo:a/x)"), "a/x#1")).toBe(true);
    expect(inRepoScope(repoScopeOf("NOT (org:a is:open)"), "a/y#1")).toBe(true);
  });

  it("sets no repo bound when an OR branch could match any repo", () => {
    expect(repoScopeOf("(repo:acme/web OR label:security)")).toBeNull();
    expect(repoScopeOf("org:acme is:open")).not.toBeNull();
  });

  it("allows any repo when the filter names none", () => {
    expect(repoScopeOf("is:open label:bug")).toBeNull();
    expect(inRepoScope(repoScopeOf(undefined), "x/y#1")).toBe(true);
  });
});
