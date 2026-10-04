#!/usr/bin/env node
// Keeps src-tauri/Cargo.toml, src-tauri/tauri.conf.json, and package-lock.json in lockstep with
// package.json's version, which `changeset version` is the sole writer of.
// Run automatically as part of `npm run release:version` (see package.json).
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));

const pkg = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8"));
const version = pkg.version;

// tauri.conf.json — replace just the top-level version string, so the file keeps its
// Prettier formatting (re-serializing it would reflow arrays and fail `npm run check`).
const tauriConfPath = join(rootDir, "src-tauri/tauri.conf.json");
const tauriConfText = readFileSync(tauriConfPath, "utf8");
const tauriVersionPattern = /^(  "version": ")[^"]*(")/m;
if (!tauriVersionPattern.test(tauriConfText)) {
  throw new Error("Failed to update version in src-tauri/tauri.conf.json — pattern did not match.");
}
const updatedTauriConf = tauriConfText.replace(tauriVersionPattern, `$1${version}$2`);
if (JSON.parse(updatedTauriConf).version !== version) {
  throw new Error('Updated the wrong "version" in src-tauri/tauri.conf.json.');
}
writeFileSync(tauriConfPath, updatedTauriConf);

// Cargo.toml — only the [package] table's version, not any dependency
// version that happens to share the same string.
const cargoTomlPath = join(rootDir, "src-tauri/Cargo.toml");
const cargoToml = readFileSync(cargoTomlPath, "utf8");
const packageVersionPattern = /(\[package\][^[]*?\nversion = ")[^"]*(")/;
if (!packageVersionPattern.test(cargoToml)) {
  throw new Error("Failed to update version in src-tauri/Cargo.toml — pattern did not match.");
}
const updatedCargoToml = cargoToml.replace(packageVersionPattern, `$1${version}$2`);
writeFileSync(cargoTomlPath, updatedCargoToml);

// package-lock.json — set only the root project's two version fields. npm writes the
// lockfile as JSON.stringify(_, null, 2) + "\n", so re-serializing is byte-identical
// apart from the bump; `npm install` here would also churn dependency resolutions.
const lockPath = join(rootDir, "package-lock.json");
const lock = JSON.parse(readFileSync(lockPath, "utf8"));
const rootPackage = lock.packages?.[""];
if (!rootPackage) {
  throw new Error('Failed to update version in package-lock.json — no packages[""] entry.');
}
lock.version = version;
rootPackage.version = version;
writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);

console.log(`Synced version ${version} to tauri.conf.json, Cargo.toml, and package-lock.json`);

// Refresh Cargo.lock's entry for this package so it isn't left stale.
try {
  execSync("cargo check --quiet", {
    cwd: join(rootDir, "src-tauri"),
    stdio: "inherit",
  });
} catch {
  console.warn("Warning: could not run `cargo check` to refresh Cargo.lock — run it manually before committing.");
}
