#!/usr/bin/env node
// Run as changesets/action's `publish` step: by the time this executes,
// the "Version Packages" PR (produced by `npm run release:version`, see
// package.json) has already been merged to main, so package.json's
// version is the new, released one. There's no npm package to publish —
// instead, tag that commit. Pushing the tag triggers
// .github/workflows/release.yml, which builds and uploads the
// cross-platform artifacts.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// semver.org's recommended pattern (https://semver.org/#is-there-a-suggested-regular-expression-regex-to-check-a-semver-string).
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

/** The release tag for a package.json version; throws unless it's semver. */
export function releaseTag(version) {
  if (typeof version !== "string" || !SEMVER.test(version)) {
    throw new Error(`package.json version ${JSON.stringify(version)} is not semver`);
  }
  return `v${version}`;
}

function git(...args) {
  return execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  }).trim();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  const tag = releaseTag(pkg.version);

  const existingTags = git("tag", "-l").split("\n");
  if (existingTags.includes(tag)) {
    console.log(`Tag ${tag} already exists — nothing to do.`);
    process.exit(0);
  }

  git("config", "user.name", "github-actions[bot]");
  git("config", "user.email", "github-actions[bot]@users.noreply.github.com");
  git("tag", tag);
  git("push", "origin", tag);

  // GitHub Actions doesn't let a GITHUB_TOKEN-authored push trigger other
  // workflows (loop prevention), so the tag push above won't fire release.yml's
  // `push: tags:` trigger. Dispatch it directly via the API instead — that's
  // exempt from the restriction since it's an explicit API call, not an event
  // caused by the push.
  const repository = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  if (!repository || !token) {
    throw new Error("GITHUB_REPOSITORY and GITHUB_TOKEN must be set to dispatch release.yml.");
  }

  const response = await fetch(`https://api.github.com/repos/${repository}/actions/workflows/release.yml/dispatches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ref: tag, inputs: { tag } }),
  });

  if (!response.ok) {
    throw new Error(`Failed to dispatch release.yml: ${response.status} ${await response.text()}`);
  }

  console.log(`Tagged and pushed ${tag}, and dispatched release.yml to build and draft the release.`);
}
