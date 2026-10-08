import { describe, expect, it } from "vitest";
import { releaseNotes } from "../release-notes.mjs";

const changelog = `# domino

## 0.4.0

### Minor Changes

- New thing.

### Patch Changes

- Fixed thing.

## 0.3.0

- Older thing.
`;

describe("releaseNotes", () => {
  it("is the version's CHANGELOG section, without its heading", () => {
    expect(releaseNotes(changelog, "0.4.0")).toBe("### Minor Changes\n\n- New thing.\n\n### Patch Changes\n\n- Fixed thing.");
  });

  it("takes the tag as well as the version", () => {
    expect(releaseNotes(changelog, "v0.3.0")).toBe("- Older thing.");
  });

  it("never matches a version that only starts the same", () => {
    expect(() => releaseNotes("## 0.4.10\n\n- Later.\n", "0.4.1")).toThrow("0.4.1");
  });

  it("fails when the version has no section, rather than release without notes", () => {
    expect(() => releaseNotes(changelog, "0.5.0")).toThrow("no 0.5.0 section");
    expect(() => releaseNotes("## 0.5.0\n\n## 0.4.0\n- x\n", "0.5.0")).toThrow("empty");
  });
});
