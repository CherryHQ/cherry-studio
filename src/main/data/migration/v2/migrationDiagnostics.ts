import {
  type ClassifiedMigrationError,
  classifyMigrationError as classifyError,
  MigrationDatabaseDiagnostics,
  MigrationDiagnosticBundleBuilder,
  type MigrationDiagnosticBundleSaveResult,
  MigrationDiagnosticsCoordinator,
  type MigrationVersionGateContext
} from './diagnostics'

export type { MigrationDiagnosticBundleSaveResult, MigrationVersionGateContext }

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
