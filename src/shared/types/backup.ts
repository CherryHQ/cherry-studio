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
 * V2 export progress update (spec backup-service-lifecycle.md "Export/Restore 触发
 * emit 进度"). Progress is UI-only — never participates in correctness. The renderer
 * routes updates by `backupId` (the startBackup return value, also the cancel key).
 *
 * `phase` is the coarse pipeline step; export uses `snapshot` (DB copy), `collect`
 * (resolve / strip / collect / stage), and `archive` (assembleArchive). Restore-only
 * phases (quiesce / merge / verify / journal / relaunch) are unused by export.
 */
export interface BackupProgressUpdate {
  readonly backupId: string
  readonly phase: 'collect' | 'snapshot' | 'archive' | 'quiesce' | 'merge' | 'verify' | 'journal' | 'relaunch'
  readonly current: number
  readonly total: number
  readonly message?: string
}

/** Result of BackupV2_StartBackup — `backupId` is the cancel/progress routing key. */
export interface BackupV2StartResult {
  readonly backupId: string
  readonly archivePath: string
}
