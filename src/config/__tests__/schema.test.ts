import { describe, expect, it } from "vitest";
import { siteSchema } from "../schema";

const site = (secretRef: string): unknown => ({
  id: "acme",
  label: "Acme",
  baseUrl: "https://acme.atlassian.net",
  auth: { type: "apiToken", email: "bot@acme.example", secretRef },
  color: "#7c3aed",
  enabled: true,
});

describe("siteSchema", () => {
  it("accepts a token reference", () => {
    expect(siteSchema.safeParse(site("DOMINO_ACME_TOKEN")).success).toBe(true);
  });

  it("rejects the name the app keeps its cache key under", () => {
    const res = siteSchema.safeParse(site("DOMINO_CACHE_KEY"));
    expect(res.success).toBe(false);
    expect(res.error?.issues[0]?.message).toMatch(/reserved/);
  });
});

describe("siteSchema site kinds", () => {
  const gh = (extra: Record<string, unknown> = {}): unknown => ({
    id: "gh",
    kind: "github",
    label: "GitHub",
    baseUrl: "https://github.com",
    auth: { type: "githubToken", secretRef: "DOMINO_GITHUB_TOKEN" },
    color: "#24292f",
    enabled: true,
    ...extra,
  });

  it("accepts a GitHub site with a GitHub token", () => {
    expect(siteSchema.safeParse(gh()).success).toBe(true);
  });

  it("puts a kind and sign-in mismatch on the sign-in field", () => {
    const wrongAuth = siteSchema.safeParse(gh({ auth: { type: "oauth3lo" } }));
    expect(wrongAuth.error?.issues).toMatchObject([{ path: ["auth", "type"], message: "A GitHub site needs a GitHub token" }]);
    const jiraWithGitHubToken = siteSchema.safeParse(gh({ kind: undefined }));
    expect(jiraWithGitHubToken.error?.issues[0]?.message).toBe("GitHub tokens are for GitHub sites");
  });

  it("checks a GitHub token's reference like any other", () => {
    expect(siteSchema.safeParse(gh({ auth: { type: "githubToken", secretRef: "DOMINO_CACHE_KEY" } })).success).toBe(false);
  });
});
