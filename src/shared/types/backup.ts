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
  maxBackups?: number
  skipBackupFile?: boolean
  disableStream?: boolean
  /** Opt-in: skip ALL certificate checks for this server (self-signed/private-CA, and also expired or wrong-hostname certificates). Default (unset/false) verifies. */
  allowSelfSignedTls?: boolean
}

export type LocalBackupConfig = {
  localBackupDir?: string
  maxBackups?: number
  skipBackupFile?: boolean
}

export type S3Config = {
  endpoint: string
  region: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  root?: string
  fileName?: string
  skipBackupFile?: boolean
  autoSync: boolean
  syncInterval: number
  maxBackups: number
}

export type BackupResult<T> = {
  result: T
  cleanupFailed: boolean
}

export const BACKUP_ACTIVE_WRITERS_ERROR_CODE = 'BACKUP_ACTIVE_WRITERS'
export const BACKUP_BACKGROUND_TASKS_ERROR_CODE = 'BACKUP_BACKGROUND_TASKS'
export const BACKUP_DISK_FULL_ERROR_CODE = 'BACKUP_DISK_FULL'
export const BACKUP_NEWER_VERSION_ERROR_CODE = 'BACKUP_NEWER_VERSION'
export const BACKUP_OPERATION_BUSY_ERROR_CODE = 'BACKUP_OPERATION_BUSY'
