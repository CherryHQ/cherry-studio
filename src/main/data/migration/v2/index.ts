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
  V2_GATEWAY_VERSION
} from './core/versionPolicy'
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
  createMigrationDiagnosticSavedDetail,
  type MigrationDiagnosticFailureDialog,
  type MigrationDiagnosticFailurePresentation,
  presentMigrationDiagnosticFailure,
  saveMigrationDiagnosticBundleWithDialog
} from './window/migrationDiagnosticDialogs'
export {
  createMigrationDiagnosticEmailUrl,
  MIGRATION_DIAGNOSTIC_SUPPORT_EMAIL
} from './window/migrationDiagnosticEmail'
export {
  createMigrationDiagnosticNativeI18n,
  type MigrationDiagnosticNativeI18n,
  type MigrationDiagnosticNativeLocale
} from './window/migrationDiagnosticNativeI18n'
export {
  registerMigrationIpcHandlers,
  resetMigrationData,
  setDataLocationNotice,
  setVersionIncompatible,
  unregisterMigrationIpcHandlers
} from './window/MigrationIpcHandler'
export { MigrationWindowManager, migrationWindowManager } from './window/MigrationWindowManager'
