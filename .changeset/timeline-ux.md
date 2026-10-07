---
"domino": patch
---

Timeline fixes:

- **Done tickets with no status history**, which includes every Done ticket while history loads, sit on their resolved day. They used to be drawn as future work that pushed back everything they block.
- **The axis** names the month (day scale) and the year (week scale), in your language.
- **Due dates (◆)** are no longer hidden under the badge beside the bar.
- **The badge** says "+3d over estimate" instead of "late", with a tooltip, because it measures the estimate, not the due date. The counts say "over estimate" too.
- **A folded lane** draws its tickets' span as one bar and keeps its arrows.
- **The legend** matches what's drawn. With the timeline open, the sidebar's Legend explains every mark, and an arrow whose ticket started before its blocker finished is dotted.
- **Scrolling:** the chart opens on today, keeps your place when you change scale, and has a **Today** button. Moving to a ticket brings its bar into view sideways as well.
- **Settings:** Days / point and Unpointed explain themselves.
- **Rows and the Today flag:** a selected critical row keeps both marks, and the Today flag no longer covers today's date.
