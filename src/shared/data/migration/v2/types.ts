/**
 * Shared type definitions for the migration system
 */

// Migration stages for UI flow
export type MigrationStage = 'version_incompatible' | 'introduction' | 'migration' | 'completed' | 'error'

export type MigrationDiagnosticLocale = 'zh-CN' | 'en-US'

export function isMigrationDiagnosticLocale(value: unknown): value is MigrationDiagnosticLocale {
  return value === 'zh-CN' || value === 'en-US'
}

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
   * Resolved v1 data directory to surface on the introduction screen, seeded
   * only when the migration gate auto-recovered a non-default custom userData
   * location (fuzzy fallback). Absent otherwise. Its presence is what tells
   * the renderer to render the "data migration directory" notice.
   */
  dataLocation?: string
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

export type MigrationDiagnosticSaveResult =
  | { status: 'canceled' }
  | { status: 'saved' }
  | {
      status: 'failed'
      code: 'dialog_failed' | 'snapshot_failed' | 'bundle_save_failed' | 'save_in_progress'
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
  SetDiagnosticLocale: 'migration:set-diagnostic-locale',
  SaveDiagnosticBundle: 'migration:save-diagnostic-bundle',
  OpenDiagnosticEmail: 'migration:open-diagnostic-email',
  ShowDiagnosticBundleInFolder: 'migration:show-diagnostic-bundle-in-folder',
  CopySupportEmail: 'migration:copy-support-email',
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
