export const MIGRATION_DIAGNOSTIC_LARGE_ZIP_BYTES = 15 * 1024 * 1024

export interface MigrationDiagnosticError {
  readonly name: string
  readonly message: string
  readonly stack?: string
  readonly code?: string
  readonly syscall?: string
  readonly path?: string
}

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

export function serializeMigrationDiagnosticError(error: unknown, attemptedPath?: string): MigrationDiagnosticError {
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

  return {
    name: name ?? (error instanceof Error ? 'Error' : 'NonError'),
    message: message ?? String(error),
    ...(stack === undefined ? {} : { stack }),
    ...(code === undefined ? {} : { code }),
    ...(syscall === undefined ? {} : { syscall }),
    ...(diagnosticPath ? { path: diagnosticPath } : {})
  }
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
