import { type KnowledgeBase, KnowledgeChunkMetadataSchema, type KnowledgeItem } from '@shared/data/types/knowledge'
import { Document, type Document as VectorStoreDocument, SentenceSplitter } from '@vectorstores/core'
import { estimateTokenCount } from 'tokenx'

export function chunkDocuments(base: KnowledgeBase, item: KnowledgeItem, documents: VectorStoreDocument[]) {
  const splitter = new SentenceSplitter({
    chunkSize: base.chunkSize,
    chunkOverlap: base.chunkOverlap
  })
  let chunkIndex = 0

  return documents.flatMap((document) => {
    const chunks = splitter.splitText(document.text).filter(Boolean)

    return chunks.map((chunk) => {
      const currentChunkIndex = chunkIndex
      chunkIndex += 1
      const metadata = KnowledgeChunkMetadataSchema.parse({
        source: document.metadata.source,
        itemId: item.id,
        itemType: item.type,
        chunkIndex: currentChunkIndex,
        tokenCount: estimateTokenCount(chunk)
      })

      return new Document({
        text: chunk,
        metadata
      })
    })
  })
}
