# Changesets

A changeset is a short note committed with a change; it becomes that change's changelog entry.

```sh
npm run changeset
```

Pick the bump and write a summary. Domino's pre-1.0, so `minor` is a feature and `patch` a fix. Skip it for refactors, tests or tooling users won't notice.

## Releasing

1. Merge changes with changesets into `main`.
2. The bot opens a "Version Packages" PR that bumps `package.json`, `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json` together (`scripts/sync-version.mjs`) and updates `CHANGELOG.md`.
3. Merging it tags the release (`scripts/tag-release.mjs`), and `.github/workflows/release.yml` re-runs the checks and builds signed installers into a **draft** GitHub release.
4. Publish the draft once the builds look right.

The bot needs **Settings &rarr; Actions &rarr; Allow GitHub Actions to create and approve pull requests** turned on.

By hand:

```sh
GITHUB_TOKEN="$(gh auth token)" npm run release:version
git add -A && git commit -m "chore: version packages"
git tag "v$(node -p "require('./package.json').version")"
git push && git push --tags
```

The changelog looks up commits on GitHub, so it needs a token.
