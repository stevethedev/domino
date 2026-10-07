---
"domino": patch
---

Graph and sidebar fixes:

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
