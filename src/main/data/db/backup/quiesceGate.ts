// Partial write-quiesce gate for restore.
//
// WHY: restore promotes a detached work.sqlite over the live DB via the preboot
// gate (#16884 atomic rename). Any write that lands on the live DB during the
// snapshot→promote window is lost (promotion overwrites the file). Full quiesce
// (a1 WindowManager `acquireMutationCapableWindowHold` + #17014 AI/channel pause)
// is deferred; PARTIAL quiesce (this PR) = this flag (IPC mutation reject) +
// `JobManager.pause` (#16925, refcounted hold) + best-effort in-flight drain.
//
// The flag is a module-level singleton. One restore at a time is enforced by
// `BackupService.activeOperation` UP TO seal; post-seal the operation slot is
// released while the flag stays held until the user-confirmed relaunch exits the
// process, and a second restore/export is blocked by the staged-journal guard in
// `startRestore`/`startBackup` (backup.* routes bypass this gate). The flag is
// set inside `startRestore`'s quiesceWriters callback and cleared by
// `BackupService.releaseRestoreQuiesce` — only by the invocation that set it.
// IPC entry points read `isBackupInProgress()` (DataApi IpcAdapter, returns an
// error envelope) or call `assertNotBackupInProgress()` (PreferenceService /
// IpcApiService, throw-based) to reject writes. Read-only requests are NOT gated
// — snapshot reads are safe and merge runs on a detached work.sqlite.
//
// RESIDUAL WRITE PATHS not covered by partial quiesce (documented in
// backup-architecture.md §9): legacy File_/Cache_ write IPC, legacy Backup_*
// restore (S3/local/WebDAV via LegacyBackupManager — a same-purpose sibling that
// can race a v2 restore if a user clicks legacy v1 restore mid-window), main-process
// `DbService` direct writes outside IPC, and un-drained AI/channel turns. The
// promotion gate remains the correctness backstop — partial quiesce narrows the
// race window, it does not remove it.

import { backupErrorCodes } from '@shared/ipc/errors/backup'
import { IpcError } from '@shared/ipc/errors/IpcError'

/**
 * True while a restore quiesce window is held — from quiesce acquisition until
 * either a pre-seal failure releases it or the post-seal relaunch exits the
 * process. Set inside `BackupService.startRestore`'s quiesceWriters; cleared only
 * by `BackupService.releaseRestoreQuiesce`.
 */
let backupInProgress = false

/** Restore sets the flag for the quiesce window (called by BackupService). */
export function setBackupInProgress(value: boolean): void {
  backupInProgress = value
}

/** IPC entry points read this to gate mutations during a restore. */
export function isBackupInProgress(): boolean {
  return backupInProgress
}

/**
 * Throw `BACKUP_IN_PROGRESS` if a restore quiesce window is held. For IPC entry
 * points whose error model is throw-based (`PreferenceService`,
 * `IpcApiService`). `DataApi`'s `IpcAdapter` uses `isBackupInProgress()` directly
 * because it returns a `DataApiError` response envelope rather than throwing.
 */
export function assertNotBackupInProgress(): void {
  if (backupInProgress) {
    throw new IpcError(
      backupErrorCodes.IN_PROGRESS,
      'backup: a restore is in progress — writes are paused until it completes'
    )
  }
}
