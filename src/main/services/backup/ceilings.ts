import { RELATIVE_SUBPATH_LIMITS } from '@main/utils/relativePath'

/** Frozen ceilings for the two-entry Lite archive admission boundary. */
export const BACKUP_CEILINGS = Object.freeze({
  // The layout accepts exactly two entries; this remains a generic catalog guard.
  maxArchiveEntries: 100_000,
  // The manifest has a bounded producer-root/migration-chain payload only.
  maxManifestBytes: 1024 * 1024,
  maxPathDepth: RELATIVE_SUBPATH_LIMITS.maxDepth,
  maxPathLength: RELATIVE_SUBPATH_LIMITS.maxLength,
  maxEntryUncompressedBytes: 8 * 1024 ** 3,
  maxTotalUncompressedBytes: 32 * 1024 ** 3,
  maxCompressionRatio: 1000,
  minStagingDiskHeadroomBytes: 512 * 1024 ** 2
} as const)

export type BackupCeilings = typeof BACKUP_CEILINGS
