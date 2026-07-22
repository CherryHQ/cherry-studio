export const MIGRATION_DIAGNOSTIC_LARGE_ZIP_BYTES = 15 * 1024 * 1024

export interface MigrationDiagnosticError {
  readonly name: string
  readonly message: string
  readonly stack?: string
  readonly code?: string
  readonly syscall?: string
  readonly path?: string
  readonly cause?: MigrationDiagnosticError
  readonly causeTruncated?: true
}

export type MigrationFailureCode =
  | 'data_location_pin_failed'
  | 'database_initialize_failed'
  | 'migration_status_probe_failed'
  | 'legacy_data_location_unavailable'
  | 'version_window_failed'
  | 'migration_window_failed'
  | 'no_version_log'
  | 'v1_too_old'
  | 'v2_gateway_skipped'
  | 'redux_export_failed'
  | 'dexie_export_failed'
  | 'localstorage_export_failed'
  | 'export_directory_create_failed'
  | 'export_file_write_failed'
  | 'migration_start_failed'
  | 'migration_engine_failed'

export type MigrationFailureOperation =
  | 'pin_data_location'
  | 'initialize_database'
  | 'probe_migration_status'
  | 'resolve_legacy_data_location'
  | 'evaluate_version'
  | 'open_version_window'
  | 'open_migration_window'
  | 'export_redux'
  | 'export_dexie'
  | 'export_localstorage'
  | 'create_export_directory'
  | 'write_export_file'
  | 'start_migration'
  | 'run_migration'

export interface MigrationVersionDiagnostic {
  readonly reason: 'no_version_log' | 'v1_too_old' | 'v2_gateway_skipped'
  readonly currentVersion: string
  readonly previousVersion?: string
  readonly requiredVersion?: string
  readonly gatewayVersion?: string
  readonly versionLogExists: boolean
}

export interface MigrationDiagnosticFailure {
  readonly code: MigrationFailureCode
  readonly origin: 'main' | 'renderer'
  readonly operation: MigrationFailureOperation
  readonly targetPath?: string
  readonly version?: MigrationVersionDiagnostic
  readonly error?: MigrationDiagnosticError
  readonly statusPersistenceError?: MigrationDiagnosticError
}

export interface MigrationDiagnosticRun {
  readonly id: string
  readonly startedAt: string
  readonly failedAt?: string
}

export interface MigrationDiagnosticRuntime {
  readonly processId: number
  readonly processStartedAt: string
  readonly userDataPath?: string
}

export type MigrationExportWriteResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly failure: MigrationDiagnosticFailure }

export type MigrationDiagnosticSavedResult =
  | { readonly status: 'saved'; readonly logs: 'included'; readonly size: 'standard' | 'large' }
  | {
      readonly status: 'saved'
      readonly logs: 'not_included'
      readonly retry: 'suggested' | 'not_suggested'
      readonly size: 'standard' | 'large'
    }

export type MigrationDiagnosticSaveResult =
  | { status: 'canceled' }
  | MigrationDiagnosticSavedResult
  | { status: 'failed'; code: 'dialog_failed' | 'bundle_save_failed' | 'save_in_progress' }

export type MigrationDiagnosticNoticePart =
  | 'logs_included'
  | 'logs_not_included_retry_suggested'
  | 'logs_not_included_retry_not_suggested'
  | 'large'
  | 'not_uploaded'

const MAX_MIGRATION_DIAGNOSTIC_CAUSE_DEPTH = 5

function serializeErrorAtDepth(
  error: unknown,
  attemptedPath: string | undefined,
  depth: number,
  seen: Set<object>
): MigrationDiagnosticError {
  const errorRecord = typeof error === 'object' && error !== null ? (error as Record<string, unknown>) : undefined
  const stringField = (key: string): string | undefined => {
    try {
      const value = errorRecord?.[key]
      return typeof value === 'string' ? value : undefined
    } catch {
      return undefined
    }
  }

  const name = stringField('name')
  const message = stringField('message')
  const stack = stringField('stack')
  const code = stringField('code')
  const syscall = stringField('syscall')
  const errorPath = stringField('path')
  const diagnosticPath = errorPath ?? attemptedPath
  let cause: unknown
  let hasCause = false
  try {
    cause = errorRecord?.cause
    hasCause = cause !== undefined
  } catch {
    // An inaccessible cause must not hide the primary error.
  }

  if (errorRecord) seen.add(errorRecord)

  const serialized: MigrationDiagnosticError = {
    name: name ?? (error instanceof Error ? 'Error' : 'NonError'),
    message: message ?? String(error),
    ...(stack === undefined ? {} : { stack }),
    ...(code === undefined ? {} : { code }),
    ...(syscall === undefined ? {} : { syscall }),
    ...(diagnosticPath ? { path: diagnosticPath } : {})
  }

  if (!hasCause) return serialized

  if (depth >= MAX_MIGRATION_DIAGNOSTIC_CAUSE_DEPTH - 1) {
    return { ...serialized, causeTruncated: true }
  }

  if (typeof cause === 'object' && cause !== null && seen.has(cause)) {
    return { ...serialized, causeTruncated: true }
  }

  return { ...serialized, cause: serializeErrorAtDepth(cause, undefined, depth + 1, seen) }
}

export function serializeMigrationDiagnosticError(error: unknown, attemptedPath?: string): MigrationDiagnosticError {
  return serializeErrorAtDepth(error, attemptedPath, 0, new Set())
}

export function getMigrationDiagnosticNoticeParts(
  result: MigrationDiagnosticSavedResult
): readonly MigrationDiagnosticNoticePart[] {
  const parts: MigrationDiagnosticNoticePart[] = [
    result.logs === 'included'
      ? 'logs_included'
      : result.retry === 'suggested'
        ? 'logs_not_included_retry_suggested'
        : 'logs_not_included_retry_not_suggested'
  ]

  if (result.size === 'large') {
    parts.push('large')
  }

  parts.push('not_uploaded')
  return parts
}
