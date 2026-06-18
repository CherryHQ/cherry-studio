import fs from 'node:fs'

import { knowledgeItemService } from '@data/services/KnowledgeItemService'
import { loggerService } from '@logger'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { DataApiErrorFactory } from '@shared/data/api'
import type { CompletedKnowledgeBase, KnowledgeBase } from '@shared/data/types/knowledge'
import { isCompletedKnowledgeBase } from '@shared/data/types/knowledge'

import { isIndexableKnowledgeItem } from '../utils/items'
import {
  deleteKnowledgeBaseDir,
  getKnowledgeVectorStoreFilePath,
  getKnowledgeVectorStoreFilePathSync
} from '../utils/storage/pathStorage'
import { ensureIndexMeta, hasAnyMaterial, hasLegacyVectorStoreTable } from './indexStore/indexMeta'
import { KnowledgeIndexStore } from './indexStore/KnowledgeIndexStore'
import { openLibsqlIndexDriver } from './indexStore/LibsqlDriver'
import { libsqlVectorIndex } from './indexStore/LibsqlVectorIndex'
import { createKnowledgeIndexSchema } from './indexStore/schema'
import type { SqliteDriver } from './indexStore/types'

const logger = loggerService.withContext('KnowledgeVectorStoreService')

function assertVectorStoreReadyBase(base: KnowledgeBase): asserts base is CompletedKnowledgeBase {
  if (isCompletedKnowledgeBase(base)) {
    return
  }

  throw DataApiErrorFactory.invalidOperation(
    'openKnowledgeIndexStore',
    `Knowledge base '${base.id}' is not ready for vector store operations`
  )
}

/**
 * Owns the per-base {@link KnowledgeIndexStore} instances (each backed by that
 * base's `.cherry/index.sqlite`), caching one per base id and closing them on
 * shutdown. The cache key is the base id alone: store-shaping config (embedding
 * model / dimensions) is immutable for an existing base — to change it, callers
 * migrate into a new base rather than mutating in place.
 */
@Injectable('KnowledgeVectorStoreService')
@ServicePhase(Phase.WhenReady)
export class KnowledgeVectorStoreService extends BaseService {
  // Caches the in-flight open promise, not the resolved store, so concurrent
  // getIndexStore calls for the same base share one open (one libsql client)
  // instead of racing — the loser of a "resolve then set" race would otherwise
  // leak an orphaned store that no one ever closes.
  private instanceCache = new Map<string, Promise<KnowledgeIndexStore>>()

  /** Open (or reuse) the base's index store, ensuring its schema exists. */
  async getIndexStore(base: KnowledgeBase): Promise<KnowledgeIndexStore> {
    assertVectorStoreReadyBase(base)

    const cached = this.instanceCache.get(base.id)
    if (cached) {
      logger.debug('Reusing cached knowledge index store', { baseId: base.id })
      return cached
    }

    const opening = this.openIndexStore(base)
    this.instanceCache.set(base.id, opening)
    try {
      const store = await opening
      logger.info('Opened knowledge index store', { baseId: base.id, cacheSize: this.instanceCache.size })
      return store
    } catch (error) {
      // Evict the rejected promise so a later call retries the open instead of
      // forever re-awaiting the same failure (only if it is still the cached one).
      if (this.instanceCache.get(base.id) === opening) {
        this.instanceCache.delete(base.id)
      }
      throw error
    }
  }

  /** Reuse or open the store only if its file already exists on disk; used by cleanup paths that must not create one. */
  async getIndexStoreIfExists(base: KnowledgeBase): Promise<KnowledgeIndexStore | undefined> {
    // No readiness assert here: cleanup must keep working on failed bases (see
    // operation-guards.md — deleteItems intentionally skips the guard, so its
    // delete-subtree job lands here for any base). A failed base never has a
    // store file or cache entry, so it falls through to `undefined` and cleanup
    // proceeds; if a file unexpectedly exists, getIndexStore still asserts.
    const cached = this.instanceCache.get(base.id)
    if (cached) {
      return cached
    }

    if (!(await this.storeFileExists(base.id))) {
      logger.debug('Knowledge index store does not exist on disk', { baseId: base.id })
      return undefined
    }

    return this.getIndexStore(base)
  }

