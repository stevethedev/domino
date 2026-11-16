---
"domino": patch
---

On Windows, in-app updates unpack with a fixed version of the zip library. The old one could be tricked by a crafted update archive into overwriting files, running out of memory, or skipping an integrity check (GHSA-m665-v7pm-7grj, GHSA-q7v9-x93c-xqv3, GHSA-8hxf-qr8p-62x4).
