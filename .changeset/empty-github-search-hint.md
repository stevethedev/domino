---
"domino": patch
---

When a GitHub search limited to a repository or owner finds nothing, a banner now says the token may not be able to see it (a classic token needs the repo scope and SSO authorization for the org; a fine-grained one needs access to the repository), since GitHub leaves those results out without an error.
