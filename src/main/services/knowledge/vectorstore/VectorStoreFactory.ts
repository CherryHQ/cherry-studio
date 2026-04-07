import type { KnowledgeBase } from '@shared/data/types/knowledge'
import type { BaseVectorStore } from '@vectorstores/core'

import { libSqlVectorStoreProvider } from './providers/LibSqlVectorStoreProvider'

/**
 * Minimal factory for knowledge vector store runtime operations.
 */
export class VectorStoreFactory {
  static async createStore(base: KnowledgeBase): Promise<BaseVectorStore> {
    switch (base.type) {
      case 'libsql':
        return await libSqlVectorStoreProvider.create(base)
    }
  }

  static async deleteStore(base: KnowledgeBase): Promise<void> {
    switch (base.type) {
      case 'libsql':
        return await libSqlVectorStoreProvider.delete(base)
    }
  }
}
