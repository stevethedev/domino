# domino

## 0.4.0

### Minor Changes

- [#12](https://github.com/stevethedev/domino/pull/12) [`339d7b5`](https://github.com/stevethedev/domino/commit/339d7b53c88bad16f4fc1f829911a66b4151b467) Thanks [@stevethedev](https://github.com/stevethedev)! - The details panel shows the ticket's description, with its formatting (headings, lists, code, tables, links, mentions). It's fetched when you open the ticket, so loads stay small; long descriptions are clipped until **Show more**, and images and attachments show a placeholder pointing you to Jira. Long ticket titles in the panel now wrap instead of being cut off.

- [#7](https://github.com/stevethedev/domino/pull/7) [`4503195`](https://github.com/stevethedev/domino/commit/45031954abf02a4ff040624f8fab8457b2a4f729) Thanks [@stevethedev](https://github.com/stevethedev)! - **Tickets stay on screen while loading.** A load no longer blanks the screen:

  - The last tickets for a scope show right away, from this session or from an encrypted cache of your 12 most recent scopes, with an **Updating…** note and each site's progress.
  - Switching to a new scope fades the old tickets until the new ones arrive; the first load shows a loading message instead of an empty canvas.
  - A site that fails to load keeps its last tickets, and the sidebar says how old they are.
  - Same-scope updates keep your pan and zoom, and saving Settings without changing a site no longer reloads. A new API token or Atlassian sign-in loads the scope again and forgets that site's old tickets.
  - **Settings → Cached tickets** explains and clears the cache, and says so if the key couldn't be replaced.
  - `DOMINO_CACHE_KEY` is now reserved: a site can't use it as its token's `secretRef`.

- [#10](https://github.com/stevethedev/domino/pull/10) [`84323a7`](https://github.com/stevethedev/domino/commit/84323a72264dfa6de678a1840bfa4675f915179b) Thanks [@stevethedev](https://github.com/stevethedev)! - **Sort tickets.** **Display → Sort by** orders tickets by priority, status, key, assignee, story points, due date, forecast finish, how much they unblock, how many blockers they have, or release:

  - In the graph, each column follows the sort; in the timeline, rows do. Lanes follow their first ticket.
  - The order is spelled out beside the choice ("Most severe first") and reverses with a click.
  - A "Sorted by …" chip shows while a sort is on; its ✕ goes back to the natural order.
  - The sort is remembered between launches and in saved views, and cards slide to their new places.

### Patch Changes

- [#16](https://github.com/stevethedev/domino/pull/16) [`cb1cece`](https://github.com/stevethedev/domino/commit/cb1cece58032d725e12abbc9aff7a0f27ecc251b) Thanks [@stevethedev](https://github.com/stevethedev)! - Accessibility and consistency:

  - **Contrast:** text on coloured backgrounds in dark mode, and error text, now pass WCAG AA contrast.
  - **Focus:** it goes somewhere sensible after applying a saved view or removing a site.
  - **Keys:** g / t no longer switch views from inside a dialog or menu.
  - **Reduced motion:** Settings' scrolling respects it.
  - **Depth field:** it keeps what you type (clearing it to type 3 no longer gives 13).
  - **Views button:** its accessible name starts with its visible label.
  - **Wording:** the app says "ticket" everywhere, matching the README.

- [#14](https://github.com/stevethedev/domino/pull/14) [`9e7eed0`](https://github.com/stevethedev/domino/commit/9e7eed0570286c866071201695d0e3579c863d80) Thanks [@stevethedev](https://github.com/stevethedev)! - Graph and sidebar fixes:

  - **Stuck states:** the "changed" highlight can't get stuck dimming every card. When the Display filters hide everything, both views say so, with **Clear filters**.
  - **Esc** closes the details panel, or else clears the highlight, from anywhere on the canvas.
  - **Filtered-out tickets:** jumping to one says the filters were cleared, with **Undo**. The details panel says when its ticket is hidden, and why.
  - **Details drawer:** it no longer covers the graph's Export menu or minimap, or the end of the timeline toolbar.
  - **Your view:** changing filters, folds or the sort keeps your pan and zoom. Only a new scope or grouping re-fits.
  - **Keyboard:** the graph is a single Tab stop, and the arrow keys move between cards. A card reached by keyboard is brought into view, even from under the details drawer.
  - **Menus:** the Type, Assignee and Priority filter menus close on Esc or a click elsewhere.
  - **At a glance:** with filters on, each tile says how many of its tickets are shown. Tiles with nothing to highlight are disabled.
  - **Blocking cycles** get a ⟲ badge on their cards and a marker on their arrows, not just red, and highlights no longer fade them. The Aging highlight no longer uses the cycle red.
  - **Epic lanes:** names fit beside **Collapse** (full name on hover), and clicking one shows the epic's details.
  - **Zoomed-out cards** show a "+N" instead of cutting badges off. Clearing the sort or filters keeps keyboard focus.

- [#11](https://github.com/stevethedev/domino/pull/11) [`c0fbd21`](https://github.com/stevethedev/domino/commit/c0fbd217e8b8f3305e1042305a8121a35c0a2907) Thanks [@stevethedev](https://github.com/stevethedev)! - While a sort is on, graph cards no longer slide when data refreshes or status history arrives; only changing the sort animates them. Timeline arrows now hide only while rows are actually moving, so a refresh that leaves every row in place doesn't blink them.

- [#15](https://github.com/stevethedev/domino/pull/15) [`8b04aad`](https://github.com/stevethedev/domino/commit/8b04aadf8bca9d6295d902e94465a18ec6e2aeaf) Thanks [@stevethedev](https://github.com/stevethedev)! - Timeline fixes:

  - **Done tickets with no status history**, which includes every Done ticket while history loads, sit on their resolved day. They used to be drawn as future work that pushed back everything they block.
  - **The axis** names the month (day scale) and the year (week scale), in your language.
  - **Due dates (◆)** are no longer hidden under the badge beside the bar.
  - **The badge** says "+3d over estimate" instead of "late", with a tooltip, because it measures the estimate, not the due date. The counts say "over estimate" too.
  - **A folded lane** draws its tickets' span as one bar and keeps its arrows.
  - **The legend** matches what's drawn. With the timeline open, the sidebar's Legend explains every mark, and an arrow whose ticket started before its blocker finished is dotted.
  - **Scrolling:** the chart opens on today, keeps your place when you change scale, and has a **Today** button. Moving to a ticket brings its bar into view sideways as well.
  - **Settings:** Days / point and Unpointed explain themselves.
  - **Rows and the Today flag:** a selected critical row keeps both marks, and the Today flag no longer covers today's date.

- [#13](https://github.com/stevethedev/domino/pull/13) [`f7d9d4e`](https://github.com/stevethedev/domino/commit/f7d9d4e104765a3f4e4c67111cf242600316600a) Thanks [@stevethedev](https://github.com/stevethedev)! - Fewer dead ends and silent losses:

  - A settings file that can't be read no longer stops Domino from opening. It starts without sites, explains the problem, and offers **Reload file**, **Show file** and **Open Settings**.
  - Saved views are never dropped to make room (the limit is now 100). Saving past the limit explains why, imports say what they added, replaced or skipped, and deleting a view asks first.
  - Applying a view that uses sites you don't have applies what it can and says what it couldn't, instead of blanking the canvas.
  - When a site fails to update, the error banner says why (an expired token, for example), with **Retry** and **Open Settings**. It no longer repeats the site's name.
  - A scope that fails to load no longer leaves "Loading…" up over faded tickets; it says what failed, with **Retry**.
  - Settings asks before throwing away an edited site form. Adding a site saves its token first, so a keychain failure can be retried. Old errors no longer reappear.
  - An Atlassian sign-in can be cancelled, and **Disconnect** asks first, naming the sites it affects.
  - Canvas messages offer **Open Settings** or **Retry** buttons.

- [#18](https://github.com/stevethedev/domino/pull/18) [`7810ae2`](https://github.com/stevethedev/domino/commit/7810ae210f3f9e0f44702de4dab734435710a7e7) Thanks [@stevethedev](https://github.com/stevethedev)! - - A settings file that can't be read can now be set aside with **Start fresh**: it's kept beside it as `domino.config.broken.json` (or `-2`, `-3`… if earlier ones are there; Domino says which), and Domino starts with no sites.
  - A folded epic shows the ⟲ Cycle badge when any of its tickets is in a blocking cycle.
  - Several tickets in a folded timeline lane linked to the same ticket now draw one arrow instead of overlapping ones.

## 0.3.0

### Minor Changes

- [#5](https://github.com/stevethedev/domino/pull/5) [`3c4dc54`](https://github.com/stevethedev/domino/commit/3c4dc5435ec44b4b31eb20b7453c5f3c31efd12e) Thanks [@stevethedev](https://github.com/stevethedev)! - **Ticket priority:** cards show each ticket's Jira priority by its key, the details panel lists it, and Display can hide tickets by priority (including those with none). Saved views remember the priority filter.

## 0.2.0

### Minor Changes

- [`b8aa123`](https://github.com/stevethedev/domino/commit/b8aa1238480a55393e82864770c00445071d039a) Thanks [@stevethedev](https://github.com/stevethedev)! - Filters, details, releases, sharing and in-app updates.

  - **In-app updates:** Domino checks for new releases and offers to install them (Settings → App version). Updates are signed and verified before they install.
  - **Issue filters:** hide issues by status, type or assignee without reloading.
  - **Issue details panel:** click a card or row to see status, people, dates, links and status history without leaving the app.
  - **Hide implied links:** a blocking link that a longer drawn chain already implies is hidden (on by default).
  - **Unblocked notifications:** an optional desktop notification when your own work is unblocked.
  - **Share and export:** copy the graph or timeline as an image, save it as PNG or SVG, and export or import saved views as a file.
  - **Keyboard traversal:** arrow keys follow blocking links between cards and rows, with a preview of where they lead.
  - **Release markers:** Jira fix versions appear on the timeline, with issues forecast to miss their release flagged and a Releases section in the sidebar.
  - **Folding epics:** when grouped by epic, collapse an epic's lane into a summary card, in both views. This replaces the Epic map switch, and saved views remember the folds.
  - A consistent visual design, timeline rows that never overflow, and one badge style everywhere.
