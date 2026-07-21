import type { MigrationRendererExportFailureReport } from '@shared/data/migration/v2/diagnostics'

import {
  type ClassifiedMigrationError,
  classifyMigrationError as classifyError,
  MigrationDatabaseDiagnostics,
  MigrationDiagnosticBundleBuilder,
  type MigrationDiagnosticBundleSaveResult,
  type MigrationDiagnosticFailure,
  MigrationDiagnosticsCoordinator
} from './diagnostics'

export type { MigrationDiagnosticBundleSaveResult, MigrationDiagnosticFailure }

export function createMigrationDiagnosticsCoordinator(): MigrationDiagnosticsCoordinator {
  return new MigrationDiagnosticsCoordinator()
}

export function createMigrationDiagnosticBundleBuilder(): MigrationDiagnosticBundleBuilder {
  return new MigrationDiagnosticBundleBuilder()
}

export function createMigrationDatabaseDiagnostics(): MigrationDatabaseDiagnostics {
  return new MigrationDatabaseDiagnostics()
}

export function classifyMigrationError(error: unknown): ClassifiedMigrationError {
  return classifyError(error)
}

type RendererExportFailureErrorCode = Extract<
  MigrationDiagnosticFailure,
  { kind: 'renderer_export_failed' }
>['errorCode']
type MainExportWriteErrorCode = Extract<
  RendererExportFailureErrorCode,
  'unknown_error' | 'file_invalid_type' | 'file_missing' | 'file_permission' | 'file_readonly' | 'file_io'
>
type PrebootFailureErrorCode = Extract<MigrationDiagnosticFailure, { kind: 'preboot_failed' }>['errorCode']

export type MigrationRendererExportMainWriteFailure = { readonly errorCode: MainExportWriteErrorCode }

export function classifyMigrationRendererExportFailure(
  report: MigrationRendererExportFailureReport
): RendererExportFailureErrorCode {
  switch (report.operationRole) {
    case 'open':
    case 'read':
      return 'source_read_failed'
    case 'parse':
      return 'source_parse_failed'
    case 'serialize':
      return 'source_serialization_failed'
    case 'write':
    case 'unknown':
      return 'unknown_error'
  }
}

export function createMigrationRendererExportDiagnosticFailure(
  report: MigrationRendererExportFailureReport,
  mainWriteFailure?: MigrationRendererExportMainWriteFailure
): Extract<MigrationDiagnosticFailure, { kind: 'renderer_export_failed' }> {
  return {
    kind: 'renderer_export_failed',
    scope: 'renderer_export',
    phase: 'finalize',
    errorCode: mainWriteFailure?.errorCode ?? classifyMigrationRendererExportFailure(report)
  }
}

export function classifyMigrationPrebootFailure(
  error: unknown,
  fallback: PrebootFailureErrorCode
): PrebootFailureErrorCode {
  const { errorCode } = classifyError(error)
  switch (errorCode) {
    case 'unknown_error':
      return fallback
    case 'sqlite_open_failed':
    case 'sqlite_corrupt':
    case 'sqlite_not_database':
    case 'sqlite_schema':
    case 'sqlite_constraint':
    case 'sqlite_readonly':
    case 'sqlite_permission':
    case 'sqlite_too_big':
    case 'sqlite_busy':
    case 'sqlite_locked':
    case 'sqlite_io':
    case 'sqlite_unknown':
    case 'file_missing':
    case 'file_permission':
    case 'file_readonly':
    case 'file_io':
      return errorCode
    default:
      return fallback
  }
}