  /**
   * Close the cached store and remove the base's entire on-disk footprint
   * (`feature.knowledgebase.data/{baseId}`) — source files, processed artifacts
   * and `index.sqlite` alike. Only safe when deleting the whole base.
   */
  async deleteStore(baseId: string): Promise<void> {
    const opening = this.instanceCache.get(baseId)

    try {
      await this.closeStoreInstance(opening)
      await deleteKnowledgeBaseDir(baseId)
      logger.info('Deleted knowledge index store', { baseId, hadCachedStore: Boolean(opening) })
    } finally {
      this.instanceCache.delete(baseId)
    }
  }

  protected async onStop(): Promise<void> {
    const storeCount = this.instanceCache.size
    logger.info('Stopping knowledge index stores', { storeCount })

    try {
      for (const [baseId, opening] of this.instanceCache.entries()) {
        try {
          await this.closeStoreInstance(opening)
        } catch (error) {
          logger.error('Failed to close knowledge index store', error as Error, { baseId })
        }
      }
    } finally {
      this.instanceCache.clear()
      logger.info('Stopped knowledge index stores', { storeCount })
    }
  }

  private async openIndexStore(base: CompletedKnowledgeBase): Promise<KnowledgeIndexStore> {
    const dbPath = await getKnowledgeVectorStoreFilePath(base.id)
    const driver = await openLibsqlIndexDriver(dbPath)
    try {
      await createKnowledgeIndexSchema(driver)
      // Stamp + verify the meta identity row before handing out the store,
      // so an index.sqlite swapped in from another base is rejected here (§4.1).
      // That is the only refusal — a blank/recreated file is stamped as fresh and
      // mounts empty; reportInvisibleIndexContents below makes that state loud.
      await ensureIndexMeta(driver, { baseId: base.id })
      await this.reportInvisibleIndexContents(driver, base.id)
      return new KnowledgeIndexStore(driver, libsqlVectorIndex)
    } catch (error) {
      // Close the driver opened above so a failed open never leaks the libsql
      // file handle (which on Windows would later block deleting the base dir).
      await driver.close()
      throw error
    }
  }

  /**
   * Loud-failure guard for an index that mounts cleanly but holds no readable
   * vectors. The migrator now writes the final 7-table layout, so a freshly
   * migrated base mounts populated; the legacy single-table layout only survives
   * in `index.sqlite` files written by pre-PR-B code paths (the removed vendored
   * store, or an install that ran a pre-PR-B experiment build whose one-shot
   * migration never re-runs to fix it). The runtime layout mounts cleanly beside
   * that remnant but sees none of its vectors, so search would silently return
   * empty forever. Detect that remnant, and the broader "base has completed
   * items but the index holds nothing" state (deleted/blanked file), and log an
   * error so the silent-empty symptom is diagnosable.
   *
   * Probe failures propagate and fail the open on purpose: swallowing them here
   * would re-silence the deleted-base race this guard exists to expose (an open
   * racing a base deletion recreates an empty file, and the item lookup's
   * NOT_FOUND is what turns that into a loud failure instead of a cached
   * forever-empty store).
   */
  private async reportInvisibleIndexContents(driver: SqliteDriver, baseId: string): Promise<void> {
    if (await hasLegacyVectorStoreTable(driver)) {
      logger.error(
        'index.sqlite holds the legacy single-table vector layout (written by a pre-PR-B build), which the runtime store cannot read — search will return empty results until the base is reindexed',
        { baseId }
      )
      return
    }

    if (await hasAnyMaterial(driver)) {
      return
    }

    const items = await knowledgeItemService.getItemsByBaseId(baseId)
    if (items.some((item) => isIndexableKnowledgeItem(item) && item.status === 'completed')) {
      logger.error(
        'Index store mounted with zero materials while the base has completed items — the index file was deleted, blanked or replaced; search will return empty results until the base is reindexed',
        { baseId }
      )
    }
  }

  private async storeFileExists(baseId: string): Promise<boolean> {
    try {
      const stat = await fs.promises.stat(getKnowledgeVectorStoreFilePathSync(baseId))
      return stat.isFile()
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return false
      }
      throw error
    }
  }

  private async closeStoreInstance(opening: Promise<KnowledgeIndexStore> | undefined): Promise<void> {
    if (!opening) {
      return
    }
    // A store that never opened needs no close (the open path already closed its
    // driver on failure) — swallow the rejection here instead of re-throwing the
    // open error into an unrelated delete/shutdown operation.
    const store = await opening.catch(() => undefined)
    if (!store) {
      return
    }
    await store.close()
  }
}
