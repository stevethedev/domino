#!/usr/bin/env node
// Keeps src-tauri/Cargo.toml and src-tauri/tauri.conf.json in lockstep with
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

console.log(`Synced version ${version} to tauri.conf.json and Cargo.toml`);

// Refresh Cargo.lock's entry for this package so it isn't left stale.
try {
  execSync("cargo check --quiet", {
    cwd: join(rootDir, "src-tauri"),
    stdio: "inherit",
  });
} catch {
  console.warn("Warning: could not run `cargo check` to refresh Cargo.lock — run it manually before committing.");
}
