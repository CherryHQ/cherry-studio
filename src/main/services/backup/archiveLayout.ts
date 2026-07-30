/**
 * On-disk layout contract for a Backup v2 `.cherrybackup` archive — the hard
 * boundary between the producer (Phase 1b-i, writes these entries) and admission
 * (Phase 1b-ii, reads them). Shared so the two sides can never disagree on entry
 * names.
 *
 * ```text
 * <name>.cherrybackup            (zip)
 * ├── manifest.json              (strict ManifestV2, at root)
 * ├── attestation.json           (OPTIONAL same-install MAC over manifest.json)
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

/**
 * OPTIONAL root entry carrying a MAC over `manifest.json` proving the archive
 * was produced by the restoring install ({@link ../attestation}). Its ABSENCE is
 * legal — archives written before this entry existed, and archives from another
 * install, simply are not self-attested — so admission must never require it.
 */
export const ATTESTATION_ENTRY = 'attestation.json'

/** Prefix under which every Full resource payload lives. */
export const RESOURCES_PREFIX = 'resources/'
