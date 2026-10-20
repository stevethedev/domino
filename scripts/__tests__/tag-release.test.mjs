import { describe, expect, it } from "vitest";
import { releaseTag } from "../tag-release.mjs";

describe("releaseTag", () => {
  it("is the version with a v prefix", () => {
    expect(releaseTag("0.4.0")).toBe("v0.4.0");
    expect(releaseTag("1.2.3-rc.1")).toBe("v1.2.3-rc.1");
  });

  it("rejects anything but plain semver, since the tag reaches git and the Actions API", () => {
    for (const version of ["1.0.0; curl x", "1.0.0 --force", "v1.0.0", "1.0", "", undefined]) {
      expect(() => releaseTag(version)).toThrow("not semver");
    }
  });
});
