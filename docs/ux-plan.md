# Frontend UX and accessibility plan

Who it's for: **an engineer or tech lead doing a short daily check** ("what's blocking us, and what do we finish first?"), mostly by keyboard. Planning on the timeline comes second.

The frontend already does a lot right: a native `<dialog>` for Settings, disclosure sidebar sections with real headings, a single Tab stop with arrow keys in the graph, reduced motion honored, and colors from tokens. These steps close the gaps. Each one is its own PR, in this order.

## 1. Daily-check fixes — done in #39

Shipped as planned, with these differences:

- **First load stays readable.** If even the chosen part doesn't fit at 0.85, it narrows to one ticket ("Showing 1 of your 4 tickets"). With none of your tickets drawn, it uses the drawn ticket that unblocks the most, even outside the top five. A view picked before your tickets are known is picked again once they load, unless you've moved it. Panning, zooming, the minimap and Show all clear the notice. (`src/ui/firstView.ts`, `src/ui/Canvas.tsx`)
- **Empty sections take one line.** As planned. A section that empties or fills while it has focus keeps focus on its heading. (`src/ui/SidebarSection.tsx`)
- **The query field expands when edited.** It opens when clicked or activated, not on focus: it's a `<details>`, like the other menus. It moves right to stay on screen when the top bar wraps. Loading a new scope gives focus back to the field, or to Load. (`src/ui/ScopeInputs.tsx`)
- **Release cards stop overflowing.** As planned. (`src/ui/ReleasesPanel.tsx`)

## 2. State tokens — done in #41 and #43

Shipped in two PRs. Differences from the plan:

- **Timeline rows keep an inset focus ring.** Rows sit edge to edge in a scrolling list, so an outside ring would be cut off. Selection there is the tint and the accent bar, never a ring.
- **`--muted` needed no change:** it was already 5.26:1 (light) and 6.02:1 (dark) on `--surface-2`.
- **`--done-fg` is new,** for "done" as text; `--done` stays for fills and edges. The Story icon's green was darkened too: white on it was 3.30:1.
- **The Critical badge comes first** on timeline rows, since rows are only marked critical while that highlight is on. It has its own `--critical-bg` / `--critical-fg`.
- **The pressed "Since you last looked" summary** also gets the forced-colors outline, like the insight tiles.
- **A token contrast test** (`src/styles/__tests__/tokens.test.ts`) checks every pair above in both themes.
- **`<InfoTip>` is a `<details>`,** like the menus, using `useDetailsMenu`; moving focus away also closes it. Chrome leaves text inside a closed `<details>` out of a description, so a hidden copy outside it is what `aria-describedby` points at. In the sidebar it spans its row instead of floating, so it never runs past the sidebar; in the timeline toolbar it narrows and shifts to stay clear of the details drawer, and fits again on resize. (`src/ui/InfoTip.tsx`)
- **Six field-help titles became InfoTips,** and so did the "Couldn't tell who you are" errors, which were only in a title. The timeline's variance badge sits inside a row that is a button, so its explanation went into the Timeline Legend instead. Both Legends now also say what each type letter means.
- **The view switch shows its keys** (`g`, `t`) beside each name, like Find's `/`, instead of in a "(g)" / "(t)" title; screen readers get them from `aria-keyshortcuts`, and the keys work while its radios have focus. The Sort chip keeps its title: its text is cut off in a narrow sidebar.
- **A test keeps titles off `<label>` and `<fieldset>`** (`src/ui/__tests__/fieldHelp.test.ts`).
- **Left for step 5:** the "+N" badge overflow list, aging details and priority names, which only titles carry today.

Not included: an in-app theme switch. The app keeps following the OS.

## 3. Focus helper

Done in three PRs: the timeline in #44, focus return in #46, and menus and Find in the PR after it. Differences from the plan:

