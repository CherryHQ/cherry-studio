import type { KnowledgeBase } from '@shared/data/types/knowledge'
import type { BaseVectorStore } from '@vectorstores/core'

export abstract class BaseVectorStoreProvider {
  abstract create(base: KnowledgeBase): Promise<BaseVectorStore>
  abstract delete(baseId: string): Promise<void>
  abstract exists(baseId: string): Promise<boolean>
}
