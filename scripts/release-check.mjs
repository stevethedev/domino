#!/usr/bin/env node
// Checks a release once every build has uploaded: still a draft, and its latest.json offers the
// update on every platform with this release's own files. Each build merges its platforms into
// latest.json by downloading and re-uploading it, so two finishing together can drop one's entries.
// Usage: GITHUB_REPOSITORY=owner/repo GITHUB_TOKEN=... node scripts/release-check.mjs <release id>
import { fileURLToPath } from "node:url";
import { github } from "./release-draft.mjs";

/** The latest.json entries the app's updater looks up, one per platform release.yml builds. */
export const PLATFORMS = ["darwin-aarch64", "darwin-x86_64", "linux-x86_64", "windows-x86_64"];

/**
 * What's wrong with a release, as sentences; empty when it's ready to publish. `signatures` maps each
 * uploaded `.sig` file's name to its contents.
 */
export function releaseProblems(release, manifest, signatures, platforms = PLATFORMS) {
  const problems = [];
  if (!release.draft) problems.push("the release was published before every build had uploaded");
  if (manifest === null) return [...problems, "the release has no latest.json"];

  const version = release.tag_name.replace(/^v/, "");
  if (manifest.version !== version) problems.push(`latest.json is for ${manifest.version}, not ${version}`);
  // The app shows these as the update's "What's new".
  if (!manifest.notes?.trim()) problems.push("latest.json has no release notes");

  // latest.json links a file by its API URL or its browser download link, depending on tagName.
  const byUrl = new Map(
    release.assets.flatMap((a) => [[a.url, a.name], ...(a.browser_download_url ? [[a.browser_download_url, a.name]] : [])]),
  );
  for (const platform of platforms) {
    if (!(platform in manifest.platforms)) problems.push(`latest.json has no ${platform} entry`);
  }
  for (const [platform, { url, signature }] of Object.entries(manifest.platforms)) {
    const file = byUrl.get(url);
    if (file === undefined) {
      problems.push(`latest.json's ${platform} points at a file that isn't on this release`);
    } else if (signatures.get(`${file}.sig`)?.trim() !== signature.trim()) {
      problems.push(`latest.json's ${platform} signature doesn't match ${file}.sig`);
    }
  }
  return problems;
}

/** An uploaded file's contents, as text. */
async function assetText(url) {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: "application/octet-stream" },
  });
  if (!response.ok) throw new Error(`GET ${url}: ${response.status}`);
  return response.text();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const id = process.argv[2];
  const repository = process.env.GITHUB_REPOSITORY;
  if (!id || !repository) throw new Error("Usage: GITHUB_REPOSITORY=owner/repo node scripts/release-check.mjs <release id>");

  const release = await github(`/repos/${repository}/releases/${id}`);
  const manifestAsset = release.assets.find((a) => a.name === "latest.json");
  const manifest = manifestAsset ? JSON.parse(await assetText(manifestAsset.url)) : null;
  const sigs = release.assets.filter((a) => a.name.endsWith(".sig"));
  const signatures = new Map(await Promise.all(sigs.map(async (a) => [a.name, await assetText(a.url)])));

  const problems = releaseProblems(release, manifest, signatures);
  for (const problem of problems) console.log(`::error title=Release ${release.tag_name} isn't ready::${problem}`);
  if (problems.length > 0) process.exit(1);
  console.log(`${release.tag_name} is ready to publish: ${Object.keys(manifest.platforms).length} platforms in latest.json.`);
}
