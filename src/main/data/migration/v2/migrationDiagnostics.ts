import type { MigrationRendererExportFailureReport } from '@shared/data/migration/v2/diagnostics'
import semver from 'semver'

import type { MigrationDirectorySelectionRole } from './core/MigrationPaths'
import type { VersionBlockReason } from './core/versionPolicy'
import {
  type ClassifiedMigrationError,
  classifyMigrationError as classifyError,
  MigrationDatabaseDiagnostics,
  MigrationDiagnosticBundleBuilder,
  type MigrationDiagnosticBundleSaveResult,
  type MigrationDiagnosticFailure,
  MigrationDiagnosticsCoordinator,
  type MigrationVersionGateContext
} from './diagnostics'

export type { MigrationDiagnosticBundleSaveResult, MigrationDiagnosticFailure, MigrationVersionGateContext }

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
type PrebootFailureErrorCode = Extract<MigrationDiagnosticFailure, { kind: 'preboot_failed' }>['errorCode']

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
    case 'file_invalid_type':
    case 'file_missing':
    case 'file_permission':
    case 'file_readonly':
    case 'file_io':
      return errorCode
    default:
      return fallback
  }
}

function normalizeDiagnosticVersion(value: string | null | undefined): string | null {
  if (!value || value.length > 128) return null
  return semver.valid(value)
}

export function createMigrationVersionGateContext(
  currentAppVersion: string,
  reason: VersionBlockReason,
  details: Record<string, string>,
  previousVersion: string | null,
  directorySelectionRole: MigrationDirectorySelectionRole,
  versionLog: MigrationVersionGateContext['versionLog']
): MigrationVersionGateContext | null {
  const currentVersion = normalizeDiagnosticVersion(currentAppVersion) ?? 'unknown'
  const normalizedPreviousVersion = normalizeDiagnosticVersion(previousVersion)

  if (reason === 'no_version_log') {
    const requiredVersion = normalizeDiagnosticVersion(details.requiredVersion)
    if (requiredVersion === null || versionLog.state !== 'missing') return null
    return {
      reason,
      currentVersion,
      directorySelectionRole,
      previousVersion: null,
      requiredVersion,
      gatewayVersion: null,
      versionLog
    }
  }

  if (reason === 'v1_too_old') {
    const requiredVersion = normalizeDiagnosticVersion(details.requiredVersion)
    if (normalizedPreviousVersion === null || requiredVersion === null || versionLog.state !== 'parsed') return null
    return {
      reason,
      currentVersion,
      directorySelectionRole,
      previousVersion: normalizedPreviousVersion,
      requiredVersion,
      gatewayVersion: null,
      versionLog
    }
  }

  const gatewayVersion = normalizeDiagnosticVersion(details.gatewayVersion)
  if (normalizedPreviousVersion === null || gatewayVersion === null || versionLog.state !== 'parsed') return null
  return {
    reason,
    currentVersion,
    directorySelectionRole,
    previousVersion: normalizedPreviousVersion,
    requiredVersion: null,
    gatewayVersion,
    versionLog
  }
}
