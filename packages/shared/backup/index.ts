/**
 * Backup Module — Unified Export
 * V2 architecture: VACUUM INTO + selective restore
 */

export type {
  BackupOptions,
  BackupProgress,
  BackupStatistics,
  RestoreOptions,
  RestoreProgress,
  RestoreStatistics,
  ValidationOptions
} from './options.js'
export { CompressionLevel, ConflictStrategy } from './options.js'
export type { BackupFileEntry, BackupManifest, BackupMode, DomainStats } from './types.js'
export { BACKUP_MANIFEST_VERSION, BackupDomain } from './types.js'
export type {
  BackupValidator,
  ValidationContext,
  ValidationError,
  ValidationResult,
  ValidationSummary
} from './validation.js'
export { ValidationErrorCode } from './validation.js'
