import type { KnowledgeBase } from '@shared/data/types/knowledge'
import type { BaseVectorStore } from '@vectorstores/core'

import { LibSqlVectorStoreProvider } from './providers/LibSqlVectorStoreProvider'

/**
 * Minimal factory for building knowledge vector stores.
 * Scope intentionally limited to construction only.
 */
export class VectorStoreFactory {
  static create(base: KnowledgeBase): BaseVectorStore {
    return new LibSqlVectorStoreProvider().create(base)
  }
}
