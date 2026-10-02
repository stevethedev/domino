# Domino

Domino shows Jira issues as cards in a left-to-right flowchart. Arrows come from issue links, so you can see at a glance what blocks what. It can connect to several Jira sites at once, including links between sites.

Domino is a **Tauri 2 desktop app**. The React UI never sees credentials. All config, secrets and Jira calls go through the Rust core over Tauri IPC.

```
React UI  ──invoke()──▶  Rust core (src-tauri)  ──▶  JiraBackend
(graph, layout, UI)       config · keychain           MockBackend (Phase 1)
                                                      HttpBackend (Phase 2, Jira REST v3)
```

## Running

Requires Node 20+ and a Rust toolchain (`rustup`). On Linux you also need Tauri's system packages (webkit2gtk and friends).

| Command                      | What it does                                                                                                                                      |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm install`                | Installs JS deps                                                                                                                                  |
| `npm run dev`                | Opens the desktop app (`tauri dev`). Mock data by default; switch to live Jira in Settings                                                        |
| `npm run dev:web`            | Browser preview at http://localhost:1420. Answers IPC from fixtures via `@tauri-apps/api/mocks`. For UI checks and Playwright only; never shipped |
| `npm test`                   | Vitest (graph logic, loader, layout)                                                                                                              |
| `cd src-tauri && cargo test` | Rust tests (config, mock backend, HTTP backend and OAuth against wiremock)                                                                        |
| `npm run tauri build`        | Release build and installer                                                                                                                       |

### Simulating a failing site

- Desktop: `DOMINO_MOCK_FAIL_SITES=partner npm run dev`
- Browser: http://localhost:1420/?failSite=partner
- Or add a site in Settings. Any site without fixture data fails with "Could not connect".

The mock backends evaluate a small JQL subset: `project`, `key`, `parent`, `statusCategory` and `issueLinkType` with `=`, `!=`, `in` and `not in`, joined by AND. `updated`, `created`, `sprint`, `assignee` and `reporter` are accepted but ignored, because the fixtures have no such data.

The failing site's error appears in a banner and the other sites still render. Issues on the failed site that other issues link to show up as ghosts.

## `domino.config.json`

The app keeps its config in the OS app-config directory:

| OS      | Path                                                                 |
| ------- | -------------------------------------------------------------------- |
| macOS   | `~/Library/Application Support/org.change.domino/domino.config.json` |
| Windows | `%APPDATA%\org.change.domino\domino.config.json`                     |
| Linux   | `~/.config/org.change.domino/domino.config.json`                     |

On first run it is seeded from `fixtures/mock/config.json`. Settings (⚙) edits it through the `save_config` command, which validates the file and writes it atomically (temp file + rename). You can also edit it by hand while the app is closed.

```jsonc
{
  "sites": [
    {
      "id": "acme", // unique slug, used in uids ("acme:CORE-7")
      "label": "Acme", // shown in the UI
      "baseUrl": "https://acme.atlassian.net",
      "cloudId": "…", // optional; filled in automatically (Phase 2, OAuth)
      "auth": { "type": "apiToken", "email": "bot@acme.example", "secretRef": "DOMINO_ACME_TOKEN" },
      "color": "#7c3aed", // site badge / swimlane / minimap tint
      "enabled": true,
      "baseJql": "project in (CORE, WEB)", // "Always filter by": ANDed onto every search on this site
    },
    {
      "id": "partner",
      "label": "Partner",
      "baseUrl": "https://partner.atlassian.net",
      "auth": { "type": "oauth3lo" },
      "color": "#c2410c",
      "enabled": true,
    },
  ],
  "defaultSiteIds": ["acme", "partner"],
  "backend": "mock", // "mock" (fixtures) or "jira" (live REST v3); default "mock"
}
```

Anyone using the app can change its config. It is a single-user desktop app, so there is no admin role.

## Secrets

The config never holds a secret. `secretRef` only names one.

- **API token auth:** the token is stored in the **OS keychain** (service `domino`, account = `secretRef`). Paste it into Settings → Edit site → _API token_. The field is write-only: the value goes straight to Rust and is never read back into the UI.
- **Environment override (development/CI):** if an env var named after the `secretRef` exists (e.g. `DOMINO_ACME_TOKEN=…`), it takes precedence over the keychain. GUI apps on macOS don't inherit your shell's environment, so launch with `npm run dev` from that shell.
- Tokens are never logged or returned to the webview.

| Auth type  | What you need                                                                                                            |
| ---------- | ------------------------------------------------------------------------------------------------------------------------ |
| `apiToken` | `email` + an [Atlassian API token](https://id.atlassian.com/manage-profile/security/api-tokens) stored under `secretRef` |
| `oauth3lo` | An OAuth 2.0 (3LO) app (see below). Client id/secret and refresh tokens are kept in the keychain                         |

Keychain entries Domino uses (each can be overridden by an env var of the same name):

| Entry                                                   | Holds                                                                                     |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| _your `secretRef`_, e.g. `DOMINO_ACME_TOKEN`            | API token for an `apiToken` site                                                          |
| `DOMINO_OAUTH_CLIENT_ID` / `DOMINO_OAUTH_CLIENT_SECRET` | OAuth app credentials                                                                     |
| `DOMINO_OAUTH_REFRESH_TOKEN`                            | Refresh token from **Connect** (rotated on every refresh; set only by Connect/Disconnect) |

## OAuth 2.0 (3LO) app setup

1. Go to https://developer.atlassian.com/console/myapps/ → **Create → OAuth 2.0 integration**.
2. **Permissions → Jira API:** add the scopes `read:jira-work`, `read:jira-user` and `offline_access` (needed for refresh tokens).
3. **Authorization → Callback URL:** `http://127.0.0.1:53682/callback`.
4. Copy the **Client ID** and **Secret** into Domino Settings → _Data source_ → _OAuth 2.0 (3LO) app_ and click **Save app credentials**. They are stored in the keychain (`DOMINO_OAUTH_CLIENT_ID` / `DOMINO_OAUTH_CLIENT_SECRET`, which env vars can also override).
5. Click **Connect with Atlassian**. One sign-in covers every site your account can access. Domino opens the system browser to Atlassian's consent page and listens once on the loopback port, checking `state`. It exchanges the code, stores the refresh token in the keychain, and discovers the site's `cloudId` via `https://api.atlassian.com/oauth/token/accessible-resources` (matched on `baseUrl`). Requests then go to `https://api.atlassian.com/ex/jira/{cloudId}/rest/api/3/...`.

