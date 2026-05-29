/**
 * Shared type definitions for the migration system
 */

// Migration stages for UI flow
export type MigrationStage =
  | 'version_incompatible'
  | 'introduction'
  | 'backup_required'
  | 'backup_progress'
  | 'backup_confirmed'
  | 'migration'
  | 'migration_completed'
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

// I18n message with key and interpolation params
export interface I18nMessage {
  key: string
  params?: Record<string, string | number>
}

// Overall migration progress
export interface MigrationProgress {
  stage: MigrationStage
  overallProgress: number // 0-100
  currentMessage: string
  /** Optional i18n key with params for translation in renderer */
  i18nMessage?: I18nMessage
  migrators: MigratorProgress[]
  error?: string
}

// Prepare phase result
export interface PrepareResult {
  success: boolean
  itemCount: number
  /** Fatal reason when `success === false`. Non-fatal diagnostics belong in `warnings`. */
  error?: string
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
  /** Migrator-specific diagnostics for threshold-based failure decisions */
  diagnostics?: Record<string, number>
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

// localStorage record type (shared between main LocalStorageReader and renderer LocalStorageExporter)
export interface LocalStorageRecord {
  key: string
  value: unknown
}

export interface StartMigrationPayload {
  reduxData: Record<string, unknown>
  dexieExportPath: string
  localStorageExportPath?: string
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

  // File transfer (Renderer -> Main)
  WriteExportFile: 'migration:write-export-file',

  // Skip migration (version incompatible — user chose to use defaults)
  SkipMigration: 'migration:skip-migration',

  // Progress broadcast (Main -> Renderer)
  Progress: 'migration:progress',
  ExportProgress: 'migration:export-progress'
} as const
