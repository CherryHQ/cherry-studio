/**
 * On-disk layout contract for a Backup v2 `.cherrybackup` archive — the hard
 * boundary between the producer (Phase 1b-i, writes these entries) and admission
 * (Phase 1b-ii, reads them). Shared so the two sides can never disagree on entry
 * names.
 *
 * ```text
 * <name>.cherrybackup            (zip)
 * ├── manifest.json              (strict ManifestV2, at root)
 * ├── backup.sqlite              (portable DB snapshot)
 * └── resources/<payload...>     (Full only; per-payload archivePath under here)
 * ```
 */

/** File extension of a published archive. */
export const ARCHIVE_EXTENSION = '.cherrybackup'

/** Root manifest entry. */
export const MANIFEST_ENTRY = 'manifest.json'

/** Portable DB payload entry. */
export const DB_ENTRY = 'backup.sqlite'

/** Prefix under which every Full resource payload lives. */
export const RESOURCES_PREFIX = 'resources/'

/**
 * A Knowledge resource unit is a single `{baseId}` directory whose ONLY excluded
 * artifact is its rebuildable index at the unit ROOT: `.cherry/index.sqlite`,
 * `.cherry/index.sqlite-wal`, `.cherry/index.sqlite-shm` (docs §6.7). This
 * predicate matches ONLY those exact unit-root-relative paths — a nested
 * `sub/.cherry/index.sqlite` (or any other `.cherry` content) is authoritative
 * and is NEVER dropped. It is applied only when a caller opts into
 * `excludeKnowledgeDerivedIndex` (the Knowledge adapter), never generically.
 */
const KNOWLEDGE_ROOT_DERIVED_INDEX = new Set([
  '.cherry/index.sqlite',
  '.cherry/index.sqlite-wal',
  '.cherry/index.sqlite-shm'
])

export function isKnowledgeDerivedIndexPath(relPath: string): boolean {
  return KNOWLEDGE_ROOT_DERIVED_INDEX.has(relPath)
}