A desktop app can't truly keep a client secret. Anyone with the binary and keychain access could extract it, which is why it's entered per user rather than compiled in.

## Switching from mock data to real Jira

1. Settings (⚙) → **Data source → Live Jira**. This saves `"backend": "jira"` and reloads the graph.
2. Point your sites at real base URLs, then set credentials: paste an API token on each `apiToken` site, or configure the OAuth app and **Connect**.
3. Use **Test** on each site. It calls `GET /rest/api/3/myself`.

The UI doesn't change. It always talks to Rust through `TauriSource` (`src/data/TauriSource.ts`) and `TauriConfigStore`. On every call, Rust picks `MockBackend` or `HttpBackend` (`src-tauri/src/jira/`) from `config.backend`. Both return raw Jira-shaped JSON through the same commands (`fetch_by_jql`, `fetch_epic`, `fetch_issue`, `fetch_remote_links`, `fetch_link_types`, `site_health`).

What `HttpBackend` does:

- **API token:** Basic auth (`email:token`) against the site's base URL.
- **OAuth 3LO:** Bearer auth against `https://api.atlassian.com/ex/jira/{cloudId}/…`. A missing `cloudId` is discovered via `accessible-resources` (matched on `baseUrl`) and written back to `domino.config.json`.
- **Search:** `POST /rest/api/3/search/jql` paged with `nextPageToken`, 100 per page. It requests only `summary, issuetype, status, assignee, customfield_10016, parent, issuelinks`, and stops at the node cap.
- **Epic:** `GET /issue/{key}` plus `parent = KEY`.
- **Remote links:** `GET /issue/{key}/remotelink`.
- **Link types:** `GET /issueLinkType`.
- **Retries:** 429/503 are retried up to 3 times, honoring `Retry-After` (capped at 30 s).
- **Errors:** messages include Jira's `errorMessages` plus a hint for 401/403, and never include credentials. Issue keys are validated before they're put in a URL.
- **Story points** are read from `customfield_10016` ("Story point estimate" on Jira Cloud). If your site uses a different field, change `FIELDS` in `src-tauri/src/jira/http.rs` and `nodeFromIssue` in `src/graph/buildGraph.ts`.

