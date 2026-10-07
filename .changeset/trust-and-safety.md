---
"domino": patch
---

Fewer dead ends and silent losses:

- A settings file that can't be read no longer stops Domino from opening. It starts without sites, explains the problem, and offers **Reload file**, **Show file** and **Open Settings**.
- Saved views are never dropped to make room (the limit is now 100). Saving past the limit explains why, imports say what they added, replaced or skipped, and deleting a view asks first.
- Applying a view that uses sites you don't have applies what it can and says what it couldn't, instead of blanking the canvas.
- When a site fails to update, the error banner says why (an expired token, for example), with **Retry** and **Open Settings**. It no longer repeats the site's name.
- A scope that fails to load no longer leaves "Loading…" up over faded tickets; it says what failed, with **Retry**.
- Settings asks before throwing away an edited site form. Adding a site saves its token first, so a keychain failure can be retried. Old errors no longer reappear.
- An Atlassian sign-in can be cancelled, and **Disconnect** asks first, naming the sites it affects.
- Canvas messages offer **Open Settings** or **Retry** buttons.
