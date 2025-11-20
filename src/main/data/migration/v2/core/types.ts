/**
 * Core type definitions for the migration system
 */

// Migration stages for UI flow
export type MigrationStage =
  | 'introduction'
  | 'backup_required'
  | 'backup_progress'
  | 'backup_confirmed'
  | 'migration'
  | 'completed'
  | 'error'

// Individual migrator status
export type MigratorStatus = 'pending' | 'running' | 'completed' | 'failed'

// Migrator progress info for UI display
export interface MigratorProgress {
  id: string
  name: string
  status: MigratorStatus
  error?: string
}

// Overall migration progress
export interface MigrationProgress {
  stage: MigrationStage
  overallProgress: number // 0-100
  currentMessage: string
  migrators: MigratorProgress[]
  error?: string
}

// Prepare phase result
export interface PrepareResult {
  success: boolean
  itemCount: number
  warnings?: string[]
}

// Execute phase result
export interface ExecuteResult {
  success: boolean
  processedCount: number
  error?: string
}

// Validation error detail
export interface ValidationError {
  key: string
  expected?: unknown
  actual?: unknown
  message: string
}

// Validate phase result with count validation support
export interface ValidateResult {
  success: boolean
  errors: ValidationError[]
  stats: {
    sourceCount: number
    targetCount: number
    skippedCount: number
    mismatchReason?: string
  }
}

// Individual migrator result
export interface MigratorResult {
  migratorId: string
  migratorName: string
  success: boolean
  recordsProcessed: number
  duration: number
  error?: string
}

// Overall migration result
export interface MigrationResult {
  success: boolean
  migratorResults: MigratorResult[]
  totalDuration: number
  error?: string
}

// Migration status stored in app_state table
export interface MigrationStatusValue {
  status: 'completed' | 'failed' | 'in_progress'
  completedAt?: number
  failedAt?: number
  version: string
  error?: string | null
}

// IPC channels for migration communication
export const MigrationIpcChannels = {
  // Status queries
  CheckNeeded: 'migration:check-needed',
  GetProgress: 'migration:get-progress',
  GetLastError: 'migration:get-last-error',
  GetUserDataPath: 'migration:get-user-data-path',

  // Flow control
  Start: 'migration:start',
  ProceedToBackup: 'migration:proceed-to-backup',
  ShowBackupDialog: 'migration:show-backup-dialog',
  BackupCompleted: 'migration:backup-completed',
  StartMigration: 'migration:start-migration',
  Retry: 'migration:retry',
  Cancel: 'migration:cancel',
  Restart: 'migration:restart',

  // Data transfer (Renderer -> Main)
  SendReduxData: 'migration:send-redux-data',
  DexieExportCompleted: 'migration:dexie-export-completed',
  WriteExportFile: 'migration:write-export-file',

  // Progress broadcast (Main -> Renderer)
  Progress: 'migration:progress',
  ExportProgress: 'migration:export-progress'
} as const
