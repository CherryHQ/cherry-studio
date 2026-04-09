import type { EmbeddingModelV3 } from '@ai-sdk/provider'
import { type Document as VectorStoreDocument, NodeRelationship, TextNode } from '@vectorstores/core'
import { embedMany } from 'ai'

/**
 * Embeds chunked documents and converts them into vector-store text nodes.
 */
export async function embedDocuments(
  model: EmbeddingModelV3,
  documents: VectorStoreDocument[],
  signal?: AbortSignal
): Promise<TextNode[]> {
  if (documents.length === 0) {
    return []
  }

  const values = documents.map((document) => document.text)
  const result = await embedMany({
    model,
    values,
    abortSignal: signal
  })

  return documents.map(
    (document, index) =>
      new TextNode({
        text: document.text,
        embedding: result.embeddings[index],
        metadata: document.metadata,
        relationships: {
          [NodeRelationship.SOURCE]: {
            nodeId: String(document.metadata.itemId),
            metadata: document.metadata
          }
        }
      })
  )
}
