/**
 * Migration v2 module exports
 */

// Core
export { createMigrationContext, type MigrationContext } from './core/MigrationContext'
export { MigrationEngine, migrationEngine } from './core/MigrationEngine'
export { isSchemaOutOfSyncError } from './core/migrationErrors'
export {
  type MigrationPaths,
  type MigrationPathsResult,
  pinUserDataPath,
  resolveMigrationPaths
} from './core/MigrationPaths'
export {
  evaluateCandidateVersion,
  getBlockMessage,
  V1_REQUIRED_VERSION,
  V2_GATEWAY_VERSION,
  type VersionBlockReason
} from './core/versionPolicy'
export {
  classifyMigrationError,
  createMigrationDatabaseDiagnostics,
  createMigrationDiagnosticBundleBuilder,
  createMigrationDiagnosticsCoordinator,
  type MigrationDiagnosticBundleSaveResult,
  type MigrationDiagnosticFailure,
  type MigrationVersionGateContext
} from './migrationDiagnostics'
export type {
  MigrationDiagnosticNativeDecision,
  MigrationDiagnosticNativeFailureCode,
  MigrationDiagnosticNativeSaveResult
} from './window/migrationDiagnosticDialogs'
export {
  createMigrationWindowFailureClaim,
  type MigrationRendererFailureReason,
  type MigrationWindowFailureClaim
} from './window/MigrationWindowManager'
export {
  type ExecuteResult,
  type I18nMessage,
  type LocalStorageRecord,
  MigrationIpcChannels,
  type MigrationProgress,
  type MigrationResult,
  type MigrationStage,
  type MigrationStatusValue,
  type MigrationSummary,
  type MigratorProgress,
  type MigratorResult,
  type MigratorStatus,
  type PrepareResult,
  type StartMigrationPayload,
  type ValidateResult,
  type ValidationError
} from '@shared/data/migration/v2/types'

// Migrators
export { getAllMigrators } from './migrators/migratorRegistry'

// Window management
export {
  presentMigrationDiagnosticFailure,
  presentMigrationDiagnosticRecovery
} from './window/migrationDiagnosticDialogs'
export {
  registerMigrationIpcHandlers,
  resetMigrationData,
  runMigrationDiagnosticSaveTransaction,
  setDataLocationNotice,
  setVersionIncompatible,
  unregisterMigrationIpcHandlers
} from './window/MigrationIpcHandler'
export { MigrationWindowManager, migrationWindowManager } from './window/MigrationWindowManager'
