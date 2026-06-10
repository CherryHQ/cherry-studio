import fs from 'node:fs'

import { loggerService } from '@logger'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { DataApiErrorFactory } from '@shared/data/api'
import type { CompletedKnowledgeBase, KnowledgeBase } from '@shared/data/types/knowledge'
import { isCompletedKnowledgeBase } from '@shared/data/types/knowledge'

import {
  deleteKnowledgeBaseDir,
  getKnowledgeVectorStoreFilePath,
  getKnowledgeVectorStoreFilePathSync
} from '../utils/storage/pathStorage'
import { KnowledgeIndexStore } from './indexStore/KnowledgeIndexStore'
import { openLibsqlIndexDriver } from './indexStore/LibsqlDriver'
import { libsqlVectorIndex } from './indexStore/LibsqlVectorIndex'
import { createKnowledgeIndexSchema } from './indexStore/schema'

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

    const opening = this.openIndexStore(base.id)
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
    assertVectorStoreReadyBase(base)

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

  private async openIndexStore(baseId: string): Promise<KnowledgeIndexStore> {
    const dbPath = await getKnowledgeVectorStoreFilePath(baseId)
    const driver = await openLibsqlIndexDriver(dbPath)
    await createKnowledgeIndexSchema(driver)
    return new KnowledgeIndexStore(driver, libsqlVectorIndex)
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
    const store = await opening
    await store.close()
  }
}
