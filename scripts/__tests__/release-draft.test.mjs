import { describe, expect, it } from "vitest";
import { draftFor } from "../release-draft.mjs";

const release = (id, tag_name, draft) => ({ id, tag_name, draft });

describe("draftFor", () => {
  it("is nothing when the tag has no release yet, so one is made", () => {
    expect(draftFor([release(1, "v0.7.0", false)], "v0.8.0")).toBeNull();
  });

  it("is the tag's draft, so a re-run uploads into it instead of making a second", () => {
    expect(draftFor([release(1, "v0.7.0", false), release(2, "v0.8.0", true)], "v0.8.0")).toBe(2);
  });

  it("refuses once the tag's release is published: users may already be updating from it", () => {
    expect(() => draftFor([release(2, "v0.8.0", false)], "v0.8.0")).toThrow("already published");
    expect(() => draftFor([release(2, "v0.8.0", true), release(3, "v0.8.0", false)], "v0.8.0")).toThrow("already published");
  });

  it("refuses when the tag has several drafts, rather than guess which one", () => {
    expect(() => draftFor([release(2, "v0.8.0", true), release(3, "v0.8.0", true)], "v0.8.0")).toThrow("2 draft releases");
  });
});
