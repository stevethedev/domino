import { describe, expect, it } from "vitest";
import { applyUrl, draftChanged, parseJiraUrl, uniqueId } from "../siteDraft";
import type { SiteConfig } from "../types";

describe("parseJiraUrl", () => {
  it.each([
    ["acme.atlassian.net", "https://acme.atlassian.net"],
    ["https://acme.atlassian.net/", "https://acme.atlassian.net"],
    ["https://ACME.atlassian.net/browse/CORE-7", "https://acme.atlassian.net"],
    ["https://acme.atlassian.net/jira/software/projects/CORE/boards/1?x=1#y", "https://acme.atlassian.net"],
    ["https://jira.example.com:8443/secure/Dashboard.jspa", "https://jira.example.com:8443"],
  ])("%s -> %s", (input, origin) => {
    expect(parseJiraUrl(input)?.origin).toBe(origin);
  });

  it("derives a friendly label and slug", () => {
    expect(parseJiraUrl("https://partner-x.atlassian.net")).toMatchObject({ suggestedId: "partner-x", suggestedLabel: "Partner X" });
  });

  it.each(["", "http://acme.atlassian.net", "localhost", "https://user:pw@acme.atlassian.net", "not a url at all"])(
    "rejects %j",
    (input) => {
      expect(parseJiraUrl(input)).toBeNull();
    },
  );
});

describe("uniqueId", () => {
  it("adds a numeric suffix when taken", () => {
    expect(uniqueId("acme", ["acme", "acme-2"])).toBe("acme-3");
    expect(uniqueId("beta", ["acme"])).toBe("beta");
  });
});

describe("applyUrl", () => {
  const blank: SiteConfig = {
    id: "",
    label: "",
    baseUrl: "",
    auth: { type: "apiToken", email: "", secretRef: "" },
    color: "#123456",
    enabled: true,
  };

  it("fills id, label and secret name from the URL", () => {
    const { draft } = applyUrl(blank, "https://beta.atlassian.net/browse/X-1", ["acme"], { id: "", label: "" });
    expect(draft).toMatchObject({ id: "beta", label: "Beta", auth: { secretRef: "DOMINO_BETA_TOKEN" } });
    expect(draft.baseUrl).toBe("https://beta.atlassian.net/browse/X-1"); // normalized on submit, not while typing
  });

  it("keeps values the user customized", () => {
    const first = applyUrl(blank, "beta.atlassian.net", [], { id: "", label: "" });
    const edited = { ...first.draft, label: "Beta Corp" };
    const { draft } = applyUrl(edited, "gamma.atlassian.net", [], first.auto);
    expect(draft).toMatchObject({ id: "gamma", label: "Beta Corp", auth: { secretRef: "DOMINO_GAMMA_TOKEN" } });
  });
});

describe("draftChanged", () => {
  const initial: SiteConfig = {
    id: "acme",
    label: "Acme",
    baseUrl: "https://acme.atlassian.net",
    auth: { type: "oauth3lo" },
    color: "#7c3aed",
    enabled: true,
  };
  const base = { initial, draft: initial, initialDefault: true, isDefault: true, token: "" };

  it("is false until something is edited", () => {
    expect(draftChanged(base)).toBe(false);
    expect(draftChanged({ ...base, draft: { ...initial } })).toBe(false);
  });

  it("notices fields, the default switch and a pasted token", () => {
    expect(draftChanged({ ...base, draft: { ...initial, label: "Acme Co" } })).toBe(true);
    expect(draftChanged({ ...base, isDefault: false })).toBe(true);
    expect(draftChanged({ ...base, token: "secret" })).toBe(true);
  });
});
