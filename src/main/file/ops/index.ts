/**
 * `ops/*` — pure FS / path / metadata / search primitives.
 *
 * ## Access policy
 *
 * `ops/*` is the **sole FS owner** for the file module but is deliberately
 * open to the entire Main process — callers like `BootConfigService`, the
 * MCP OAuth flow, and any service that truly needs raw `atomicWriteFile` /
 * `stat` / `listDirectory` import directly from `@main/file/ops`.
 *
 * The intent is "give everyone access to the **unmanaged** FS primitives",
 * not "offer a back door around FileManager". Concretely:
 *
 * - **Do NOT** write files under the managed storage namespace
 *   (`application.getPath('feature.files.data', …)`) via `ops/*`. That region
 *   is FileManager's domain — bypassing it desyncs DanglingCache, versionCache,
 *   and the orphan sweep. Use `FileManager.createInternalEntry` /
 *   `writeIfUnchanged` instead. A future `ops.path.isUnderManagedStorage`
 *   guard (Phase 1b.1) will make this boundary detectable in dev mode.
 * - **Do NOT** mutate files a FileEntry references without going through
 *   FileManager (same reason).
 * - **OK** to use `ops/*` for: temp workspaces, module-local storage (Notes,
 *   backups), OAuth token caches, MCP configs — anything outside the managed
 *   storage region.
 *
 * ## No DB awareness
 *
 * `ops/*` is pure FS + path — it does not know about `file_entry`, does not
 * consult `file_ref`, and does not emit DanglingCache events. If you find
 * yourself needing any of those, the operation belongs on FileManager, not
 * here.
 */

export * from './fs'
export * from './metadata'
export * from './path'
export * from './search'
export * from './shell'