## How the graph is built

- **Identity:** every node is `uid = ${siteId}:${key}`, so `CORE-7` on two sites is two nodes.
- **Links:** Jira stores each link on both issues. Domino converts each to the outward direction (blocker → blocked) and dedupes by `siteId + linkId`.
- **Cross-site links:** remote links whose URL is `{baseUrl}/browse/{KEY}` for a configured site become edges (marked ⇄). The `relationship` text is matched against link-type outward and inward names ("is blocked by" flips direction); unknown text becomes _relates to_. Reciprocal remote links collapse into one edge on (source, target, type). Jira URLs on sites that aren't configured become ghosts labeled with the host. Other URLs are ignored.
- **Ghosts:** linked issues outside the loaded scope render dimmed and dashed, with an "Outside scope" label. Their own links aren't loaded. Ghosts with unknown status count as open blockers.
- **Scope: two layers of JQL.**
  1. **Site filter** ("Always filter by", `baseJql` in `domino.config.json`) is part of the connection. It is ANDed onto _every_ search Domino runs on that site: JQL mode, epic children, and linked issues fetched in Epic and Seed modes. Linked issues it excludes still appear as ghosts. The epic or seed issue you ask for directly always loads. Older configs named this `defaultJql`, and they're still read.
  2. **Query** (the top-bar box) is per view and applies to every selected site. It's remembered on this machine between launches. **Presets…** fills it with one click: _Open with blocking links (30 days)_ (the starting query: `statusCategory != Done AND issueLinkType in (blocks, "is blocked by") AND updated >= -30d`), _Open, updated in 14 days_, _Open in current sprint_, _Assigned to me, not done_, or empty (everything the site filter allows). Presets live in `src/data/jqlPresets.ts`.

  Each site runs `(site filter) AND (query)`. Hover the query box to see the exact JQL per site. `issueLinkType` only sees native links, so an issue linked only through remote (cross-site) links drops out of the blocking-links preset, although it still appears as a ghost when a loaded issue links to it.

- **Cap:** more than 300 nodes, ghosts included, stops the load and asks you to narrow the scope.
- **Cycles:** found with Tarjan's SCC algorithm, drawn in red, listed under Warnings (right below At a glance whenever there are any). A DFS back edge in each cycle is left out of layout and critical path, and drawn as a loop underneath.
- **Layout:** ELK layered, left to right, using only blocks edges, so blockers always sit left of what they block.
- **Group by** (None / Site / Epic / Assignee) draws labeled swimlanes and keeps ELK's global x order. Separate ELK containers can't keep that order when groups block each other in both directions.
  - _Site:_ one lane per site. Ghosts on unconfigured Jira sites get a lane named after the host.
  - _Epic:_ one lane per epic. The lane header opens the epic in Jira.
    - An issue's epic is its `parent` when that parent is an epic (`hierarchyLevel` 1, or type "Epic"). An epic sits in its own lane.
    - Sub-tasks inherit their story's epic when the story is loaded.
    - Older company-managed projects fall back to the legacy "Epic Link" field (`customfield_10014`).
    - Issues without an epic go in a _No epic_ lane, and ghosts in _Outside scope_. Both lanes come last.
    - Epic keys are site-qualified, so the same key on two sites is two lanes.

## Finding your way around

