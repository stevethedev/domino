#!/usr/bin/env node
// Prints a release's notes: its section of CHANGELOG.md, which `changeset version` writes.
// release.yml passes them to tauri-action as the release body; tag-release.mjs tags and
// dispatches the build itself, so changesets/action never creates a release with them.
// Usage: node scripts/release-notes.mjs v1.2.3
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The `## <version>` section of a changelog, without its heading; throws if missing or empty. */
export function releaseNotes(changelog, tagOrVersion) {
  const version = tagOrVersion.replace(/^v/, "");
  const lines = changelog.split("\n");
  const start = lines.findIndex((line) => line.trim() === `## ${version}`);
  if (start === -1) throw new Error(`CHANGELOG.md has no ${version} section`);
  const end = lines.findIndex((line, i) => i > start && line.startsWith("## "));
  const notes = lines
    .slice(start + 1, end === -1 ? undefined : end)
    .join("\n")
    .trim();
  if (notes === "") throw new Error(`CHANGELOG.md's ${version} section is empty`);
  return notes;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const tag = process.argv[2];
  if (!tag) throw new Error("Usage: node scripts/release-notes.mjs <tag>");
  const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
  console.log(releaseNotes(readFileSync(join(rootDir, "CHANGELOG.md"), "utf8"), tag));
}
