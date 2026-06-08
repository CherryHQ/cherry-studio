import type { KnowledgeBase } from '@shared/data/types/knowledge'
import type { BaseVectorStore } from '@vectorstores/core'

export abstract class BaseVectorStoreProvider {
  abstract create(base: KnowledgeBase): Promise<BaseVectorStore>
  /**
   * Remove the entire on-disk footprint of a knowledge base (source files,
   * processed artifacts, and the vector store), not just the vector index.
   * Intended for full knowledge-base deletion.
   */
  abstract delete(baseId: string): Promise<void>
  abstract exists(baseId: string): Promise<boolean>
}
