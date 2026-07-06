/**
 * Migration v2 module exports
 */

// Core
export { createMigrationContext, type MigrationContext } from './core/MigrationContext'
export { MigrationEngine, migrationEngine } from './core/MigrationEngine'
export { type MigrationPaths, type MigrationPathsResult, resolveMigrationPaths } from './core/MigrationPaths'
export {
  checkUpgradePathCompatibility,
  getBlockMessage,
  readPreviousVersion,
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
export { BaseMigrator } from './migrators/BaseMigrator'
export { getAllMigrators } from './migrators/migratorRegistry'

// Utils
export { DexieFileReader } from './utils/DexieFileReader'
export { JsonStreamReader } from './utils/JsonStreamReader'
export { ReduxStateReader } from './utils/ReduxStateReader'

// Window management
export {
  registerMigrationIpcHandlers,
  resetMigrationData,
  setVersionIncompatible,
  unregisterMigrationIpcHandlers
} from './window/MigrationIpcHandler'
export { MigrationWindowManager, migrationWindowManager } from './window/MigrationWindowManager'
