---
'@cherrystudio/provider-registry': patch
---

Serve the catalog that is compiled into the package when a registry file on disk cannot be read, and report the fallback with a bounded cause instead of failing every lookup. A fallback expires after the idle TTL so a repaired file is picked up, and `models`/`provider-models` always come from a single snapshot.
