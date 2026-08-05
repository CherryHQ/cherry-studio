/**
 * Shared type definitions for the migration system
 */

// Migration stages for UI flow
export type MigrationStage = 'version_incompatible' | 'introduction' | 'migration' | 'completed' | 'error'

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
  /** Non-empty reports for irrecoverable legacy IndexedDB data skipped during export. */
  dexieRecoveryReports?: DexieRecoveryReport[]
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

export type DexieRecoveryReport =
  | {
      /** Individual records were skipped after a page read failed. */
      scope: 'records'
      /** Legacy Dexie object store containing the damaged records. */
      table: string
      /** Total records skipped from this table during the export. */
      skippedRecords: number
      /** At most 10 primary keys for logs and diagnostics; never rendered in the migration UI. */
      samplePrimaryKeys: string[]
    }
  | {
      /** The table was exported as empty because its primary keys could not be enumerated. */
      scope: 'table'
      /** Legacy Dexie object store exported as empty. */
      table: string
    }
  | {
      /** Every supported Dexie table was exported as empty because the database could not be inspected. */
      scope: 'database'
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
  /** Present only when the Dexie export returned one or more recovery reports. */
  dexieRecoveryReports?: DexieRecoveryReport[]
}

export interface MigrationErrorReportPayload {
  message: string
  /** Present only when Dexie recovery completed before a later renderer-side migration step failed. */
  dexieRecoveryReports?: DexieRecoveryReport[]
}

export type MigrationDiagnosticSaveResult =
  | { status: 'saved'; logs: 'included' | 'not_included' }
  | { status: 'canceled' }
  | { status: 'failed' }

export interface MigrationDiagnosticSavePayload {
  dialogTitle: string
  logDate: string
}

export type MigrationExportFileWriteMode = 'overwrite' | 'append'

// IPC channels for migration communication
export const MigrationIpcChannels = {
  // Status queries
  CheckNeeded: 'migration:check-needed',
  GetProgress: 'migration:get-progress',
  GetLastError: 'migration:get-last-error',
  GetUserDataPath: 'migration:get-user-data-path',

  // Flow control
  Start: 'migration:start',
  StartMigration: 'migration:start-migration',
  // Renderer-local failure mirrored to main's terminal error stage.
  ReportError: 'migration:report-error',
  Retry: 'migration:retry',
  Cancel: 'migration:cancel',
  Restart: 'migration:restart',

  // File transfer (Renderer -> Main)
  WriteExportFile: 'migration:write-export-file',
  SaveDiagnosticBundle: 'migration:save-diagnostic-bundle',
  ShowDiagnosticBundleInFolder: 'migration:show-diagnostic-bundle-in-folder',

  // Open the region-appropriate v1 download page in the system browser
  // (the preboot window has no shell access; main picks the site by egress IP)
  OpenDownloadPage: 'migration:open-download-page',

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