- **At a glance** (top of the sidebar): counts of **Blocked**, **Ready**, **Critical path** and **Aging** for the loaded scope. Click a count to highlight those issues in either view; click it again to clear. The insights are computed once per load in `src/graph/insights.ts`.
- **Everyone / Assigned / Reported** (the switch at the top of At a glance; remembered per viewer): the same tiles, counting everyone's issues, or only the loaded issues assigned to or reported by you. "You" is asked from each site once (`GET /rest/api/3/myself`, covered by the `read:jira-user` scope) and matched by account id on that issue's own site; a site that can't answer is named under the tiles and its issues aren't counted. Clicking a tile highlights just your matching issues in either view (`emphasis` with a `HighlightScope` in `src/graph/insights.ts`; matching in `src/graph/mine.ts`). The mock data's signed-in user is Jonas Berg.
- **Finish first** (under At a glance): the five open issues whose completion unblocks the most open work. That's distinct open, in-scope issues downstream through blocking links, at any depth and across sites; Done issues are passed through but not counted. Click one to show it and trace its chain.
- **Group by Assignee:** one lane per person, matched by display name so the same person on two sites shares a lane. Each lane header says how many of _other people's_ open issues are waiting downstream of that person's work ("Noor · holding up 7"). Unassigned issues and ghosts get their own lanes at the end.
- **Aging** (in At a glance, and clock badges on cards and timeline rows). An issue is _stuck_ when it has been in progress for more than twice its estimate in working days; the estimate uses the same days-per-point setting as the Timeline. It is _waiting_ when it has an open blocker and no status change (or, if it never moved, no creation) for 5+ working days. Epics, Done issues and ghosts are never flagged, and issues without the dates to judge are left out. Rules and thresholds live in `src/graph/aging.ts`. Status history now loads after every graph load (one bulk request per site), and `created` is requested with each search.
- **Epic map** (View → _Epic map_, graph view). Each epic becomes one summary card showing done/total with a progress bar, blocked and aging counts. Links between epics are combined into one arrow per direction, labelled "_N_ links · _M_ open", where open means the blocker isn't Done. Links inside an epic are hidden; issues without an epic and ghosts stay as they are. Click an epic to expand it into its own lane, and use the lane's _Collapse_ button to fold it back. Quick find and Finish first expand an epic automatically when you jump to an issue inside it. Cycles are recomputed between epics. The transform is `src/graph/collapse.ts`.
- **Since you last looked** (sidebar). Each scope (selected sites plus query or mode) keeps a small local snapshot: each issue's status category, whether it's blocked, its aging state, and the blocking links. On load Domino compares against it and lists issues that are _newly blocked_, _unblocked_, _done_, _newly aging_, _new_ in scope or _status moved_, plus new blocking links and issues that left the scope. Click the summary to highlight changed issues; changed cards and rows also carry a tag. **Mark as seen** moves the baseline forward. A scope's first visit records the baseline silently, after status history loads so aging isn't reported as new. Up to 12 scopes are remembered. The logic is in `src/graph/changes.ts`; the storage is in `src/state/useChanges.ts`.
- **Saved views** (top bar, _Views_). Save the current sites, query or mode, link filters, Group by, highlight, epic map and Graph/Timeline under a name, then apply it again in one click. Saving under an existing name updates that view. Views are stored on this machine (up to 30) and validated when read back; see `src/state/savedViews.ts`.
- **Share and export.** The **Export** menu (top-right of the graph, and in the timeline toolbar) copies the picture to the clipboard or saves it as PNG or SVG. It captures the whole graph or timeline, not just the part on screen. The graph is drawn with full cards even when you're zoomed out, and very large pictures are scaled down to stay within WebKit's canvas limit. In the _Views_ menu, **Export views…** saves your saved views as `domino-views.json`, and **Import views…** reads such a file back. Imported views replace ones with the same name, and invalid entries are dropped. Files are saved through the system Save dialog (Tauri `dialog` + `fs` plugins, limited to save and write). Capture lives in `src/ui/capture.ts`, and its library is loaded only on first export.
- **Issue filters** (Display → Issues): hide issues by status category, issue type or assignee without reloading. Each control lists only what's loaded, with counts. The section's badge shows how many issues are hidden, with a "Showing 9 of 12 · Clear filters" line. Filters store what's hidden, so new types or assignees arriving with a refresh still show. They're display only: At a glance, Finish first and the timeline's schedule still use the whole scope, so a hidden blocker still delays its dependents. Out-of-scope tickets linked only to hidden issues are hidden too. Jumping to a hidden issue (Quick find, sidebar lists) clears the issue filters first. Saved views include them. The logic is `visibleSubgraph` in `src/graph/visible.ts`.
- **Hide implied links** (Display → Links; on by default, remembered in saved views): a blocking link A→C is hidden when a longer drawn chain already implies it (A→B→C). It comes back when the issue in between is hidden by a filter, or when a link in the chain is hidden. Links in a blocking cycle are never hidden, and chains are traced only through the cycle-free part of the graph, so the result is unique (a transitive reduction). It's display only: blocker counts, the critical path and Finish first still use every link. The switch shows how many links it hides. The logic is `impliedEdgeIds` in `src/graph/visible.ts`.
- **"My work is unblocked" notifications** (Settings → Updates; off by default): when a load or refresh finds that an issue assigned to you was blocked on the previous load of the same scope and now has no open blocker, Domino shows a desktop notification (Tauri's notification plugin; the browser's Notification API in `dev:web`). First loads, scope switches and identical refreshes never notify. Turning it on asks the OS for permission. The logic is `src/graph/unblocked.ts`; the trigger is `src/state/useUnblockedNotifications.ts`.
- **Quick find** (top bar): type a key or part of a summary to jump to the issue in the current view. Exact and prefix key matches come first.
- **Semantic zoom:** below 60% zoom, graph cards switch to a compact form (key, status, blocker count) that stays readable.
- **Issue details** (click a card or timeline row): a drawer over the right of the canvas, built from what's already loaded, with no extra requests. It shows:
  - the summary, status, blockers, aging and change badges;
  - assignee, estimate, epic, and the created, due and resolved dates;
  - how many open issues finishing it would unblock downstream;
  - what it's blocked by, what it blocks, and its other links (each opens that issue in the drawer and the view);
  - its status history.

  "Open in Jira" leaves the app; ⌘/Ctrl+click on a card opens Jira directly. Esc closes the drawer and returns focus to the card or row. It's `src/ui/IssueDetail.tsx`.

