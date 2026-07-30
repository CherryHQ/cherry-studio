import { MAX_RESOURCE_INSTALL_ENTRIES } from '@data/db/restore/restoreLimits'
import { RELATIVE_SUBPATH_LIMITS } from '@main/utils/relativePath'

/**
 * Frozen operating ceilings for the Backup v2 format contract
 * (docs/references/backup/README.md §5.3). One source of truth: preflight
 * (Phase 1b/3), archive admission (Phase 1b), and the resource-path validator
 * ({@link ./resourcePaths}) all read these same constants, so a single edit
 * moves every gate together and admission can never be looser than preflight.
 *
 * Each ceiling is a deliberate ceiling, not a tuned value; raise one only with
 * a stated reason. `maxPathDepth`/`maxPathLength` mirror the generic
 * `RELATIVE_SUBPATH_LIMITS` so the archive/admission path bound and the
 * schema-level subpath bound cannot drift apart.
 */
export const BACKUP_CEILINGS = Object.freeze({
  /** Cap on total archive entries walked after the ZIP catalog is parsed. */
  maxArchiveEntries: 100_000,
  /**
   * Cap on `resource-install` units in one restore (bounds preboot work).
   * Owned by the data-layer restore module (`restoreLimits.ts`) because the
   * journal schema enforces it and cannot import upward from here; re-consumed
   * so preflight/admission and the journal share one source.
   */
  maxResourceInstallEntries: MAX_RESOURCE_INSTALL_ENTRIES,
  /**
   * Max bytes of `manifest.json` read before parsing. This single pre-parse
   * cap — enforced at admission (Phase 1b) — is what bounds every unbounded
   * manifest array (`producer.managedRoots`, `resourceRequirements`,
   * `resourcePayloads`, `degradations`), so those arrays carry no arbitrary
   * per-array count limit in the schema.
   *
   * BECAUSE those arrays scale with the profile, this cap is NOT independent of
   * {@link maxResourceInstallEntries}: a manifest at that ceiling measures
   * ~14 MiB of payload entries plus ~5 MiB of requirement entries. The original
   * 1 MiB was therefore self-contradictory — it made an archive at the frozen
   * install ceiling unproducible, and broke export for any profile past
   * ~8,000 attachments, which is an ordinary library rather than an attack.
   * 32 MiB clears the measured worst case with headroom while staying a bounded
   * pre-parse read of an entry whose declared size admission already verified.
   * `manifestBudget.test.ts` builds a manifest at the install ceiling so the two
   * constants can never silently drift apart again.
   */
  maxManifestBytes: 32 * 1024 ** 2,
  /** Max segments in any archive/journal relative path. */
  maxPathDepth: RELATIVE_SUBPATH_LIMITS.maxDepth,
  /** Max character length of any archive/journal relative path. */
  maxPathLength: RELATIVE_SUBPATH_LIMITS.maxLength,
  /**
   * Max uncompressed bytes for a single extracted entry (8 GiB). Matches the
   * proven #17206 admission limit (`admitArchive.ts` DEFAULT limits) so a
   * previously-exportable large blob (e.g. a big Knowledge source) stays
   * admissible; do not reduce without evidence of a smaller real ceiling.
   * Upgrade trigger: a legitimate single payload approaching 8 GiB.
   */
  maxEntryUncompressedBytes: 8 * 1024 ** 3,
  /** Max cumulative uncompressed bytes across all extracted entries (32 GiB, per #17206). */
  maxTotalUncompressedBytes: 32 * 1024 ** 3,
  /** Soft ZIP-bomb gate: uncompressed:compressed ratio ceiling. */
  maxCompressionRatio: 1000,
  /** Free-space headroom required over the declared uncompressed total before staging (512 MiB). */
  minStagingDiskHeadroomBytes: 512 * 1024 ** 2
} as const)

export type BackupCeilings = typeof BACKUP_CEILINGS

/**
 * Entries an archive may carry besides its resource payloads: `manifest.json`,
 * `backup.sqlite`, and the optional `attestation.json`. Both the staging
 * preflight and publication reserve them against
 * {@link BACKUP_CEILINGS.maxArchiveEntries}, so the two cannot disagree about how
 * much room the payloads actually have. The optional entry is reserved
 * unconditionally: over-reserving one slot costs nothing, while making the
 * reservation depend on whether this install can attest would let one archive's
 * payload budget differ from another's.
 */
export const FIXED_ARCHIVE_ENTRIES = 3

/**
 * Pre-read bound on `attestation.json` (docs/references/backup/README.md §5.3).
 *
 * Not a member of {@link BACKUP_CEILINGS} because it is not an operating
 * ceiling that scales with a profile: the entry is one fixed-shape JSON object
 * with a 64-char hex MAC, so 4 KiB is already orders of magnitude of headroom.
 * Enforced on the declared size before extraction and again as the streaming cap.
 */
export const MAX_ATTESTATION_ENTRY_BYTES = 4 * 1024
