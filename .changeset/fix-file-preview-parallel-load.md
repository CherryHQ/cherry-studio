---
'CherryStudio': patch
---

Fix file preview: parallel-load plugin chunks alongside metadata IPC and cache results in a WeakMap to avoid duplicate load() calls. Previously `lazy(plugin.load)` called the load function on every render, and a plugin load error collapsed into an `unavailable` state instead of the expected `load_error` surface.
