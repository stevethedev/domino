import { describe, expect, it } from "vitest";
import { releaseProblems } from "../release-check.mjs";

const asset = (name) => ({ name, url: `https://api.github.com/repos/o/r/releases/assets/${name}` });
const files = ["app.tar.gz", "app.AppImage", "setup.msi"];
const release = (overrides = {}) => ({
  tag_name: "v0.8.0",
  draft: true,
  assets: [...files, ...files.map((f) => `${f}.sig`), "latest.json"].map(asset),
  ...overrides,
});
const entry = (file) => ({ url: asset(file).url, signature: `sig of ${file}` });
const manifest = (overrides = {}) => ({
  version: "0.8.0",
  platforms: { "darwin-universal": entry("app.tar.gz"), "linux-x86_64": entry("app.AppImage"), "windows-x86_64": entry("setup.msi") },
  ...overrides,
});
const signatures = new Map(files.map((f) => [`${f}.sig`, `sig of ${f}\n`]));
const platforms = ["darwin-universal", "linux-x86_64", "windows-x86_64"];

describe("releaseProblems", () => {
  it("is nothing for a draft whose latest.json covers every platform with its own files", () => {
    expect(releaseProblems(release(), manifest(), signatures, platforms)).toEqual([]);
  });

  it("flags a release published before every build had uploaded", () => {
    expect(releaseProblems(release({ draft: false }), manifest(), signatures, platforms)).toEqual([
      "the release was published before every build had uploaded",
    ]);
  });

  it("flags a platform latest.json doesn't list, which that platform's users would never be offered", () => {
    const { "windows-x86_64": _, ...rest } = manifest().platforms;
    expect(releaseProblems(release(), manifest({ platforms: rest }), signatures, platforms)).toEqual([
      "latest.json has no windows-x86_64 entry",
    ]);
  });

  it("flags a missing latest.json", () => {
    expect(releaseProblems(release(), null, signatures, platforms)).toEqual(["the release has no latest.json"]);
  });

  it("flags a latest.json for another version", () => {
    expect(releaseProblems(release(), manifest({ version: "0.7.0" }), signatures, platforms)).toEqual([
      "latest.json is for 0.7.0, not 0.8.0",
    ]);
  });

  it("takes an entry's browser download link as well as its API link", () => {
    const withLinks = release({
      assets: release().assets.map((a) => ({ ...a, browser_download_url: `https://github.com/o/r/releases/download/v0.8.0/${a.name}` })),
    });
    const byLink = { url: "https://github.com/o/r/releases/download/v0.8.0/setup.msi", signature: "sig of setup.msi" };
    expect(
      releaseProblems(withLinks, manifest({ platforms: { ...manifest().platforms, "windows-x86_64": byLink } }), signatures, platforms),
    ).toEqual([]);
  });

  it("flags an entry pointing at a file that isn't on this release, like another release's upload", () => {
    const elsewhere = { url: "https://api.github.com/repos/o/r/releases/assets/999", signature: "x" };
    const problems = releaseProblems(
      release(),
      manifest({ platforms: { ...manifest().platforms, "linux-x86_64": elsewhere } }),
      signatures,
      platforms,
    );
    expect(problems).toEqual(["latest.json's linux-x86_64 points at a file that isn't on this release"]);
  });

  it("flags an entry whose signature isn't the one uploaded beside its file", () => {
    const tampered = { ...entry("setup.msi"), signature: "something else" };
    const problems = releaseProblems(
      release(),
      manifest({ platforms: { ...manifest().platforms, "windows-x86_64": tampered } }),
      signatures,
      platforms,
    );
    expect(problems).toEqual(["latest.json's windows-x86_64 signature doesn't match setup.msi.sig"]);
  });
});
