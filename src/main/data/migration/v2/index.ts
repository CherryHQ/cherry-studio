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
export * from '@shared/data/migration/v2/types'

// Migrators
export { getAllMigrators } from './migrators'
export { BaseMigrator } from './migrators/BaseMigrator'

// Utils
export { DexieFileReader } from './utils/DexieFileReader'
export { JSONStreamReader } from './utils/JSONStreamReader'
export { ReduxStateReader } from './utils/ReduxStateReader'

// Window management
export {
  registerMigrationIpcHandlers,
  resetMigrationData,
  setVersionIncompatible,
  unregisterMigrationIpcHandlers
} from './window/MigrationIpcHandler'
export { MigrationWindowManager, migrationWindowManager } from './window/MigrationWindowManager'
