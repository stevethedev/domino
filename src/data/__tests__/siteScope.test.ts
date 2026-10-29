import { describe, expect, it } from "vitest";
import type { SiteConfig } from "../../config/types";
import { coverageOf, filtersOverlap, overlappingSites, siteForKey } from "../siteScope";

const gh = (id: string, baseJql = ""): SiteConfig => ({
  id,
  kind: "github",
  label: id,
  baseUrl: "https://github.com",
  auth: { type: "githubToken", secretRef: "DOMINO_GITHUB_TOKEN" },
  color: "#24292f",
  enabled: true,
  baseJql,
});

const jira = (id: string, baseJql = ""): SiteConfig => ({
  id,
  label: id,
  baseUrl: "https://acme.atlassian.net",
  auth: { type: "oauth3lo" },
  color: "#123456",
  enabled: true,
  baseJql,
});

describe("coverageOf", () => {
  it("tells a GitHub filter naming the repo or owner from one that only lets it through", () => {
    expect(coverageOf(gh("a", "org:hedge-lang is:issue"), "hedge-lang/hedge#1")).toBe("named");
    expect(coverageOf(gh("a", "repo:Hedge-Lang/hedge"), "hedge-lang/hedge#1")).toBe("named");
    expect(coverageOf(gh("a", "is:issue"), "hedge-lang/hedge#1")).toBe("any");
    expect(coverageOf(gh("a", "-org:acme"), "hedge-lang/hedge#1")).toBe("any");
    expect(coverageOf(gh("a", "org:acme"), "hedge-lang/hedge#1")).toBe("none");
    expect(coverageOf(gh("a", "org:hedge-lang -repo:hedge-lang/hedge"), "hedge-lang/hedge#1")).toBe("none");
  });

  it("reads a Jira filter's projects, and takes in anything when it can't tell", () => {
    expect(coverageOf(jira("a", "project = CORE"), "CORE-1")).toBe("named");
    expect(coverageOf(jira("a", 'project in (CORE, "WEB") AND status != Done ORDER BY rank'), "WEB-2")).toBe("named");
    expect(coverageOf(jira("a", "project = CORE"), "WEB-2")).toBe("none");
    expect(coverageOf(jira("a", "assignee = currentUser()"), "WEB-2")).toBe("any");
    // ORs, NOTs and project names (not keys) say nothing reliable about which projects come in.
    expect(coverageOf(jira("a", "project = CORE OR labels = x"), "WEB-2")).toBe("any");
    expect(coverageOf(jira("a", "project not in (CORE)"), "WEB-2")).toBe("any");
    expect(coverageOf(jira("a", 'project = "Core Platform"'), "WEB-2")).toBe("any");
  });

  it("takes only a value written in capitals for a project key: anything else can be a project name", () => {
    // A project named Frontend (key WEB): reading FRONTEND as its key would keep WEB tickets out.
    expect(coverageOf(jira("a", "project = Frontend"), "WEB-2")).toBe("any");
    expect(coverageOf(jira("a", 'project in (CORE, "Frontend")'), "WEB-2")).toBe("any");
    expect(coverageOf(jira("a", "project = web"), "WEB-2")).toBe("any");
  });

  it("keeps only the projects every ANDed project clause allows", () => {
    expect(coverageOf(jira("a", "project in (CORE, WEB) AND project = CORE"), "WEB-2")).toBe("none");
    expect(coverageOf(jira("a", "project in (CORE, WEB) AND project = CORE"), "CORE-1")).toBe("named");
    expect(coverageOf(jira("a", "project = CORE AND project = WEB"), "CORE-1")).toBe("none");
  });

  it("reads JQL's symbolic OR and NOT like their words, and && like AND", () => {
    expect(coverageOf(jira("a", "project = CORE || project = WEB"), "WEB-2")).toBe("any");
    expect(coverageOf(jira("a", "!(project = CORE)"), "WEB-2")).toBe("any");
    expect(coverageOf(jira("a", "project = WEB && status != Done && summary !~ x"), "WEB-2")).toBe("named");
    expect(coverageOf(jira("a", "project = WEB && status != Done"), "CORE-1")).toBe("none");
  });

  it("reads past quoted text, which is never filter syntax", () => {
    expect(coverageOf(jira("a", 'summary ~ "project = CORE"'), "WEB-2")).toBe("any");
    expect(coverageOf(jira("a", 'summary ~ "order by" OR project = WEB'), "CORE-1")).toBe("any");
    expect(coverageOf(jira("a", 'summary ~ "a \\" or b" AND project = WEB'), "WEB-2")).toBe("named");
    expect(coverageOf(jira("a", 'project = "WEB" AND labels = "x or y"'), "WEB-2")).toBe("named");
  });
});

