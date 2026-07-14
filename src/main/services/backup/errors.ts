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
 * Thrown by the restore archive-admission step until the safe-unpack track lands (plan 横切
 * archive admission): manifest schema + BACKUP_FORMAT_VERSION + domain/resource consistency +
 * schemaMigrationId chain compatibility + backup.sqlite integrity_check + entry allowlist
 * (zip-slip/symlink/hardlink escape) + size/byte budget + format/layout discriminator. Archive
 * admission MUST run before quiesce — restore stays fail-closed: NO snapshot is taken, NO
 * journal is written. Injected as a dep for spine testing.
 */
export class RestoreArchiveAdmissionNotImplementedError extends Error {
  constructor(message = 'restore archive admission not implemented — snapshot refused') {
    super(message)
    this.name = 'RestoreArchiveAdmissionNotImplementedError'
  }
}

/**
 * Thrown by archive admission (backup-architecture §9 step 0 format gate) when the
 * archive's `backupFormatVersion` major differs from BACKUP_FORMAT_VERSION. Raised
 * AFTER extracting ONLY manifest.json and BEFORE bulk-extracting payload, so a large
 * trusted-but-incompatible archive can't exhaust staging disk. Same-major additive
 * format extensions stay forward-compatible (unknown entries ignored, not rejected) —
 * only a major bump is incompatible.
 */
export class UnsupportedBackupFormatError extends Error {
  readonly found: number
  readonly expected: number
  constructor(found: number, expected: number) {
    super(`backup: unsupported archive format version ${found} (expected ${expected})`)
    this.name = 'UnsupportedBackupFormatError'
    this.found = found
    this.expected = expected
  }
}

/**
 * Thrown by archive admission (backup-architecture §9 step 0 schema comparison) when
 * backup.sqlite's applied migration chain is NOT a strict prefix of the bundled chain
 * — forked (A B′ C vs A B C), diverged (same length, a hash differs), ahead-of-code,
 * or a superset. The chain `folderMillis` is authoritative (NOT the manifest's
 * schemaMigrationId tip): drizzle migrate() is a silent no-op on ahead-of-chain, so a
 * tip-only check would let a forked DB vouch for itself. Carries producerAppVersion
 * for diagnostics. The strict-prefix case is handled by migrate-forward instead.
 */
export class NewerOrDivergedBackupError extends Error {
  readonly producerAppVersion: string
  constructor(
    producerAppVersion: string,
    message = 'backup: archive schema chain is forked or ahead of the bundled migrations'
  ) {
    super(message)
    this.name = 'NewerOrDivergedBackupError'
    this.producerAppVersion = producerAppVersion
  }
}

/**
 * Thrown by archive admission (backup-architecture §9 step 0 integrity check) when
 * `PRAGMA integrity_check` on the (migrated) backup.sqlite returns anything other than
 * 'ok'. The backup DB is structurally damaged and MUST NOT feed the merge engine.
 */
export class BackupIntegrityError extends Error {
  constructor(message = 'backup: integrity_check failed on archive database') {
    super(message)
    this.name = 'BackupIntegrityError'
  }
}

/**
 * Thrown by archive admission (backup-architecture §9 step 0) for structural archive
 * corruption that is NOT a schema-version decision: a zip-slip entry (escape attempt),
 * a missing __drizzle_migrations table (tampered/empty backup DB), an empty applied
 * chain, a raw drizzle migrate-forward error, or a malformed manifest/zip. Trusted-
 * backup model — this is "the archive is not a valid .cbu", not "the archive is
 * malicious" (DoS/DDL-equality hardening is a separate task).
 */
export class BackupArchiveCorruptError extends Error {
  constructor(message = 'backup: archive is corrupt or malformed') {
    super(message)
    this.name = 'BackupArchiveCorruptError'
  }
}

/**
 * Thrown by the restore file-resource staging step until the (e) track lands (restoreResources
 * two-phase contract + path containment + FileResource journal entries). Staging + sealing MUST
 * run before the 2nd fingerprint — restore stays fail-closed: NO staged journal is written
 * without file-resource staging (independently of the merge stub). Injected as a dep for testing.
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
