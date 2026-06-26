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

// Completion-screen summary stats (display metadata only, derived on success)
export interface MigrationSummary {
  completedMigrators: number
  totalMigrators: number
  itemsProcessed: number
  /** Migration-stage visible duration shown on the completion screen */
  durationMs: number
}

// Metadata for a newly created V1 backup. Beyond display, its *presence* is control state —
// see the `backupInfo` field doc on MigrationProgress.
export interface MigrationBackupInfo {
  createdBackupPath: string
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
  /** Non-fatal diagnostics aggregated across migrators, surfaced on the completion screen */
  warnings?: string[]
  /** Completion-screen summary stats; written only on successful completion */
  summary?: MigrationSummary
  /**
   * Set only when a *new* V1 backup was created. Beyond display, its presence is control
   * state: main gates the forward-only back-nav guard on it (a created backup can't be
   * un-chosen) and the renderer hides the Back button when present — so it must not be
   * dropped or regenerated as if it were purely cosmetic.
   */
  backupInfo?: MigrationBackupInfo
  /** True only while the V1 backup is in its compressing stage; held by the backup_progress UI */
  isCompressing?: boolean
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
  /** Non-fatal diagnostics recorded during execute (e.g. files kept but not reindexable) */
  warnings?: string[]
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
  /** Non-fatal diagnostics from prepare + execute, surfaced in the migration report */
  warnings?: string[]
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
  ReturnToIntroduction: 'migration:return-to-introduction',
  ReturnToBackupChoice: 'migration:return-to-backup-choice',
  ShowBackupDialog: 'migration:show-backup-dialog',
  BackupCompleted: 'migration:backup-completed',
  StartMigration: 'migration:start-migration',
  // Renderer-local failure mirrored to main's terminal error stage.
  ReportError: 'migration:report-error',
  Retry: 'migration:retry',
  Cancel: 'migration:cancel',
  Restart: 'migration:restart',

  // File transfer (Renderer -> Main)
  WriteExportFile: 'migration:write-export-file',

  // Skip migration (version incompatible — user chose to use defaults)
  SkipMigration: 'migration:skip-migration',

  // Window controls (Renderer -> Main)
  Minimize: 'migration:minimize',
  CloseWindow: 'migration:close-window',
  // In-flow close confirmation: Main asks the renderer to show its in-app dialog
  // (ConfirmClose); the renderer reports a confirmed quit back (ConfirmQuit), or that the
  // dialog was dismissed without quitting (CancelClose) so Main drops its pending-close flag.
  ConfirmClose: 'migration:confirm-close',
  ConfirmQuit: 'migration:confirm-quit',
  CancelClose: 'migration:cancel-close',

  // Progress broadcast (Main -> Renderer)
  Progress: 'migration:progress',
  ExportProgress: 'migration:export-progress'
} as const
