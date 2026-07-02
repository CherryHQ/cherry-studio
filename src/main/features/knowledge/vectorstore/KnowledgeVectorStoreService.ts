import fs from 'node:fs'

import { knowledgeItemService } from '@data/services/KnowledgeItemService'
import { loggerService } from '@logger'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import type { CompletedKnowledgeBase, KnowledgeBase } from '@shared/data/types/knowledge'
import { isCompletedKnowledgeBase } from '@shared/data/types/knowledge'

import { isIndexableKnowledgeItem } from '../items'
import { deleteKnowledgeBaseDir, getKnowledgeVectorStoreFilePathSync } from '../storage/pathStorage'
import { createKnowledgeIndexStoreAtPath } from './indexStore/createIndexStore'
import type { KnowledgeIndexStore } from './indexStore/KnowledgeIndexStore'

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
  // Opening a store (better-sqlite3 connect + schema + meta) is fully synchronous
  // (see openIndexStore), so it runs to completion in one JS turn — no concurrent
  // getIndexStore call for the same base can ever observe an in-flight open, and a
  // failed open never gets cached (the throw happens before .set() below runs).
  private instanceCache = new Map<string, KnowledgeIndexStore>()

  /** Open (or reuse) the base's index store, ensuring its schema exists. */
  async getIndexStore(base: KnowledgeBase): Promise<KnowledgeIndexStore> {
    assertVectorStoreReadyBase(base)

    const cached = this.instanceCache.get(base.id)
    if (cached) {
      logger.debug('Reusing cached knowledge index store', { baseId: base.id })
      return cached
    }

    const store = this.openIndexStore(base)
    this.instanceCache.set(base.id, store)
    logger.info('Opened knowledge index store', { baseId: base.id, cacheSize: this.instanceCache.size })
    return store
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
    const store = this.instanceCache.get(baseId)

    try {
      await this.closeStoreInstance(store)
      await deleteKnowledgeBaseDir(baseId)
      logger.info('Deleted knowledge index store', { baseId, hadCachedStore: Boolean(store) })
    } finally {
      this.instanceCache.delete(baseId)
    }
  }

  protected async onStop(): Promise<void> {
    const storeCount = this.instanceCache.size
    logger.info('Stopping knowledge index stores', { storeCount })

    try {
      for (const [baseId, store] of this.instanceCache.entries()) {
        try {
          await this.closeStoreInstance(store)
        } catch (error) {
          logger.error('Failed to close knowledge index store', error as Error, { baseId })
        }
      }
    } finally {
      this.instanceCache.clear()
      logger.info('Stopped knowledge index stores', { storeCount })
    }
  }

  private openIndexStore(base: CompletedKnowledgeBase): KnowledgeIndexStore {
    // The canonical open sequence (driver → version-aware schema → meta → store) lives in
    // createKnowledgeIndexStoreAtPath, shared with the v1→v2 vector migrator. The empty-index
    // diagnostic runs through the factory's `afterOpen` hook — INSIDE its close-on-throw region
    // and BEFORE the store is returned — so a throwing probe still closes the driver (a leaked
    // index.sqlite handle would later block deleting the base dir on Windows). Keeping this fully
    // synchronous (the factory and the probe are sync) preserves the single-flight open invariant
    // getIndexStore relies on: no `await` runs between its cache-miss and cache-set.
    return createKnowledgeIndexStoreAtPath(getKnowledgeVectorStoreFilePathSync(base.id), {
      baseId: base.id,
      afterOpen: (store) => this.reportInvisibleIndexContents(store, base.id)
    })
  }

  /**
   * Loud-failure guard for an index that mounts cleanly but holds no readable
   * vectors. A freshly migrated or indexed base mounts populated, so an index
   * that holds zero materials while the base still has completed items means the
   * `index.sqlite` was deleted, blanked or replaced — log an error so the
   * silent-empty symptom is diagnosable.
   *
   * Probe failures propagate and fail the open on purpose: swallowing them here
   * would re-silence the deleted-base race this guard exists to expose (an open
   * racing a base deletion recreates an empty file, and the item lookup's
   * NOT_FOUND is what turns that into a loud failure instead of a cached
   * forever-empty store).
   */
  private reportInvisibleIndexContents(store: KnowledgeIndexStore, baseId: string): void {
    if (store.hasAnyMaterial()) {
      return
    }

    const items = knowledgeItemService.getItemsByBaseId(baseId)
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

  private async closeStoreInstance(store: KnowledgeIndexStore | undefined): Promise<void> {
    if (!store) {
      return
    }
    await store.close()
  }
}
