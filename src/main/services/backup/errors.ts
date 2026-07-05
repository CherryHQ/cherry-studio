// Backup-specific errors thrown by the export pipeline.

/**
 * Thrown when the preflight disk-space check finds insufficient room for the
 * export (DB copy + archive). Raised at the entry of BackupService.startBackup,
 * BEFORE any copy/archive work begins, so a disk-full surfaces as a clear error
 * rather than a mid-export SQLITE_FULL (spec export-orchestrator.md §磁盘预算).
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
