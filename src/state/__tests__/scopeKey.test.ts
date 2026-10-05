import { describe, expect, it } from "vitest";
import type { DominoConfig, SiteConfig } from "../../config/types";
import type { Scope } from "../../data/MultiSiteLoader";
import { loadKeyOf, scopeKeyOf } from "../scopeKey";

const site = (id: string, extra: Partial<SiteConfig> = {}): SiteConfig => ({
  id,
  label: id.toUpperCase(),
  baseUrl: `https://${id}.atlassian.net`,
  auth: { type: "apiToken", email: "bot@example.com", secretRef: "DOMINO_TOKEN" },
  color: "#123456",
  enabled: true,
  ...extra,
});

describe("scopeKeyOf", () => {
  it("keeps the format that stored scope keys (Since you last looked) use", () => {
    expect(scopeKeyOf([site("b"), site("a")], { mode: "jql", jql: "project = X" })).toBe(
      '{"sites":["a","b"],"scope":{"mode":"jql","jql":"project = X"}}',
    );
    expect(scopeKeyOf([site("a")], { mode: "seed", siteId: "a", key: "A-1", depth: 2 })).toBe(
      '{"sites":["a"],"scope":{"mode":"seed","siteId":"a","key":"A-1","depth":2}}',
    );
  });

  it("is the same however the scope object was built", () => {
    const reordered = JSON.parse('{"key":"A-1","siteId":"a","mode":"epic"}') as Scope;
    expect(scopeKeyOf([site("a")], reordered)).toBe(scopeKeyOf([site("a")], { mode: "epic", siteId: "a", key: "A-1" }));
  });
});

describe("loadKeyOf", () => {
  const scope: Scope = { mode: "jql", jql: "project = X" };
  const config: DominoConfig = { sites: [site("a"), site("b")], defaultSiteIds: ["a"], backend: "jira" };
  const key = loadKeyOf(config, [site("a")], scope);

  it("ignores labels, colours and default selections", () => {
    const cosmetic: DominoConfig = { ...config, sites: [site("a", { label: "Renamed", color: "#000" }), site("b")], defaultSiteIds: [] };
    expect(loadKeyOf(cosmetic, [site("a", { label: "Renamed", color: "#000" })], scope)).toBe(key);
  });

  it("changes with the scope, backend, a selected site's address, account, filter or cloud id, or any site's address", () => {
    const changed = [
      loadKeyOf(config, [site("a")], { mode: "jql", jql: "project = Y" }),
      loadKeyOf({ ...config, backend: "mock" }, [site("a")], scope),
      loadKeyOf(config, [site("a", { baseUrl: "https://other.atlassian.net" })], scope),
      loadKeyOf(config, [site("a", { auth: { type: "oauth3lo" } })], scope),
      loadKeyOf(config, [site("a", { baseJql: "project = Z" })], scope),
      loadKeyOf(config, [site("a", { cloudId: "c-1" })], scope),
      loadKeyOf({ ...config, sites: [site("a"), site("b", { baseUrl: "https://moved.atlassian.net" })] }, [site("a")], scope),
    ];
    for (const k of changed) expect(k).not.toBe(key);
  });
});
