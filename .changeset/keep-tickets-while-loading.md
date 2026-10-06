---
"domino": minor
---

**Tickets stay on screen while loading.** A load no longer blanks the screen:

- The last tickets for a scope show right away, from this session or from an encrypted cache of your 12 most recent scopes, with an **Updating…** note and each site's progress.
- Switching to a new scope fades the old tickets until the new ones arrive; the first load shows a loading message instead of an empty canvas.
- A site that fails to load keeps its last tickets, and the sidebar says how old they are.
- Same-scope updates keep your pan and zoom, and saving Settings without changing a site no longer reloads. A new API token or Atlassian sign-in loads the scope again and forgets that site's old tickets.
- **Settings → Cached tickets** explains and clears the cache, and says so if the key couldn't be replaced.
- `DOMINO_CACHE_KEY` is now reserved: a site can't use it as its token's `secretRef`.
