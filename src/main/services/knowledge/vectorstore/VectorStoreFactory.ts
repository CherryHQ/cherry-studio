import type { KnowledgeBase } from '@shared/data/types/knowledge'
import type { BaseVectorStore } from '@vectorstores/core'

import { LibSqlVectorStoreProvider } from './providers/LibSqlVectorStoreProvider'

/**
 * Minimal factory for knowledge vector store runtime operations.
 */
export class VectorStoreFactory {
  static async createBase(base: KnowledgeBase): Promise<BaseVectorStore> {
    return await new LibSqlVectorStoreProvider().createBase(base)
  }

  static async deleteBase(base: KnowledgeBase): Promise<void> {
    await new LibSqlVectorStoreProvider().deleteBase(base)
  }
}