- **The timeline is one Tab stop** over its lane headers and rows, in screen order. ↑/↓ move one item, Home/End go to the ends, PgUp/PgDn jump a screen, Enter or Space opens a row, and coming back returns to the last item. Lane headers are items too, so a header's ←/→ fold and unfold its lane, and ⌘/Ctrl+Enter opens an epic lane's epic.
- **←/→ on a row still follow blocking links,** as they do in the graph, instead of folding lanes: both views keep one meaning for ←/→. A row's ↑/↓ move in order and no longer go through the link trail's alternatives; the graph's still do.
- **One roving-stop rule for both views** (`tabStopOf` in `src/ui/useRovingStop.ts`): the item last focused, else the open issue, else the first item.
- **A focused row that's folded away** hands focus to its lane's header.
- **Both Legends name the arrow keys.**

Done in the second PR:

- **Focus return** (`src/ui/useFocusReturn.ts`): `remember` as a drawer or prompt opens, `restore` as it closes; the return waits for the closing render, so no `requestAnimationFrame`. Used by the details panel, Settings' "Keep editing" and a saved view's "Keep". The details panel goes back to the issue it was showing first (it can differ from what opened it, after following links inside it), then the opener, then the view's Tab stop (`viewTabStop` in `src/ui/viewItems.ts`).
- **No more polling for a just-revealed issue.** `focusWhenDrawn` in `App.tsx` leaves a `FocusRequest` (`src/ui/focusRequest.ts`) that the card or row answers once it's mounted, from an effect; it gives up after 2s. It replaces the 25×80ms and 10×120ms retries.
- **Not changed:** the "button goes away" moves (Clear filters, Show, Start fresh) still focus a fixed element, since nothing opened them. A saved view's ✕ is drawn anew after "Keep", so it's found by name (`data-view`), not remembered.

Done in the third PR:

