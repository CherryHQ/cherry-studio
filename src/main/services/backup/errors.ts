// Backup-specific errors thrown by the export pipeline.

/**
 * Thrown when the preflight disk-space check finds insufficient room for the
 * export (DB copy + archive). Raised at the entry of BackupService.startBackup,
 * BEFORE any copy/archive work begins, so a disk-full surfaces as a clear error
 * rather than a mid-export SQLITE_FULL (disk budget).
 */
export class InsufficientDiskSpaceError extends Error {
  readonly needed: number
  readonly available: number
  constructor({ needed, available }: { needed: number; available: number }) {
    super(
      `Insufficient disk space for backup: needed ~${needed} bytes (DB copy + archive), available ${available} bytes`
    )
    this.name = 'InsufficientDiskSpaceError'
    this.needed = needed
    this.available = available
  }
}

/**
 * Thrown by ExportOrchestrator when an AbortSignal is already aborted at a step
 * boundary ( BackupV2_CancelBackup ). Propagates out of exportBackup so BackupService
 * can distinguish cancellation from real failure — the temp-copy + staging cleanup
 * still runs (finally block) either way.
 */
export class BackupCancelledError extends Error {
  constructor(message = 'Backup cancelled by the user') {
    super(message)
    this.name = 'BackupCancelledError'
  }
}

/**
 * Thrown when the disk fills up mid-archive (preflight passed but the volume ran out
 * during the write stream — typically external blobs whose size is NULL in
 * file_entry.size and so not counted in preflight). Disk budget (BackupService.preflightDisk):
 * archive writeStream ENOSPC is wrapped to DiskFullError so the
 * renderer surfaces a clear "disk full" message rather than a raw errno.
 */
export class DiskFullError extends Error {
  constructor(message = 'Disk became full mid-archive') {
    super(message)
    this.name = 'DiskFullError'
  }
}
