import type { MigrationDiagnosticFailure, MigrationExportWriteResult } from '@shared/data/migration/v2/diagnostics'

export class MigrationExportWriteError extends Error {
  readonly failure: MigrationDiagnosticFailure

  constructor(failure: MigrationDiagnosticFailure) {
    super(failure.error?.message ?? failure.code)
    this.name = 'MigrationExportWriteError'
    this.failure = failure
  }
}

export function assertMigrationExportWriteSucceeded(
  result: MigrationExportWriteResult
): asserts result is { ok: true } {
  if (!result.ok) throw new MigrationExportWriteError(result.failure)
}
