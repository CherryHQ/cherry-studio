export const MIGRATION_DIAGNOSTIC_LARGE_ZIP_BYTES = 15 * 1024 * 1024

export type MigrationDiagnosticSavedResult = {
  status: 'saved'
  logs: 'included' | 'not_included'
  size: 'standard' | 'large'
}

export type MigrationDiagnosticSaveResult =
  | { status: 'canceled' }
  | MigrationDiagnosticSavedResult
  | { status: 'failed'; code: 'dialog_failed' | 'bundle_save_failed' | 'save_in_progress' }

export type MigrationDiagnosticNoticePart = 'logs_included' | 'logs_not_included' | 'large' | 'not_uploaded'

export function getMigrationDiagnosticNoticeParts(
  result: MigrationDiagnosticSavedResult
): readonly MigrationDiagnosticNoticePart[] {
  const parts: MigrationDiagnosticNoticePart[] = [result.logs === 'included' ? 'logs_included' : 'logs_not_included']

  if (result.size === 'large') {
    parts.push('large')
  }

  parts.push('not_uploaded')
  return parts
}
