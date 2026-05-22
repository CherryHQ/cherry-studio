import type { BaseNode, BaseVectorStore, Document, Metadata } from '@vectorstores/core'

export interface KnowledgeVectorStore extends BaseVectorStore {
  listByExternalId(itemId: string): Promise<Document<Metadata>[]>
  deleteByIdAndExternalId(chunkId: string, itemId: string): Promise<void>
  /**
   * Atomically replace all chunks tied to `externalId` with the provided node
   * set. DELETE + INSERT execute inside a single backing-store transaction so
   * crash-retrying the caller cannot leave orphan chunks AND insert failure
   * never destroys the pre-existing chunk set (transaction rolls back).
   * Pass an empty `nodes` array to clear all chunks for the external id.
   */
  replaceByExternalId(externalId: string, nodes: BaseNode<Metadata>[]): Promise<string[]>
}