- **Keyboard:** `/` or ⌘K / Ctrl+K opens quick find. `g` and `t` switch to Graph and Timeline. Tab moves between cards and rows; Enter shows the issue's details, ⌘/Ctrl+Enter opens it in Jira, and Esc closes the details.

## Timeline view

**Graph / Timeline** in the top bar switches between the dependency graph and a projected-vs-actual timeline of the same loaded issues. Sites, query, link filters, Group by, Critical path and What's ready all apply to both views.

| On each row    | Meaning                                                                                                                                                                                                                    |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dashed outline | **Projected**: the issue's estimate laid out in working days. Started issues begin at their real start. Unstarted issues begin when their blockers are projected to finish, never before _Unstarted from_ (default today). |
| Solid bar      | **Actual**: from the first move out of To Do to the resolved date, or to today if still open                                                                                                                               |
| Dotted bar     | **Forecast**: the remaining work from today. A late blocker pushes its dependents' forecasts.                                                                                                                              |
| Badge          | Variance in working days between projected and actual/forecast end (`+3d late`, `2d early`, `on track`)                                                                                                                    |
| ◆              | Jira due date; red when the forecast misses it                                                                                                                                                                             |
| Purple bar     | Epic summary spanning its loaded children                                                                                                                                                                                  |

- **Estimates:** story points × _Days / point_ (default 1). Unpointed issues use _Unpointed_ days (default 2). Weekends are skipped.
- **Arrows:** go from a blocker's projected end to the blocked issue's projected start. They're red when work started before its blocker finished, or when they're part of a cycle.
- **Data:** `resolutiondate` and `duedate` come with the normal search. Status history comes from `POST /rest/api/3/changelog/bulkfetch` (up to 1,000 issues per request) plus `GET /rest/api/3/status`, fetched after every load (aging uses it in both views).
- **Missing history:** issues that are in progress or done without status history show "start unknown" rather than invented dates.
- **Remembered per machine:** scale, estimates and _Unstarted from_.

