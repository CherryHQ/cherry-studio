---
description: Entry point for file domain references covering the file module, FileManager internals, directory trees, and cleanup
sources:
  - src/main/services/file
  - src/main/ipc/handlers/file.ts
---

# File Reference

This is the entry point for the file domain in Cherry Studio v2 — the main-process file
module under `src/main/services/file`: FileEntry management, the directory-tree primitive,
entry cleanup, and directory fuzzy search.

| Document | What it covers |
|---|---|
| [File Module Architecture](./architecture.md) | Module boundaries, `FileHandle` / `FileEntry` / `FileInfo` type system, IPC/DataApi contracts, layered architecture |
| [Directory Tree Architecture](./directory-tree.md) | `DirectoryTreeBuilder` primitive, `DirectoryTreeManager` lifecycle service, `file.tree.*` IPC contract, `useDirectoryTree` hook |
| [File Entry Cleanup (GC) Design](./file-entry-cleanup.md) | Silent scan-based cleanup reclaiming unreferenced entries via the per-entry `cleanup_policy` column |
| [FileManager Architecture](./file-manager-architecture.md) | FileManager internals: storage layout, atomic writes, version detection, recycle bin, watcher, DanglingCache |
| [Fuzzy Search for Directory Listings](./fuzzy-search.md) | `listDirectory` / `listDirectoryEntries` modes, ripgrep-backed fuzzy matching, and ranking rules |
