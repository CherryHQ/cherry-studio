---
'@cherrystudio/ui': patch
---

Replace `lodash` with `es-toolkit/compat` in the scrollbar component (`throttle`) and declare `es-toolkit` as a dependency. It was previously resolved via workspace hoisting from the root `lodash`, which has now been removed; the package no longer relies on `lodash`.
