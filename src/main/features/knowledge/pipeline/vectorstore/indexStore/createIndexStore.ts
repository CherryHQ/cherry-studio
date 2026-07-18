import { loggerService } from '@logger'

import { openBetterSqlite3IndexDriver } from './BetterSqlite3Driver'
import { betterSqlite3VectorIndex } from './BetterSqlite3VectorIndex'
import { ensureIndexMeta, readIndexSchemaVersion } from './indexMeta'
import { KnowledgeIndexStore } from './KnowledgeIndexStore'
import { createKnowledgeIndexSchema, KNOWLEDGE_INDEX_SCHEMA_VERSION, resetKnowledgeIndexSchema } from './schema'

const logger = loggerService.withContext('KnowledgeIndexStoreFactory')

export interface CreateKnowledgeIndexStoreOptions {
  baseId: string
  /**
   * Runs synchronously on the freshly opened store, INSIDE this factory's
   * close-on-throw region, before the store is returned. The runtime passes its
   * empty-index diagnostic here so a throwing probe still closes the driver (a
   * leaked index.sqlite handle would later block deleting the base dir on Windows);
   * the migrator omits it. Keep it synchronous: the runtime's single-flight open
   * guarantee (KnowledgeVectorStoreService) depends on the whole open running in
   * one JS turn with no `await`.
   */
  afterOpen?: (store: KnowledgeIndexStore) => void
}

/**
 * Open (or create) the per-base `index.sqlite` at `dbPath` and return a
 * {@link KnowledgeIndexStore} over it, running the canonical open sequence —
 * driver → version-aware schema → meta identity → store — so a store built here
 * is byte-for-byte one the runtime would produce. Shared by the runtime
 * (KnowledgeVectorStoreService.openIndexStore) and the v1→v2 vector migrator so
 * the sequence lives in exactly one place.
 *
 * Fully synchronous (better-sqlite3 is sync); a throw anywhere closes the driver
 * before rethrowing so a failed open never leaks the file handle.
 */
export function createKnowledgeIndexStoreAtPath(
  dbPath: string,
  options: CreateKnowledgeIndexStoreOptions
): KnowledgeIndexStore {
  const driver = openBetterSqlite3IndexDriver(dbPath)
  try {
    // An index.sqlite from an older schema layout cannot be migrated in place —
    // `CREATE ... IF NOT EXISTS` never retrofits a new column/trigger onto an
    // existing table. When the stored schema_version differs from the current
    // constant, drop and recreate this rebuildable derived index; the base then
    // re-indexes from knowledge_item. A fresh/blank file has no stored version
    // (null) and falls through to the normal create.
    // (A stale-version file swapped in from another base is rebuilt here rather than
    // refused by the ensureIndexMeta base_id check below — but the reset drops its rows,
    // so no other base's data is ever served; only the explicit refusal diagnostic is skipped.)
    const storedVersion = readIndexSchemaVersion(driver)
    if (storedVersion !== null && storedVersion !== KNOWLEDGE_INDEX_SCHEMA_VERSION) {
      logger.warn('Knowledge index schema version mismatch — rebuilding the derived index', {
        baseId: options.baseId,
        storedVersion,
        expectedVersion: KNOWLEDGE_INDEX_SCHEMA_VERSION
      })
      resetKnowledgeIndexSchema(driver)
    } else {
      createKnowledgeIndexSchema(driver)
    }
    // Stamp + verify the meta identity row before handing out the store, so an
    // index.sqlite swapped in from another base is rejected here (§4.1).
    ensureIndexMeta(driver, { baseId: options.baseId })
    const store = new KnowledgeIndexStore(driver, betterSqlite3VectorIndex)
    // Runs inside this close-on-throw region so a throwing hook still closes the driver.
    options.afterOpen?.(store)
    return store
  } catch (error) {
    // Close the driver opened above so a failed open never leaks the index file
    // handle (which on Windows would later block deleting the base dir).
    driver.close()
    throw error
  }
}
