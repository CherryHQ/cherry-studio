/**
 * Migration v2 module exports
 */

// Core
export { createMigrationContext, type MigrationContext } from './core/MigrationContext'
export { MigrationEngine, migrationEngine } from './core/MigrationEngine'
export * from './core/types'

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
  unregisterMigrationIpcHandlers
} from './window/MigrationIpcHandler'
export { MigrationWindowManager, migrationWindowManager } from './window/MigrationWindowManager'