- **Menus stay `<details>`** and close when focus lands outside them: `useDetailsMenu` listens for `focusin` on the document, as it did for `mousedown` (`leavesMenu`), so Tab and hotkeys (`/` to Find) both close it. Focus leaving for nowhere (the window losing it, a click on a menu's padding) leaves it open. Info tips keep their own rule, closing then too, since their text takes focus (`focusLeaves`, now shared from `src/ui/useDetailsMenu.ts`). Esc already returned focus to the `<summary>`, and the canvas already ignores Esc from inside a `<details>`.
- **The sidebar filter menus open in place,** pushing the fields below them down, so the sidebar's scroll no longer clips them.
- **Find:** the first Esc closes the list and keeps what you typed; the second clears it and returns focus to where you were before Find (`useFocusReturn`, remembering the focus event's `relatedTarget`), or the view's Tab stop. A status region announces the count ("12 tickets match, showing the first 8", from `findStatus`). "No tickets match" shows beside the listbox, which exists only with options in it; `aria-expanded` and `aria-controls` follow it.

## 4. Messages and errors

- **Where each kind of message goes.**
  - **Toast:** confirmations of something you just did, often with Undo. A plain confirmation stays at least 6s and pauses on hover or focus. A toast with an action, such as Undo, stays until it's dismissed, acted on or replaced by the next toast, so keyboard and screen-reader users can always reach it (WCAG 2.2.1). (`src/App.tsx:532-540`)
  - **Banner:** errors, and anything still true. It stays until fixed or dismissed.
  - **Inline:** field validation, with one announcement per submit instead of a `role="alert"` on every field.
  - **Confirm:** one component, inline, focus moved to Cancel, `role="group"` with a label. It replaces the misused `role="alertdialog"`.

  Errors never go in toasts. (`src/App.tsx:628`, `src/ui/Toast.tsx`, `src/ui/Settings/SettingsDialog.tsx:173`, `src/ui/Settings/BackendSection.tsx:196`, `src/ui/Settings/SiteRow.tsx:73-85`, `src/ui/SavedViewsMenu.tsx:85-115`, `src/ui/Settings/SiteForm.tsx:208`)

- **One `<Announcer>`** that's always in the page, with a polite and an assertive live region that every component uses. That fixes live regions appearing at the same moment as their text. While a modal dialog is open, `announce()` routes into polite and assertive regions inside that dialog instead: `showModal()` makes the rest of the page inert, so its regions go silent. Each modal renders its regions once, so they exist before any text arrives. (`src/ui/Toast.tsx:19`, `src/ui/Settings/SettingsDialog.tsx:69`, `src/App.tsx:972-975`, `src/ui/SavedViewsMenu.tsx:231`, `src/ui/FilterPanel.tsx:254`, `src/ui/EmptySearchBanner.tsx:59`)
- **One banner area.**
  - It shows the most severe banner (error, then warning, then info; ties go to the newest), plus "+N more", which expands in place.
  - Dismissing one shows the next.
  - Each banner is announced once.
  - Banners about a single site ("Partner failed to load · Retry") go in the load pill's popover. (`src/App.tsx:611-660`, `src/ui/LoadStatus.tsx`)

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

- **Webview zoom, keeping px tokens.** Set `zoomHotkeysEnabled` for Cmd/Ctrl + / −, add View → Zoom In / Zoom Out / Actual Size, and remember the level. Webviews ignore the OS text size, so converting to rem would barely help.
  - On macOS and Linux the hotkeys are a Tauri polyfill that needs the `core:webview:allow-set-webview-zoom` permission. This step grants it: without it, zoom does nothing there.
  - The polyfill has no reset key, so Actual Size and Cmd/Ctrl+0 come from the View menu calling `setZoom(1)`.

  (`src-tauri/tauri.conf.json`, `src-tauri/capabilities/default.json`)

- **Layout numbers come from one source.** TS writes `--label-w`, `--row-h`, `--lane-h`, `--card-w` and `--card-h` to the root. The CSS copies go away. (`src/ui/timeline/timelineLayout.ts:13`, `src/graph/layout.ts:6-7`, `src/styles/timeline.css:50, 61, 69, 254, 291, 504`, `src/styles/graph.css:5-6`)
- **Three tiers via container queries on `.app`.** It holds the top bar, the workspace and Settings, so one container drives all of them. It spans the window. At 200% zoom, the 900px minimum window is effectively 450px wide.

  | Window width | Sidebar                                                       | Detail drawer                                  | Timeline label column           | Top bar                                                                                              |
  | ------------ | ------------------------------------------------------------- | ---------------------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------- |
  | ≥ 1100px     | 248px, as today                                               | 360px overlay                                  | 320px                           | As today                                                                                             |
  | 700–1100px   | Collapsible: a top-bar toggle, overlays when open, remembered | 320px                                          | 240px, summary cut off with "…" | Find becomes an icon that expands. The view toggle shows icons, with the text in the accessible name |
  | < 700px      | A drawer, closed by default                                   | Full width, with Close/Back that returns focus | 160px, key and status only      | Sites shows "N sites". Mode moves into the query editor                                              |

  Below 1100px, the timeline's Days/point, Unpointed and Unstarted from controls move into an overflow menu. Below 700px, Settings' sites table becomes a stacked list.

- **Single-key shortcuts can be turned off.** Settings gets a Keyboard section with "Single-key shortcuts (g, t, /)", on by default. Cmd/Ctrl+K still opens Find. `?` opens a dialog listing every shortcut.

## Small cleanups (fold into whichever step touches the file)

- Heading levels: "Add a site" / "Edit …" becomes `<h4>`. (`src/ui/Settings/SiteForm.tsx:252`)
- The timeline toolbar drops `role="toolbar"`, since it has no arrow-key navigation. (`src/ui/Timeline.tsx:334`)
- Focus and highlight rings use `--ring-width`. Hard-coded `#6b7280` / `#9ca3af` become tokens. The backdrop color and `22px` font size use tokens.
- Raw `z-index` values go onto the scale. The drawer, popovers and the load pill get separate layers.
- Delete the dead selectors `.form-wide` and `.card.hl-both`. Remove the redundant reduced-motion blocks and the `!important` at `src/styles/shell.css:682` and `src/styles/timeline.css:43`.
- The Find list is positioned so it can't overflow the screen. (`src/styles/shell.css:633-651`)
- Small targets (`.sort-chip-clear`, `.lane-collapse`, toolbar `.link-btn`) reach 24×24.
