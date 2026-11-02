# Frontend UX and accessibility plan

Who it's for: **an engineer or tech lead doing a short daily check** ("what's blocking us, and what do we finish first?"), mostly by keyboard. Planning on the timeline comes second.

The frontend already does a lot right: a native `<dialog>` for Settings, disclosure sidebar sections with real headings, a single Tab stop with arrow keys in the graph, reduced motion honored, and colors from tokens. These steps close the gaps. Each one is its own PR, in this order.

## 1. Daily-check fixes

- **First load stays readable.** Add `MIN_READABLE_ZOOM = 0.85`, separate from `COMPACT_BELOW_ZOOM` (0.6). Fit everything only when it fits at ≥ 0.85. Otherwise fit, in order:
  1. Your tickets plus what directly blocks them.
  2. If you have none, the top "Finish first" ticket and what it unblocks.
  3. If neither, the top-left of the layout.

  When it fits a subset, a one-line notice on the canvas says so: "Showing your 4 tickets and their blockers · Show all". (`src/ui/Canvas.tsx:202-230`)

- **Empty sections take one line.** Warnings, Since you last looked, Finish first and Releases shrink to a muted "· none" heading with no chevron and no body. This is computed from the data, never saved, so a section you left open reopens when it has content. (`src/ui/SidebarSection.tsx`, `src/App.tsx:667-762`)
- **The query field expands when edited.** At rest it's a compact one-line field. On focus it opens a wide editor anchored under it (~60% of the window) with:
  - a multi-line textarea,
  - the per-site "Runs: …" preview, which today only screen readers get,
  - the presets as a list,
  - Load and Cancel.

  Enter loads, Shift+Enter adds a line, Esc cancels and returns focus. The separate Presets select goes away. Mode stays a small select. (`src/ui/ScopeInputs.tsx`)

- **Release cards stop overflowing.** The date moves onto the status line ("Nov 13 · in 11 days · 3 open · on track"), and the name cuts off with "…". (`src/styles/shell.css:1402-1418`, `src/ui/ReleasesPanel.tsx`)

## 2. State tokens

- **Selected and focused look different.** Focus is the outside ring (3px, 3px offset, `--focus`) everywhere. Selection moves inside the card: a new `--selected-bg` tint plus a 2px accent border. In the timeline, the focused row gets the ring and the selected row gets the tint plus the inset accent bar, which now means "selected" only. (`src/styles/graph.css:24-27, 572-575`, `src/styles/timeline.css:267-273, 584-586`)
- **Faded cards keep readable text.**
  - _Ghost:_ no opacity. It gets `--surface-2`, a dashed border and the "Outside scope" label. `--muted` must reach ≥ 4.5:1 on `--surface-2` in both themes.
  - _Dimmed:_ text stays at full contrast. The border, badges, type icon and avatar go grayscale and lighter, and its edges drop to ~30%. The highlighted cards keep their ring.

  (`src/styles/graph.css:40-51`, `src/styles/timeline.css:275-280`)

- **Controls get visible edges.** A new `--border-control` at ≥ 3:1 in both themes for inputs, selects, textareas, checkboxes and `<summary>` triggers. `--border` stays for dividers and cards. The four repeated trigger styles become one rule. (`src/styles/tokens.css`, `src/styles/base.css:132-150`, `src/styles/shell.css:298, 749, 1034, 1351`)
- **Critical path gets a "Critical" badge** in timeline rows, like Ready, and the inset bar is dropped from critical rows. In the graph the badge shows only when highlighted and in the detail drawer. (`src/ui/timeline/TimelineRow.tsx`, `src/styles/timeline.css:284-286`)
- **Explanations reachable without hovering.** The 66 `title=` uses split three ways:
  - Field help becomes a new `<InfoTip>` toggletip: an ⓘ button, opened by click, Enter or Space, closed by Esc or blur, linked with `aria-describedby`.
  - Meanings carried only by an icon become visible text, such as "misses due", or go into the ticket description from step 5.
  - Text cut off with "…" keeps `title`.
- **Contrast fixes.**
  - `.health-ok` uses a darker `--done-fg`.
  - Type-icon letters meet 4.5:1.
  - In dark mode, `--on-type` on the epic color becomes dark ink.
  - In dark mode, the link color on `--surface-2` reaches 4.5:1.
- **Windows High Contrast.** Under `forced-colors`, the active segment and pressed insight tiles get a border or outline in system colors.
- Not included: an in-app theme switch. The app keeps following the OS.

## 3. Focus helper

- **The timeline becomes one Tab stop** with roving focus:
  - ↑/↓ move between rows, Home/End go to the ends, PgUp/PgDn jump a screen.
  - Enter or Space opens a row.
  - ←/→ fold and unfold lanes.
  - Coming back returns to the last row.

  It shares one roving-focus hook with the graph. (`src/ui/timeline/TimelineRow.tsx:121`, `src/ui/Canvas.tsx:326`)

- **`useFocusReturn`** remembers the element that opened a drawer, menu, editor or Find. It restores focus there, or to the view's Tab stop if that element is gone. It replaces the DOM-string lookups and the 25×80ms polling. (`src/App.tsx:444-448, 545-550, 849`, `src/ui/FilterPanel.tsx:264`, `src/ui/Settings/SettingsDialog.tsx:262-266`, `src/ui/SavedViewsMenu.tsx:110-113`)
- **Menus stay `<details>`.** `useDetailsMenu` closes on `focusout` that leaves the menu, and Esc returns focus to the `<summary>`. The sidebar filter menus expand in place instead of overlaying, so they no longer get clipped. Native `popover` isn't used: macOS < 14 and older WebKitGTK don't support it. (`src/ui/useDetailsMenu.ts`, `src/styles/shell.css:1059-1063`)
- **Find.** The first Esc closes the list and the second returns focus to where you were. "No tickets match" moves outside the listbox, the result count is announced, and `aria-controls` is set only while the list exists. (`src/ui/QuickFind.tsx`)

