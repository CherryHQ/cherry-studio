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
 * Resource class for restore planning + disclosure. Shared (main + renderer) so the
 * plan's `SkippedResource.kind` and the IPC `RestoreResultSummary.kind` agree, and
 * knowledge vs skill (both `dir-add` in FileResource) stay distinguishable in the UI.
 */
export type ResourceClass = 'file' | 'knowledge' | 'skill' | 'note'

/**
 * Restore result summary shown in the relaunch-confirm dialog BEFORE promotion
 * applies. Promotion hasn't run yet at this point (preboot may expire the whole
 * batch via assertNoAddConflicts), so UI copy MUST use future tense
 * ("will restore / will skip"), never "restored".
 *
 * Main→renderer event payload (TCB source → pure type, not zod-parsed).
 * `toRestore` is pre-computed by planning (not reverse-derived from resources,
 * which can't separate knowledge vs skill — both are `dir-add`). `toSkip` mirrors
 * plan.skips 1:1 (see @main/services/backup/resourcePlanning).
 */
export interface RestoreResultSummary {
  readonly toRestore: ReadonlyArray<{ readonly kind: ResourceClass; readonly count: number }>
  readonly toSkip: ReadonlyArray<{ readonly id: string; readonly kind: ResourceClass; readonly reason: string }>
}

/**
 * Current restore journal outcome, returned by `backup.restore_status` so the
 * UI can disclose what happened across the relaunch boundary (promotion runs
 * preboot — its result outlives the window that requested it).
 *
 * - `pending`: a sealed restore awaits relaunch (or an interrupted promotion
 *   awaits the next boot) — offer restart, not a new restore.
 * - `completed` / `failed` / `expired`: terminal outcome awaiting user
 *   acknowledgement via `backup.restore_acknowledge`; `reason` carries the
 *   journal's raw diagnostic for failed/expired.
 * - `none`: no journal (or corrupt — nothing actionable for the UI).
 */
export interface RestoreStatus {
  readonly state: 'none' | 'pending' | 'completed' | 'failed' | 'expired'
  readonly reason?: string
}
