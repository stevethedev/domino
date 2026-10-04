# domino

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
