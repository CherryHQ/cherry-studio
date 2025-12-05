/**
 * Migration context shared between all migrators
 */

import { dbService } from '@data/db/DbService'
import type { DbType } from '@data/db/types'
import { type LoggerService, loggerService } from '@logger'
import type { ConfigManager } from '@main/services/ConfigManager'
import { configManager } from '@main/services/ConfigManager'

import { DexieFileReader } from '../utils/DexieFileReader'
import { ReduxStateReader } from '../utils/ReduxStateReader'

// Logger type for migration context (using actual LoggerService type)
export type MigrationLogger = LoggerService

// Migration context interface
export interface MigrationContext {
  // Data source accessors
  sources: {
    electronStore: ConfigManager
    reduxState: ReduxStateReader
    dexieExport: DexieFileReader
  }

  // Target database
  db: DbType

  // Shared data between migrators
  sharedData: Map<string, unknown>

  // Logger
  logger: MigrationLogger
}

/**
 * Create a migration context with all data sources
 * @param reduxData - Parsed Redux state data from Renderer
 * @param dexieExportPath - Path to exported Dexie files
 */
export function createMigrationContext(reduxData: Record<string, unknown>, dexieExportPath: string): MigrationContext {
  const db = dbService.getDb()
  const logger = loggerService.withContext('Migration')

  return {
    sources: {
      electronStore: configManager,
      reduxState: new ReduxStateReader(reduxData),
      dexieExport: new DexieFileReader(dexieExportPath)
    },
    db,
    sharedData: new Map(),
    logger
  }
}
