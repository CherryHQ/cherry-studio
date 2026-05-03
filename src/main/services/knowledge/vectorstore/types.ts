import type { BaseVectorStore, Document, Metadata } from '@vectorstores/core'

export interface KnowledgeVectorStore extends BaseVectorStore {
  listByExternalId(itemId: string): Promise<Document<Metadata>[]>
  deleteByIdAndExternalId(chunkId: string, itemId: string): Promise<void>
}
