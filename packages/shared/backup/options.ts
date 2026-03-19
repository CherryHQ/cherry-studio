/**
 * Backup and Restore Options
 * Configuration options for backup/restore operations
 */

/**
 * Strategy for handling ID conflicts during restore
 */
export enum ConflictStrategy {
  /** Skip items that would cause conflicts */
  SKIP = 'skip',
  /** Overwrite existing items with the same ID */
  OVERWRITE = 'overwrite',
  /** Generate a new ID for conflicting items */
  RENAME = 'rename',
  /** Merge conflicting items (domain-specific logic) */
  MERGE = 'merge'
}

/**
 * Strategy for merging data during restore
 */
export enum MergeStrategy {
  /** Prefer source data (from backup) */
  PREFER_SOURCE = 'prefer_source',
  /** Prefer target data (existing) */
  PREFER_TARGET = 'prefer_target',
  /** Combine arrays, prefer non-null values for objects */
  COMBINE = 'combine',
  /** Create a union of keys with combined values */
  UNION = 'union'
}

/**
 * Compression level for backup archives
 */
export enum CompressionLevel {
  /** No compression (stored only) */
  NONE = 0,
  /** Fastest compression */
  FAST = 1,
  /** Balanced compression */
  NORMAL = 5,
  /** Maximum compression (slower) */
  MAXIMUM = 9
}

/**
 * Options for creating a backup
 */
export interface BackupOptions {
  /** Domains to include in the backup (all if empty) */
  domains?: string[]
  /** Compression level */
  compressionLevel?: CompressionLevel
  /** Include files attached to messages/topics */
  includeFiles?: boolean
  /** Encrypt the backup with a password */
  encryptionPassword?: string
  /** Strategy for handling ID conflicts */
  conflictStrategy?: ConflictStrategy
  /** Create an incremental backup (requires chainId) */
  incremental?: boolean
  /** Chain ID for incremental backups */
  chainId?: string
  /** Progress callback */
  onProgress?: (progress: BackupProgress) => void
}

/**
 * Progress update during backup/restore
 */
export interface BackupProgress {
  /** Current phase of the operation */
  phase: 'init' | 'scanning' | 'exporting' | 'compressing' | 'finalizing' | 'complete'
  /** Current domain being processed */
  domain?: string
  /** Overall progress percentage (0-100) */
  overallProgress: number
  /** Progress within current domain (0-100) */
  domainProgress: number
  /** Items processed so far */
  itemsProcessed: number
  /** Total items to process */
  totalItems: number
  /** Bytes processed so far */
  bytesProcessed: number
  /** Estimated time remaining in milliseconds */
  estimatedTimeRemaining?: number
  /** Current operation message */
  message?: string
}

/**
 * Options for restoring a backup
 */
export interface RestoreOptions {
  /** Domains to restore (all if empty) */
  domains?: string[]
  /** Password for encrypted backups */
  encryptionPassword?: string
  /** Strategy for handling ID conflicts */
  conflictStrategy?: ConflictStrategy
  /** Merge strategy for conflicting data */
  mergeStrategy?: MergeStrategy
  /** Validate only, don't actually restore */
  validateOnly?: boolean
  /** Restore files attached to messages/topics */
  restoreFiles?: boolean
  /** Progress callback */
  onProgress?: (progress: RestoreProgress) => void
}

/**
 * Progress update during restore
 */
export interface RestoreProgress {
  /** Current phase of the operation */
  phase: 'init' | 'validating' | 'decompressing' | 'importing' | 'linking' | 'complete'
  /** Current domain being processed */
  domain?: string
  /** Overall progress percentage (0-100) */
  overallProgress: number
  /** Progress within current domain (0-100) */
  domainProgress: number
  /** Items processed so far */
  itemsProcessed: number
  /** Total items to process */
  totalItems: number
  /** Bytes processed so far */
  bytesProcessed: number
  /** Estimated time remaining in milliseconds */
  estimatedTimeRemaining?: number
  /** Current operation message */
  message?: string
}

/**
 * Options for validation operations
 */
export interface ValidationOptions {
  /** Check file integrity (checksums) */
  checkIntegrity?: boolean
  /** Verify manifest is well-formed */
  checkManifest?: boolean
  /** Check that all referenced files exist */
  checkFiles?: boolean
  /** Verify encryption (if present) */
  checkEncryption?: boolean
  /** Abort on first error or collect all errors */
  collectAllErrors?: boolean
}

/**
 * Backup statistics after completion
 */
export interface BackupStatistics {
  /** Total duration in milliseconds */
  duration: number
  /** Total bytes before compression */
  rawSize: number
  /** Total bytes after compression */
  compressedSize: number
  /** Compression ratio */
  compressionRatio: number
  /** Number of items backed up per domain */
  domainCounts: Record<string, number>
  /** Number of files included */
  fileCount: number
  /** Whether backup was encrypted */
  encrypted: boolean
}

/**
 * Restore statistics after completion
 */
export interface RestoreStatistics {
  /** Total duration in milliseconds */
  duration: number
  /** Number of items restored per domain */
  domainCounts: Record<string, number>
  /** Number of conflicts encountered */
  conflictCount: number
  /** Number of conflicts resolved */
  resolvedCount: number
  /** Number of items skipped */
  skippedCount: number
  /** Number of files restored */
  fileCount: number
  /** Number of errors encountered */
  errorCount: number
}
