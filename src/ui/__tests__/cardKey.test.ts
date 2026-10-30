import { describe, expect, it } from "vitest";
import { keyParts } from "../IssueCard";

describe("keyParts", () => {
  it("splits a GitHub key so the repository can shorten and the number stays", () => {
    expect(keyParts("stevethedev/domino-desktop#1234")).toEqual({ repo: "stevethedev/domino-desktop", number: "#1234" });
  });

  it("leaves Jira keys and anything else whole", () => {
    expect(keyParts("CORE-12")).toBeNull();
    expect(keyParts("not a key#1")).toBeNull();
  });
});