describe("siteForKey", () => {
  const hedge = gh("hedge", "org:hedge-lang");
  const work = gh("work", "org:acme");
  const rest = gh("rest", "is:issue");

  it("keeps a link on its own site when that site's filter takes it in", () => {
    expect(siteForKey([work, rest, hedge], "acme/web#1", rest)?.id).toBe("rest");
    expect(siteForKey([work, hedge], "acme/web#1", work)?.id).toBe("work");
  });

  it("moves a link outside its site's filter to the site that covers it, naming it first", () => {
    expect(siteForKey([work, rest, hedge], "hedge-lang/hedge#7", work)?.id).toBe("hedge");
    expect(siteForKey([work, rest], "hedge-lang/hedge#7", work)?.id).toBe("rest");
  });

  it("leaves a link no site covers where it was", () => {
    expect(siteForKey([work, hedge], "other/x#1", work)?.id).toBe("work");
  });

  it("without a starting site, picks the best cover, else the first site", () => {
    expect(siteForKey([rest, work, hedge], "hedge-lang/hedge#7")?.id).toBe("hedge");
    expect(siteForKey([rest, work], "hedge-lang/hedge#7")?.id).toBe("rest");
    expect(siteForKey([work, hedge], "other/x#1")?.id).toBe("work");
    expect(siteForKey<SiteConfig>([], "other/x#1")).toBeUndefined();
  });
});

describe("filtersOverlap", () => {
  it("finds GitHub filters that could match the same ticket", () => {
    expect(filtersOverlap(gh("a", "org:acme"), gh("b", "org:hedge-lang"))).toBe(false);
    expect(filtersOverlap(gh("a", "org:acme"), gh("b", "repo:acme/web"))).toBe(true);
    expect(filtersOverlap(gh("a", "org:acme -repo:acme/web"), gh("b", "repo:acme/web"))).toBe(false);
    expect(filtersOverlap(gh("a", "org:acme"), gh("b", "is:issue"))).toBe(true);
    expect(filtersOverlap(gh("a", "-org:acme"), gh("b", "org:acme"))).toBe(false);
  });

  it("finds Jira filters on the same projects, or that can't be told apart", () => {
    expect(filtersOverlap(jira("a", "project = CORE"), jira("b", "project = WEB"))).toBe(false);
    expect(filtersOverlap(jira("a", "project in (CORE, WEB)"), jira("b", "project = WEB"))).toBe(true);
    expect(filtersOverlap(jira("a", "project = CORE"), jira("b", "labels = x"))).toBe(true);
  });
});

describe("overlappingSites", () => {
  it("lists the other sites on the address whose filters could load the same tickets", () => {
    const others = [
      gh("work", "org:acme"),
      gh("web", "repo:acme/web"),
      jira("j", "project = CORE"),
      { ...gh("ghe", ""), baseUrl: "https://ghe.acme.example" },
    ];
    expect(overlappingSites(gh("new", "org:acme is:issue"), others).map((s) => s.id)).toEqual(["work", "web"]);
    expect(overlappingSites(gh("new", "org:hedge-lang"), others)).toEqual([]);
  });
});