Scheduling lives in `src/graph/schedule.ts` (pure, unit-tested). The UI lives in `src/ui/timeline/`.

## Releases

Versioning and releases use [Changesets](https://github.com/changesets/changesets); see `.changeset/README.md` for details. In short:

- `npm run changeset` describes a change.
- Merging to `main` adds it to an auto-maintained "Version Packages" PR.
- Merging that PR tags the release and starts a cross-platform build (macOS, Linux, Windows) that attaches installers to a draft GitHub Release.

CI (`.github/workflows/typescript.yml` and `rust.yml`) runs `npm run check`, the Vitest suite, `cargo clippy -D warnings` and `cargo test` on every push to `main` and on every PR.

## Styling

All visual values live in `src/styles/tokens.css`:

- **Type:** a size scale from `--text-2xs` to `--text-4xl`, and two weights.
- **Space:** a 4px grid with half steps, `--space-0_5` to `--space-6`.
- **Shape:** radii from `--radius-xs` to `--radius-pill`.
- **Elevation:** `--shadow-xs` to `--shadow-lg`, stronger in dark mode.
- **Motion:** `--duration-*` tokens.
- **Layers:** named z-index tokens (`--z-*`).
- **Controls:** one `--control-h` for every button, input and select.
- **Colour:** every theme colour, with dark-mode overrides.

Components use the tokens, never literals. The only literals left are 1px hairlines and two one-off offsets.

`src/styles/base.css` defines the control primitives with `:where()`, so they carry no specificity and any component class overrides them without counter-rules:

- **Buttons:** plain, `.primary`, `.danger`, `.icon-btn` and `.link-btn`.
- **Inputs and selects:** share the button height.

Icons come from `src/ui/Icon.tsx`: one 24px grid, 2px strokes, `currentColor`.

Performance:

- **Layout:** the ELK engine runs in a Web Worker (`src/graph/elk.ts`), off the main thread and out of the main bundle.
- **Code splitting:** the Timeline and Settings are lazy-loaded.

## App icon

The mark is three dominoes in a cascade: the amber tile (the critical-path colour) tips first and falls onto the next, the chain reaction Domino makes visible, and "finish this first". Sources live in `assets/brand/`:

- `icon.svg`: the full app icon, used from 48px up.
- `icon-small.svg`: a pip-less version that stays legible at 16–32px.
- `mark.svg`: the tiles alone. In the app it's `src/ui/BrandMark.tsx`, whose blue follows the theme's `--accent`.

To change it, edit and run `python3 assets/brand/build-icons.py`, which also writes `public/favicon.svg`. Then run `npx tauri icon assets/brand/icon.svg` and delete the `android/` and `ios/` folders it adds. Last, re-render the small art over `src-tauri/icons/32x32.png`, `Square30x30Logo.png` and `Square44x44Logo.png`, the 16–32px entries of `icon.ico`, and the 16/32pt entries of `icon.icns` (build an `.iconset` and run `iconutil -c icns`).

## Project layout

```
fixtures/mock/        shared Jira-shaped fixtures (Rust embeds them; Vitest imports them)
scripts/              gen-mock-fixtures.mjs (regenerates fixtures/mock/*.json)
src/config/           SiteConfig types, Zod schema, ConfigStore + TauriConfigStore
src/data/             JiraSource, TauriSource, FixtureSource, MultiSiteLoader
src/graph/            pure graph logic: buildGraph, cycles, analysis, layout (+ tests)
src/ui/               React components (consume graph/types.ts only)
src/styles/           tokens.css (every color, light + dark) and one stylesheet per surface
src/dev/mockIpc.ts    browser-only IPC mock for dev:web
src-tauri/            Rust core: config, secrets (keychain), commands, jira/{mock,http,oauth}.rs
```
