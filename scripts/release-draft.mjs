#!/usr/bin/env node
// Prints the id of the draft release a tag's builds upload to, making the draft if there isn't one.
// release.yml runs this once, before its builds, and hands them the id: left to find the release by
// tag, each build makes its own draft when it can't see one, and splits the release in two.
// Usage: GITHUB_REPOSITORY=owner/repo GITHUB_TOKEN=... node scripts/release-draft.mjs v1.2.3
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { releaseNotes } from "./release-notes.mjs";

/**
 * The id of the tag's draft release, or null when it has none yet. Throws once the tag's release is
 * published (its users may already be updating from it), or when there's more than one draft.
 */
export function draftFor(releases, tag) {
  const forTag = releases.filter((r) => r.tag_name === tag);
  if (forTag.some((r) => !r.draft)) throw new Error(`${tag}'s release is already published; delete it, or release a new version`);
  if (forTag.length > 1) throw new Error(`${tag} has ${forTag.length} draft releases; delete all but one`);
  return forTag.at(0)?.id ?? null;
}

/** Calls the GitHub REST API as the workflow; throws with GitHub's response on failure. */
export async function github(path, { method = "GET", body } = {}) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN must be set");
  const response = await fetch(`https://api.github.com${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${await response.text()}`);
  return response.json();
}

/** Every release in the repository, drafts included (the by-tag endpoint can't see drafts). */
async function allReleases(repository) {
  const releases = [];
  for (let page = 1; ; page += 1) {
    const batch = await github(`/repos/${repository}/releases?per_page=100&page=${page}`);
    releases.push(...batch);
    if (batch.length < 100) return releases;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const tag = process.argv[2];
  const repository = process.env.GITHUB_REPOSITORY;
  if (!tag || !repository) throw new Error("Usage: GITHUB_REPOSITORY=owner/repo node scripts/release-draft.mjs <tag>");

  const existing = draftFor(await allReleases(repository), tag);
  if (existing !== null) {
    console.error(`Uploading into ${tag}'s existing draft release.`);
    console.log(existing);
  } else {
    const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
    const body = releaseNotes(readFileSync(join(rootDir, "CHANGELOG.md"), "utf8"), tag);
    const created = await github(`/repos/${repository}/releases`, {
      method: "POST",
      body: { tag_name: tag, name: `Domino ${tag}`, body, draft: true, prerelease: false },
    });
    console.error(`Made ${tag}'s draft release.`);
    console.log(created.id);
  }
}
