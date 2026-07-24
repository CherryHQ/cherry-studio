/**
 * Backup storage configs (WebDAV / S3). Cross-process: the renderer manages
 * these via settings UI and the main process consumes them in the backup
 * services; both sides pass them across the IPC boundary.
 */

export type WebDavConfig = {
  webdavHost: string
  webdavUser?: string
  webdavPass?: string
  webdavPath?: string
  fileName?: string
  skipBackupFile?: boolean
  disableStream?: boolean
}

export type S3Config = {
  endpoint: string
  region: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  root?: string
  fileName?: string
  skipBackupFile: boolean
  autoSync: boolean
  syncInterval: number
  maxBackups: number
}

/**
 * V2 export progress update, emitted during export/restore. Progress is UI-only —
 * never participates in correctness. The renderer
 * routes updates by `backupId` (the startBackup return value, also the cancel key).
 *
 * `phase` is the coarse pipeline step; export uses `snapshot` (DB copy), `collect`
 * (resolve / strip / collect / stage), and `archive` (assembleArchive). Restore-only
 * phases (quiesce / merge / verify / journal / relaunch) are unused by export.
 */
export interface BackupProgressUpdate {
  readonly backupId: string
  readonly phase:
    | 'preflight'
    | 'collect'
    | 'snapshot'
    | 'archive'
    | 'quiesce'
    | 'merge'
    | 'verify'
    | 'journal'
    | 'relaunch'
  readonly current: number
  readonly total: number
  readonly message?: string
}

/** Result of BackupV2_StartBackup — `backupId` is the cancel/progress routing key. */
export interface BackupV2StartResult {
  readonly backupId: string
  readonly archivePath: string
}

/**
 * Restore result summary shown in the relaunch-confirm dialog BEFORE promotion
 * applies. Promotion hasn't run yet at this point (preboot may expire the whole
 * batch via assertNoAddConflicts), so UI copy MUST use future tense
 * ("will restore / will skip"), never "restored".
 *
 * Main→renderer event payload (TCB source → pure type, not zod-parsed).
 * `toSkip` mirrors plan.skips 1:1 (see @main/services/backup/resourcePlanning).
 */
export interface RestoreResultSummary {
  readonly toRestore: ReadonlyArray<{ readonly kind: string; readonly count: number }>
  readonly toSkip: ReadonlyArray<{ readonly id: string; readonly kind: string; readonly reason: string }>
}
