import type { KnowledgeBase, KnowledgeItem } from '@shared/data/types/knowledge'
import { Document, type Document as VectorStoreDocument, SentenceSplitter } from '@vectorstores/core'
import { estimateTokenCount } from 'tokenx'

/**
 * Splits source documents into chunked vector-store documents and attaches
 * knowledge-item metadata needed by downstream indexing steps.
 */
export function chunkDocuments(base: KnowledgeBase, item: KnowledgeItem, documents: VectorStoreDocument[]) {
  const splitter = new SentenceSplitter({
    chunkSize: base.chunkSize,
    chunkOverlap: base.chunkOverlap
  })

  return documents.flatMap((document) => {
    const chunks = splitter.splitText(document.text).filter(Boolean)

    return chunks.map(
      (chunk, chunkIndex) =>
        new Document({
          text: chunk,
          metadata: {
            ...document.metadata,
            itemId: item.id,
            itemType: item.type,
            chunkIndex,
            tokenCount: estimateTokenCount(chunk)
          }
        })
    )
  })
}
