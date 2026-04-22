/**
 * File module — public surface.
 *
 * The file module uses a **facade + private internals** pattern:
 *
 * - `FileManager` is the planned single public entry point for all file
 *   operations. In the current phase, this barrel exposes the public contract
 *   surface only (types / errors), not a concrete lifecycle-service class.
 *   Once the lifecycle implementation lands, Main runtime code will resolve
 *   the singleton instance via `application.get('FileManager')`.
 * - Implementation lives under `./internal/*` (entry / content / system ops)
 *   as pure-function modules. These are **NOT** re-exported from this barrel
 *   and MUST NOT be imported from outside the file module.
 * - `./ops/*` (sole FS owner) remains open to the entire Main process —
 *   modules that need raw `atomicWriteFile` / `stat` etc. import from
 *   `@main/file/ops` directly. See `architecture.md §1.2`.
 * - `./watcher/*` exposes `createDirectoryWatcher()` as a consumable primitive
 *   for business modules (e.g. future NoteService).
 * - `./danglingCache.ts` is a file-module singleton; only queried via the
 *   DataApi handler or via FileManager side effects — not imported directly.
 *
 * If you find yourself reaching into `internal/`, the answer is almost
 * certainly "add a method to FileManager" instead.
 */

export type {
  AtomicWriteStream,
  CreateInternalEntryParams,
  EnsureExternalEntryParams,
  FileVersion,
  IFileManager,
  ReadResult
} from './FileManager'
export { StaleVersionError } from './FileManager'

// DanglingCache: interface and singleton are both exported for Phase 1b.3
// callers (DataApi handler, orphanSweep). External imports of the singleton
// should stay narrow — treat the barrel-exported value as read-only from
// outside the file module.
export type { DanglingCache, DanglingListener, ObservedPresence } from './danglingCache'
export { danglingCache } from './danglingCache'

// VersionCache: interface only. The runtime instance is a private field on
// FileManager and is not exposed via the barrel.
export type { VersionCache } from './versionCache'

// Watcher primitive — business modules (future NoteService, KB watcher, etc.)
// call `createDirectoryWatcher` directly. Not a lifecycle service.
export type {
  CreateDirectoryWatcherOptions,
  DirectoryWatcher,
  WatcherEvent,
  WatcherListener
} from './watcher'
export { createDirectoryWatcher } from './watcher'

// Projection helper: managed FileEntry → live on-disk FileInfo descriptor.
export { toFileInfo } from './toFileInfo'
