/**
 * `@main/utils/file` — file-related utilities for the main process.
 *
 * ## Layout
 *
 * - `./legacyFile` — shared helpers (`getFileType(ext)`, `getFileExt`,
 *   `sanitizeFilename`, `readTextFileWithAutoEncoding`, `getAllFiles`,
 *   `pathExists`, `directoryExists`, `isPathInside`, `untildify`,
 *   `hasWritePermission`, `resolveAndValidatePath`, …). Re-exported through
 *   this barrel; callers import with `from '@main/utils/file'`.
 * - `./{fs,metadata,path,pathStatus,shell}` — pure FS primitives. Access via
 *   **explicit subpath imports**, e.g.
 *   `import { atomicWriteFile } from '@main/utils/file/fs'`. Not re-exported
 *   through the barrel to avoid symbol collisions with legacy helpers
 *   (notably `getFileType`, which has different signatures in the two
 *   modules: legacy takes an extension, primitive takes a path).
 * - Directory-listing (`listDirectory`) and `.gitignore` parsing live next
 *   to the consumer that owns them: `@main/services/file/tree/{search,gitignore}`.
 *   See `src/main/services/file/tree/` for that surface.
 *
 * These modules will consolidate over time — `legacyFile.ts` and the sibling
 * `../fileOperations.ts` are expected to be split into the primitive modules
 * above (fs/metadata/path/…), after which this barrel can expose the
 * primitive surface directly.
 *
 * ## Access policy for the FS primitives (fs/metadata/path/shell)
 *
 * These are the **sole FS owners** for the main process — callers like
 * `BootConfigService`, the MCP OAuth flow, and any service that truly needs
 * raw `atomicWriteFile` / `stat` / `listDirectory` import them directly. The
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
 * consult `file_ref`, and do not emit DanglingCache events. If you find
 * yourself needing any of those, the operation belongs on FileManager, not
 * here.
 */

export * from './legacyFile'
