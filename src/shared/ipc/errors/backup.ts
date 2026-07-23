/** Backup-domain IpcApi error codes. Import directly from this module on both sides. */
export const backupErrorCodes = {
  /** Archive bytes failed structural or manifest integrity checks. */
  ARCHIVE_CORRUPT: 'BACKUP_ARCHIVE_CORRUPT',
  /** User or shutdown aborted an in-flight export/restore. */
  CANCELLED: 'BACKUP_CANCELLED',
  /** Disk full during export or restore (ENOSPC / SQLITE_FULL). */
  DISK_FULL: 'BACKUP_DISK_FULL',
  /** A restore is in progress — mutating IPC is paused until it completes. */
  IN_PROGRESS: 'BACKUP_IN_PROGRESS',
  /** Export preflight: destination lacks headroom for the planned archive. */
  INSUFFICIENT_DISK: 'BACKUP_INSUFFICIENT_DISK',
  /** Post-admission integrity check failed before promote. */
  INTEGRITY_FAILED: 'BACKUP_INTEGRITY_FAILED',
  /** IPC caller is not a managed window (senderId missing). */
  INVALID_SENDER: 'BACKUP_INVALID_SENDER',
  /** Restore merge requested an unsupported strategy. */
  MERGE_STRATEGY_UNSUPPORTED: 'BACKUP_MERGE_STRATEGY_UNSUPPORTED',
  /** Archive was produced by a newer or diverged app build. */
  NEWER_OR_DIVERGED: 'BACKUP_NEWER_OR_DIVERGED',
  /** Export target already exists and overwrite was not requested. */
  OUTPUT_PATH_EXISTS: 'BACKUP_OUTPUT_PATH_EXISTS',
  /** Export outputPath parent is missing, inaccessible, or not a directory. */
  OUTPUT_PATH_INVALID: 'BACKUP_OUTPUT_PATH_INVALID',
  /** JobManager drain returned stragglers or pending startup recovery. */
  RESTORE_DRAIN_UNCLEAN: 'BACKUP_RESTORE_DRAIN_UNCLEAN',
  /** Full archive restore is gated until resource staging lands. */
  RESTORE_FULL_NOT_SUPPORTED: 'BACKUP_RESTORE_FULL_NOT_SUPPORTED',
  /** Manifest claims lite but carries full resource fields. */
  RESTORE_LITE_INVARIANT_VIOLATED: 'BACKUP_RESTORE_LITE_INVARIANT_VIOLATED',
  /** A prior restore journal is still staged or promoting. */
  RESTORE_PENDING: 'BACKUP_RESTORE_PENDING',
  /** Export outputPath targets an app-managed directory. */
  UNSAFE_OUTPUT_PATH: 'BACKUP_UNSAFE_OUTPUT_PATH',
  /** Archive backupFormatVersion is not supported. */
  UNSUPPORTED_FORMAT: 'BACKUP_UNSUPPORTED_FORMAT'
} as const
