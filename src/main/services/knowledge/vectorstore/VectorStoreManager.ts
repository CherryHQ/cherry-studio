import type { KnowledgeBase } from '@shared/data/types/knowledge'
import type { BaseVectorStore } from '@vectorstores/core'
import { LibSQLVectorStore } from '@vectorstores/libsql'

import { libSqlVectorStoreProvider } from './providers/LibSqlVectorStoreProvider'

class VectorStoreManager {
  private instanceCache = new Map<string, BaseVectorStore>()
  async createStore(base: KnowledgeBase): Promise<BaseVectorStore> {
    if (this.instanceCache.has(base.id)) {
      return this.instanceCache.get(base.id)!
    }

    // Cache is keyed only by base.id because store-shaping config is treated as immutable
    // for an existing knowledge base. If embedding model / dimensions change, callers must
    // migrate into a new knowledge base instead of mutating the existing one in place.
    const store = await libSqlVectorStoreProvider.create(base)
    this.instanceCache.set(base.id, store)
    return store
  }

  async deleteStore(base: KnowledgeBase): Promise<void> {
    await this.closeStore(base.id)
    await libSqlVectorStoreProvider.delete(base)
    this.instanceCache.delete(base.id)
  }

  async clear(): Promise<void> {
    await Promise.all([...this.instanceCache.keys()].map((baseId) => this.closeStore(baseId)))
    this.instanceCache.clear()
  }

  private async closeStore(baseId: string): Promise<void> {
    const store = this.instanceCache.get(baseId)
    if (!store) {
      return
    }

    if (store instanceof LibSQLVectorStore) {
      store.client().close()
    }
  }
}

export const vectorStoreManager = new VectorStoreManager()
