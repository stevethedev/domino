# Changesets

This directory holds [changesets](https://github.com/changesets/changesets): small markdown files that describe a change worth noting in the changelog, written at the same time as the change itself instead of reconstructed from commit history later.

## Adding a changeset

```sh
npm run changeset
```

It asks whether the change is a `patch`, `minor` or `major` bump, then prompts for a short summary. Domino is pre-1.0, so in practice `minor` means a new feature, `patch` a fix, and `major` goes unused until 1.0. It writes a new file in this directory; commit it alongside your change.

Not every change needs one. Skip it for internal refactors, test-only changes, or CI/tooling tweaks that a user of the app wouldn't notice.

## Releasing (automated)

`.github/workflows/changesets.yml` handles the rest; you shouldn't need to run version or tag commands by hand:

1. Merge PRs with changesets into `main` as normal.
2. The bot opens, and keeps updating, a **"Version Packages" PR**. It bumps the version in `package.json`, `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json` together (see `scripts/sync-version.mjs`) and updates `CHANGELOG.md`. Review it like any other PR.
3. Merging that PR runs the same workflow again, which tags the release commit (`scripts/tag-release.mjs`). The tag triggers `.github/workflows/release.yml`, which re-runs the Rust and TypeScript checks, then builds macOS, Linux and Windows installers and attaches them to a **draft** GitHub Release. Publish it by hand once you've checked the builds.

## Releasing (manual fallback)

If you need to do it locally instead:

```sh
GITHUB_TOKEN="$(gh auth token)" npm run release:version   # changeset version, then sync Cargo.toml / tauri.conf.json
git add -A && git commit -m "chore: version packages"
git tag "v$(node -p "require('./package.json').version")"
git push && git push --tags
```

The changelog plugin looks up each change's commit and author on GitHub, so it needs a token (CI provides one; locally `gh auth token` does). The script is `release:version` rather than `version` because npm runs a script named `version` as a hook of its own `npm version` command.
