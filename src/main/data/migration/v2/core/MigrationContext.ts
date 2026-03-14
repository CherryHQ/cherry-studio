/**
 * Migration context shared between all migrators
 */

import { dbService } from '@data/db/DbService'
import type { DbType } from '@data/db/types'
import { type LoggerService, loggerService } from '@logger'
import Store from 'electron-store'

import { DexieFileReader } from '../utils/DexieFileReader'
import { DexieSettingsReader, type DexieSettingsRecord } from '../utils/DexieSettingsReader'
import { ReduxStateReader } from '../utils/ReduxStateReader'

// Logger type for migration context (using actual LoggerService type)
export type MigrationLogger = LoggerService

// Read-only interface for electron-store access during migration
export interface ElectronStoreReader {
  get<T>(key: string, defaultValue?: T): T | undefined
}

// Migration context interface
export interface MigrationContext {
  // Data source accessors
  sources: {
    electronStore: ElectronStoreReader
    reduxState: ReduxStateReader
    dexieExport: DexieFileReader
    dexieSettings: DexieSettingsReader
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
export async function createMigrationContext(
  reduxData: Record<string, unknown>,
  dexieExportPath: string
): Promise<MigrationContext> {
  const db = dbService.getDb()
  const logger = loggerService.withContext('Migration')
  const electronStore = new Store()
  const dexieFileReader = new DexieFileReader(dexieExportPath)

  // Pre-load Dexie settings table into memory for synchronous access
  let dexieSettingsRecords: DexieSettingsRecord[] = []
  if (await dexieFileReader.tableExists('settings')) {
    dexieSettingsRecords = await dexieFileReader.readTable<DexieSettingsRecord>('settings')
    logger.info(`Loaded ${dexieSettingsRecords.length} Dexie settings records`)
  } else {
    logger.warn('Dexie settings table export not found, skipping')
  }

  return {
    sources: {
      electronStore,
      reduxState: new ReduxStateReader(reduxData),
      dexieExport: dexieFileReader,
      dexieSettings: new DexieSettingsReader(dexieSettingsRecords)
    },
    db,
    sharedData: new Map(),
    logger
  }
}
