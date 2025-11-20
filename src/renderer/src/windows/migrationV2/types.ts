/**
 * Migration types for Renderer process
 * Duplicated from Main to avoid cross-process imports
 */

export type MigrationStage =
  | 'introduction'
  | 'backup_required'
  | 'backup_progress'
  | 'backup_confirmed'
  | 'migration'
  | 'completed'
  | 'error'

export type MigratorStatus = 'pending' | 'running' | 'completed' | 'failed'

export interface MigratorProgress {
  id: string
  name: string
  status: MigratorStatus
  error?: string
}

export interface MigrationProgress {
  stage: MigrationStage
  overallProgress: number
  currentMessage: string
  migrators: MigratorProgress[]
  error?: string
}

// IPC channel names
export const MigrationIpcChannels = {
  CheckNeeded: 'migration:check-needed',
  GetProgress: 'migration:get-progress',
  GetLastError: 'migration:get-last-error',
  GetUserDataPath: 'migration:get-user-data-path',
  Start: 'migration:start',
  ProceedToBackup: 'migration:proceed-to-backup',
  ShowBackupDialog: 'migration:show-backup-dialog',
  BackupCompleted: 'migration:backup-completed',
  StartMigration: 'migration:start-migration',
  Retry: 'migration:retry',
  Cancel: 'migration:cancel',
  Restart: 'migration:restart',
  SendReduxData: 'migration:send-redux-data',
  DexieExportCompleted: 'migration:dexie-export-completed',
  Progress: 'migration:progress',
  ExportProgress: 'migration:export-progress'
} as const
