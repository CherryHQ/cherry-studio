// Partial write-quiesce gate for restore.
//
// WHY: restore promotes a detached work.sqlite over the live DB via the preboot
// gate (#16884 atomic rename). Any write that lands on the live DB during the
// snapshot→promote window is lost (promotion overwrites the file). Quiesce =
// a1 WindowManager `acquireMutationCapableWindowHold` (destroys mutation-capable
// renderer windows) + #17014 AI/channel/Agent/Job pause+drainInFlight (gates new
// turns AND drains in-flight ones, fail-closed on stragglers) + this flag (IPC
// mutation reject: legacy File_/Cache_/Backup_* + DataApi/Preference/IpcApi) +
// `JobManager.pause` (#16925, refcounted hold). RESIDUAL: DataApi/Preference/
// IpcApi dispatcher in-flight drain + DbService direct writes — see below.
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
// backup-architecture.md §9): legacy File_/Cache_/Backup_* mutation IPC are now
// GATED (rejectDuringRestore in ipc.ts + CacheService Cache_Sync silent-drop +
// Backup_*Restore* wrap — they reject NEW writes during the window). AI stream /
// agent runtime / channel / JobManager writers ARE fully drained (#17014 +
// BackupService.quiesceWriters calls pause+drainInFlight on each, fail-closed
// RESTORE_DRAIN_UNCLEAN on stragglers). The remaining gap: DataApi/Preference/
// IpcApi dispatcher in-flight accounting is pending (@DeJeune) — writes already
// past the IPC gate but not yet committed — and main-process `DbService` direct
// writes outside IPC are un-drained. The promotion gate remains the correctness
// backstop — partial quiesce narrows the race window, it does not remove it.

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
