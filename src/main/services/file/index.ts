/**
 * File module — public surface.
 *
 * The file module uses a **facade + private internals** pattern. This barrel is
 * the module's single public door: everything outside `@main/services/file`
 * imports from here, never from an internal path (`./internal/*`, `./tree/*`,
 * `./utils/*`, `./watcher`, …).
 *
 * - `FileManager` and `DirectoryTreeManager` are lifecycle services
 *   (`@Injectable`, `@ServicePhase(Phase.WhenReady)`). Their **classes** are
 *   exported here for the composition root (`serviceRegistry`) to register —
 *   exactly like the feature barrels (`@main/features/knowledge` →
 *   `KnowledgeService`). Runtime code resolves the singletons via
 *   `application.get('FileManager')` / `application.get('DirectoryTreeManager')`;
 *   do not `new` them or call methods off these exports directly.
 * - Implementation lives under `./internal/*` (entry / content / system ops),
 *   `./tree/*`, `./utils/*`, and `./watcher.ts` as private modules. They are
 *   reached only through this barrel — the narrow public helpers below
 *   (`dispatchHandle`, `getMetadataByPath`, `listDirectory`, …) re-export the
 *   specific operations outside callers legitimately need.
 * - Pure FS / path / metadata primitives live under `@main/utils/file` (sole FS
 *   owner, open to the entire Main process). Modules that need raw
 *   `atomicWriteFile` / `stat` etc. import that barrel directly.
 * - `./watcher.ts` exposes `createDirectoryWatcher()` as a consumable primitive
 *   for business modules (e.g. future NoteService). Not a lifecycle service.
 * - `./danglingCache.ts` is a file-module singleton; only queried via the
 *   DataApi handler or via FileManager side effects.
 *
 * If you find yourself reaching into an internal path, the answer is almost
 * certainly "add a FileManager method or expose a narrow helper here" instead.
 */

// Service classes — exported for the composition root (serviceRegistry) to
// register. Runtime code uses `application.get(...)`, not these exports.
export type {
  AtomicWriteStream,
  CreateInternalEntryParams,
  EnsureExternalEntryParams,
  FileVersion,
  IFileManager,
  ReadResult
} from './FileManager'
export { FileManager } from './FileManager'
export { StaleVersionError } from './FileManager'
export { DirectoryTreeManager } from './tree/DirectoryTreeManager'

// DanglingCache: interface and singleton are both exported for in-process
// callers (orphanSweep, business services querying live state). External
// imports of the singleton should stay narrow — treat the barrel-exported
// value as read-only from outside the file module.
export type {
  DanglingCache,
  DanglingCacheOptions,
  DanglingListener,
  DanglingStateChangedEvent,
  ObservedPresence
} from './danglingCache'
export { createDanglingCacheImpl, danglingCache } from './danglingCache'

// VersionCache: interface only. The runtime instance is a private class
// field on each `FileManager` (not a module singleton) and is not exposed
// via the barrel — see file-manager-architecture.md §1.6.1 / §12.
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

// Path-level system helpers. `safeOpen` is the public default-open primitive;
// raw Electron shell access remains internal to the file module.
export { safeOpen, showInFolder } from './system'

// Handle dispatch — resolves a `FileHandle` to its operation. The public
// entry point for the File IPC handlers (kept out of `internal/` deep imports).
export { dispatchHandle } from './internal/dispatch'

// Live on-disk metadata by path (`fs.stat` projection). Consumed by the File
// IPC batch-metadata handler.
export { getMetadataByPath } from './utils/metadata'

// Directory listing primitives. Consumed by legacy IPC directory routes
// (pending IpcApi migration).
export { listDirectory, listDirectoryEntries } from './tree/search'
