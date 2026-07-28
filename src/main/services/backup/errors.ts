// Backup-specific errors thrown by the export and import (restore) pipelines.

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

/**
 * Thrown when the output path already exists (no-clobber). archive.ts detects this at
 * publish time (link/EEXIST) — the TOCTOU-safe backstop behind BackupService.validateOutputPath's
 * entry check, which can race a file appearing between entry and archive completion.
 * BackupService.toIpcError maps it to BACKUP_OUTPUT_PATH_EXISTS so the renderer sees a
 * stable code regardless of which check fires.
 */
export class OutputPathExistsError extends Error {
  constructor(outputPath: string) {
    super(`backup: outputPath already exists (no-clobber): ${outputPath}`)
    this.name = 'OutputPathExistsError'
  }
}

/**
 * Thrown by the restore merge step until the 14-domain detached merge engine
 * (additive + remote-fills-local-empty, conflict policy, FK/FTS integrity) lands.
 * The ImportOrchestrator spine is wired and tested independently; production
 * restore stays fail-closed — NO staged journal is written without a real merge,
 * so a half-restored state can never reach the preboot promotion gate.
 *
 * Injected as a dep so the spine is testable with a no-op merge.
 */
export class RestoreMergeNotImplementedError extends Error {
  constructor(message = 'restore merge engine not implemented — staged journal refused') {
    super(message)
    this.name = 'RestoreMergeNotImplementedError'
  }
}

/**
 * Thrown by the restore quiesce step until #16849 (AI/channel) + #16850 (JobManager)
 * land the `pause()` + `drainInFlight()` writer-quiesce contract. Without quiesce,
 * the live-DB fingerprint captured for the staged journal can be invalidated by an
 * in-flight writer before the gate re-checks it — so restore stays fail-closed:
 * NO snapshot is taken, NO journal is written. Injected as a dep for spine testing.
 */
export class RestoreQuiesceNotImplementedError extends Error {
  constructor(message = 'restore write-quiesce not implemented (#16849/#16850) — snapshot refused') {
    super(message)
    this.name = 'RestoreQuiesceNotImplementedError'
  }
}

/**
 * Thrown by restore resource staging when an archive contains a resource kind whose
 * consistency/promotion policy has not landed. SKILLS directory adds are supported;
 * file blobs, knowledge directories, and Notes remain fail-closed.
 */
export class RestoreStagingNotImplementedError extends Error {
  constructor(message = 'restore file-resource staging not implemented (plan (e)) — journal refused') {
    super(message)
    this.name = 'RestoreStagingNotImplementedError'
  }
}

/**
 * Thrown when the second live-DB fingerprint (re-captured just before writing the
 * staged journal) does not match the value captured before createSnapshot. A mismatch
 * means a writer touched the live DB during staging — the journal is NOT written and
 * all staging is cleaned up. The preboot gate re-checks the fingerprint anyway; this
 * is an early abort to avoid wasting a relaunch on a restore the gate would expire.
 */
export class RestoreFingerprintMismatchError extends Error {
  constructor(captured: string, recomputed: string) {
    super(
      `restore fingerprint mismatch — live DB changed during staging (captured=${captured.slice(0, 12)}…, recomputed=${recomputed.slice(0, 12)}…)`
    )
    this.name = 'RestoreFingerprintMismatchError'
  }
}

/** Thrown when an archive uses a backup format major this build cannot restore. */
export class UnsupportedBackupFormatError extends Error {
  readonly found: number
  readonly expected: number

  constructor(found: number, expected: number) {
    super(`backup format version ${found} is unsupported (expected ${expected})`)
    this.name = 'UnsupportedBackupFormatError'
    this.found = found
    this.expected = expected
  }
}

/** Thrown when the archive migration chain is newer than or diverges from this build. */
export class NewerOrDivergedBackupError extends Error {
  readonly producerAppVersion: string

  constructor(producerAppVersion: string) {
    super(`backup schema is newer than or diverges from this build (producer ${producerAppVersion})`)
    this.name = 'NewerOrDivergedBackupError'
    this.producerAppVersion = producerAppVersion
  }
}

/** Thrown when SQLite reports structural corruption in an admitted backup database. */
export class BackupIntegrityError extends Error {
  constructor(message: string) {
    super(`backup integrity check failed: ${message}`)
    this.name = 'BackupIntegrityError'
  }
}

/** Thrown when an archive cannot be safely unpacked or validated. */
export class BackupArchiveCorruptError extends Error {
  constructor(message: string) {
    super(`backup archive is corrupt: ${message}`)
    this.name = 'BackupArchiveCorruptError'
  }
}
