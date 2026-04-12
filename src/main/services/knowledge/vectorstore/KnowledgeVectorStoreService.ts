import { loggerService } from '@logger'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import type { KnowledgeBase } from '@shared/data/types/knowledge'
import type { BaseVectorStore } from '@vectorstores/core'
import { LibSQLVectorStore } from '@vectorstores/libsql'

import { libSqlVectorStoreProvider } from './providers/LibSqlVectorStoreProvider'

const logger = loggerService.withContext('KnowledgeVectorStoreService')

@Injectable('KnowledgeVectorStoreService')
@ServicePhase(Phase.WhenReady)
export class KnowledgeVectorStoreService extends BaseService {
  private instanceCache = new Map<string, BaseVectorStore>()

  async createStore(base: KnowledgeBase): Promise<BaseVectorStore> {
    if (this.instanceCache.has(base.id)) {
      logger.debug('Reusing cached vector store', { baseId: base.id })
      return this.instanceCache.get(base.id)!
    }

    // Cache is keyed only by base.id because store-shaping config is treated as immutable
    // for an existing knowledge base. If embedding model / dimensions change, callers must
    // migrate into a new knowledge base instead of mutating the existing one in place.
    const store = await libSqlVectorStoreProvider.create(base)
    this.instanceCache.set(base.id, store)
    logger.info('Created vector store', {
      baseId: base.id,
      dimensions: base.dimensions,
      cacheSize: this.instanceCache.size
    })
    return store
  }

  async getStoreIfExists(base: KnowledgeBase): Promise<BaseVectorStore | undefined> {
    const cachedStore = this.instanceCache.get(base.id)
    if (cachedStore) {
      logger.debug('Using cached vector store from getStoreIfExists', { baseId: base.id })
      return cachedStore
    }

    const exists = await libSqlVectorStoreProvider.exists(base.id)
    if (!exists) {
      logger.debug('Vector store does not exist on disk', { baseId: base.id })
      return undefined
    }

    logger.info('Opening existing vector store from disk', { baseId: base.id })
    return await this.createStore(base)
  }

  async deleteStore(baseId: string): Promise<void> {
    const store = this.instanceCache.get(baseId)

    try {
      this.closeStoreInstance(store)
      await libSqlVectorStoreProvider.delete(baseId)
      logger.info('Deleted vector store', {
        baseId,
        hadCachedStore: Boolean(store)
      })
    } finally {
      this.instanceCache.delete(baseId)
    }
  }

  protected async onStop(): Promise<void> {
    const storeCount = this.instanceCache.size
    logger.info('Stopping vector stores', { storeCount })

    try {
      for (const [baseId, store] of this.instanceCache.entries()) {
        try {
          this.closeStoreInstance(store)
        } catch (error) {
          logger.error('Failed to close vector store', error as Error, { baseId })
        }
      }
    } finally {
      this.instanceCache.clear()
      logger.info('Stopped vector stores', { storeCount })
    }
  }

  private closeStoreInstance(store: BaseVectorStore | undefined): void {
    if (!store) {
      return
    }

    if (store instanceof LibSQLVectorStore) {
      store.client().close()
    }
  }
}
