import { describe, expect, it } from "vitest";
import { gitHubKeyFromPath, isTicketKey, normalizeKeyInput, parseGitHubKey, ticketUrl } from "../ticketKey";

const jira = {};
const github = { kind: "github" as const };

describe("ticket keys", () => {
  it("checks keys by the kind of site", () => {
    expect(isTicketKey(jira, "CORE-1")).toBe(true);
    expect(isTicketKey(jira, "acme/web#1")).toBe(false);
    expect(isTicketKey(github, "acme/web#1")).toBe(true);
    expect(isTicketKey(github, "CORE-1")).toBe(false);
  });

  it("follows GitHub's naming rules, like the Rust core", () => {
    expect(parseGitHubKey("a-b/x.y_z-1#42")).toEqual({ owner: "a-b", repo: "x.y_z-1", number: 42 });
    for (const bad of [
      "acme/web",
      "acme/web#0",
      "-acme/web#1",
      "acme-/web#1",
      "acme/..#1",
      "acme/.#1",
      "a/b/c#1",
      "acme/web#2147483648",
      "acme/we b#1",
    ]) {
      expect(parseGitHubKey(bad), bad).toBeNull();
    }
    expect(parseGitHubKey(`${"a".repeat(39)}/r#1`)).not.toBeNull();
    expect(parseGitHubKey(`${"a".repeat(40)}/r#1`)).toBeNull();
  });

  it("reads issue and pull request pages as keys", () => {
    expect(gitHubKeyFromPath("/acme/web/pull/42")).toBe("acme/web#42");
    expect(gitHubKeyFromPath("/acme/web/issues/7/")).toBe("acme/web#7");
    expect(gitHubKeyFromPath("/Acme/Web/pull/42")).toBe("acme/web#42"); // GitHub names are case-insensitive
    expect(gitHubKeyFromPath("/acme/web/blob/main/x")).toBeNull();
    expect(gitHubKeyFromPath("/acme/web/issues/0")).toBeNull();
  });

  it("normalizes typed keys: Jira upper-cased, GitHub URLs turned into keys", () => {
    expect(normalizeKeyInput(jira, " core-1 ")).toBe("CORE-1");
    expect(normalizeKeyInput(github, " Acme/Web#3 ")).toBe("acme/web#3");
    expect(normalizeKeyInput(github, "https://github.com/Acme/Web/issues/3")).toBe("acme/web#3");
    expect(normalizeKeyInput(github, "https://github.com/acme/web/pull/42#discussion")).toBe("acme/web#42");
  });

  it("links to each kind's ticket page", () => {
    expect(ticketUrl({ baseUrl: "https://acme.atlassian.net/" }, "CORE-1")).toBe("https://acme.atlassian.net/browse/CORE-1");
    expect(ticketUrl({ ...github, baseUrl: "https://github.com" }, "acme/web#42")).toBe("https://github.com/acme/web/issues/42");
  });
});
