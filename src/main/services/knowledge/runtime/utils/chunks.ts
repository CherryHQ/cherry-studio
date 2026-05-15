import { KnowledgeChunkMetadataSchema, type KnowledgeItemChunk } from '@shared/data/types/knowledge'
import { MetadataMode } from '@vectorstores/core'

export const mapChunkDocument = (chunk: {
  id_: string
  metadata: unknown
  getContent: (mode?: MetadataMode) => string
}): KnowledgeItemChunk => {
  const metadata = KnowledgeChunkMetadataSchema.parse(chunk.metadata ?? {})

  return {
    id: chunk.id_,
    itemId: metadata.itemId,
    content: chunk.getContent(MetadataMode.NONE),
    metadata
  }
}
