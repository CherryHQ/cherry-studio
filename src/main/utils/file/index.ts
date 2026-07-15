/**
 * `@main/utils/file` — entry-agnostic filesystem primitives for the main process.
 *
 * ## Layout
 *
 * This topic holds the main-process FS/path primitives, each reached through
 * this single barrel (naming-conventions.md §6.4 / main-process-architecture.md
 * §2.1) — consumers import `from '@main/utils/file'`, never a sub-path:
 *
 * - `./fs` — raw file IO (`read`, `write`, `atomicWriteFile`, `stat`, `copy`,
 *   `move`, `remove`, `hash`, `download`, …).
 * - `./metadata` — content-derived classification (`getFileType(path)`,
 *   `isTextFile`, `mimeToExt`).
 * - `./path` — path predicates (`isPathInside`, `isUnderInternalStorage`,
 *   `canWrite`, …).
 * - `./pathStatus` — `getPathStatus` + its result types.
 * - `./shell` — OS open / reveal (`open`, `showInFolder`).
 *
 * Related surfaces that live elsewhere (not here):
 * - Legacy v1 file helpers (`getFileExt`, `readTextFileWithAutoEncoding`,
 *   `getAllFiles`, …) → `@main/utils/legacyFile` — being dissolved into the
 *   primitives above as the v1 file stack retires.
 * - Directory-listing (`listDirectory`) and `.gitignore` parsing → next to
 *   their owner, `@main/services/file/tree`.
 *
 * ## Access policy for the FS primitives
 *
 * These are the **sole FS owners** for the main process — callers like
 * `BootConfigService`, the MCP OAuth flow, and any service that truly needs
 * raw `atomicWriteFile` / `stat` / `read` import them through this barrel. The
 * intent is "give everyone access to the **entry-agnostic** FS primitives",
 * not "offer a back door around FileManager". Concretely:
 *
 * - **Do NOT** write files under the internal-origin storage namespace
 *   (`application.getPath('feature.files.data', …)`) via these primitives.
 *   That region is FileManager's domain — bypassing it desyncs DanglingCache,
 *   versionCache, and the orphan sweep. Use `FileManager.createInternalEntry`
 *   / `writeIfUnchanged` instead.
 * - **Do NOT** mutate files a FileEntry references without going through
 *   FileManager (same reason).
 * - **OK** to use these for: temp workspaces, module-local storage (Notes,
 *   backups), OAuth token caches, MCP configs — anything outside the
 *   internal-origin storage region.
 *
 * They carry no DB awareness: they do not know about `file_entry`, do not
 * consult FileManager refs, and do not emit DanglingCache events. If you find
 * yourself needing any of those, the operation belongs on FileManager, not
 * here.
 */

export {
  atomicWriteFile,
  atomicWriteIfUnchanged,
  type AtomicWriteStream,
  compressImage,
  copy,
  createAtomicWriteStream,
  download,
  ensureDir,
  exists,
  hash,
  isSameFile,
  mkdir,
  move,
  type PathReadability,
  PathStaleVersionError,
  type PathVersion,
  probeReadable,
  read,
  remove,
  removeDir,
  shouldSilenceFsyncDirError,
  stat,
  write
} from './fs'
export { getFileType, isTextFile, mimeToExt } from './metadata'
export { canWrite, isNotEmptyDir, isPathInside, isUnderInternalStorage, resolvePath } from './path'
export { getPathStatus, type PathStatus, type PathStatusKind } from './pathStatus'
export { open, showInFolder } from './shell'