## 4. Messages and errors

- **Where each kind of message goes.**
  - **Toast:** confirmations of something you just did, often with Undo. It stays at least 6s and pauses on hover or focus.
  - **Banner:** errors, and anything still true. It stays until fixed or dismissed.
  - **Inline:** field validation, with one announcement per submit instead of a `role="alert"` on every field.
  - **Confirm:** one component, inline, focus moved to Cancel, `role="group"` with a label. It replaces the misused `role="alertdialog"`.

  Errors never go in toasts. (`src/App.tsx:627`, `src/ui/Toast.tsx`, `src/ui/Settings/SettingsDialog.tsx:173`, `src/ui/Settings/BackendSection.tsx:196`, `src/ui/Settings/SiteRow.tsx:73-85`, `src/ui/SavedViewsMenu.tsx:85-115`, `src/ui/Settings/SiteForm.tsx:208`)

- **One `<Announcer>`** that's always in the page, with a polite and an assertive live region that every component uses. That fixes live regions appearing at the same moment as their text. (`src/ui/Toast.tsx:19`, `src/App.tsx:960-963`, `src/ui/SavedViewsMenu.tsx:231`, `src/ui/FilterPanel.tsx:254`, `src/ui/EmptySearchBanner.tsx:59`)
- **One banner area.**
  - It shows the most severe banner (error, then warning, then info; ties go to the newest), plus "+N more", which expands in place.
  - Dismissing one shows the next.
  - Each banner is announced once.
  - Banners about a single site ("Partner failed to load · Retry") go in the load pill's popover. (`src/App.tsx:610-659`, `src/ui/LoadStatus.tsx`)

## 5. One shared ticket description

- **Name** (`aria-label`): "CORE-10, Accept partner payment tokens in checkout".
- **Description** (`aria-describedby`): `describeTicket(node, context)` in `src/graph/`, in this order:
  1. What needs attention: Critical, Ready, In a cycle, Changed.
  2. Status and blockers: status, open blockers, how long it's been waiting.
  3. Who and how much: type, assignee, points, priority.
  4. Where: the site, and "outside scope" for ghosts.
  5. Timeline only: the forecast and the release it misses.
- Both views use it. A unit test checks that every visible badge has a phrase. (`src/ui/IssueCard.tsx:349-363`, `src/ui/timeline/TimelineRow.tsx:45-56, 122-126`)
- Also: `.xsite-marker` gets `role="img"`. (`src/ui/edges/LinkEdge.tsx:79-85`)

## 6. Scaling and responsiveness

- **Webview zoom, keeping px tokens.** Set `zoomHotkeysEnabled` (Cmd/Ctrl + / − / 0), add View → Zoom In / Zoom Out / Actual Size, and remember the level. Webviews ignore the OS text size, so converting to rem would barely help. (`src-tauri/tauri.conf.json`)
- **Layout numbers come from one source.** TS writes `--label-w`, `--row-h`, `--lane-h`, `--card-w` and `--card-h` to the root. The CSS copies go away. (`src/ui/timeline/timelineLayout.ts:13`, `src/graph/layout.ts:6-7`, `src/styles/timeline.css:50, 61, 69, 254, 291, 504`, `src/styles/graph.css:5-6`)
- **Three tiers via container queries on `.workspace`.** At 200% zoom, the 900px minimum window is effectively 450px wide.

  | Workspace width | Sidebar                                                       | Detail drawer                                  | Timeline label column           | Top bar                                                                                              |
  | --------------- | ------------------------------------------------------------- | ---------------------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------- |
  | ≥ 1100px        | 248px, as today                                               | 360px overlay                                  | 320px                           | As today                                                                                             |
  | 700–1100px      | Collapsible: a top-bar toggle, overlays when open, remembered | 320px                                          | 240px, summary cut off with "…" | Find becomes an icon that expands. The view toggle shows icons, with the text in the accessible name |
  | < 700px         | A drawer, closed by default                                   | Full width, with Close/Back that returns focus | 160px, key and status only      | Sites shows "N sites". Mode moves into the query editor                                              |

  Below 1100px, the timeline's Days/point, Unpointed and Unstarted from controls move into an overflow menu. Below 700px, Settings' sites table becomes a stacked list.

- **Single-key shortcuts can be turned off.** Settings gets a Keyboard section with "Single-key shortcuts (g, t, /)", on by default. Cmd/Ctrl+K still opens Find. `?` opens a dialog listing every shortcut.

## Small cleanups (fold into whichever step touches the file)

- Heading levels: "Add a site" / "Edit …" becomes `<h4>`. (`src/ui/Settings/SiteForm.tsx:252`)
- The timeline toolbar drops `role="toolbar"`, since it has no arrow-key navigation. (`src/ui/Timeline.tsx:334`)
- Focus and highlight rings use `--ring-width`. Hard-coded `#6b7280` / `#9ca3af` become tokens. The backdrop color and `22px` font size use tokens.
- Raw `z-index` values go onto the scale. The drawer, popovers and the load pill get separate layers.
- Delete the dead selectors `.form-wide` and `.card.hl-both`. Remove the redundant reduced-motion blocks and the `!important` at `src/styles/shell.css:590` and `src/styles/timeline.css:43`.
- The Find list is positioned so it can't overflow the screen. (`src/styles/shell.css:541-559`)
- Small targets (`.sort-chip-clear`, `.lane-collapse`, toolbar `.link-btn`) reach 24×24.
