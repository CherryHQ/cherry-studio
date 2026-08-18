---
description: Entry point for current FileManager, directory-tree, cleanup, watcher, and directory-search references
sources:
  - src/main/services/file
  - src/main/ipc/handlers/file.ts
  - src/shared/data/types/file.ts
---

# File Reference

The file domain covers persistent managed entries, filesystem-backed IPC, live directory trees,
background cleanup, and the legacy directory-listing/search surface. Start with the module
architecture for ownership and transport selection; use the narrower documents for implementation
contracts.

| Document | What it covers |
|---|---|
| [File Module Architecture](./architecture.md) | Ownership, current shared types, DataApi/IpcApi split, legacy preload surface, and business references |
| [FileManager Architecture](./file-manager-architecture.md) | Storage, entry lifecycle, atomic writes, external liveness, watcher, caches, and orphan sweeps |
| [Directory Tree Architecture](./directory-tree.md) | Builder/manager ownership, snapshot activation, mutation stream, renderer mirror, and cleanup |
| [File Entry Cleanup](./file-entry-cleanup.md) | Policy-based scan that reclaims old unreferenced automatic entries |
| [Fuzzy Search for Directory Listings](./fuzzy-search.md) | Legacy listing modes, ripgrep-backed fuzzy matching, ranking, exclusions, and errors |
