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
