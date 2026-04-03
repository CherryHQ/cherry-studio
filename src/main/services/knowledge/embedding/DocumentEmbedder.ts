import type { KnowledgeBase } from '@shared/data/types/knowledge'
import { type Document as VectorStoreDocument, TextNode } from '@vectorstores/core'
import { embedMany } from 'ai'

import type { EmbeddingModelFactory } from './EmbeddingModelFactory'

export class DocumentEmbedder {
  constructor(private readonly embeddingModelFactory: EmbeddingModelFactory) {}

  async embed(base: Pick<KnowledgeBase, 'embeddingModelId'>, documents: VectorStoreDocument[]): Promise<TextNode[]> {
    if (documents.length === 0) {
      return []
    }

    const model = this.embeddingModelFactory.createFromCompositeModelId(base.embeddingModelId)
    const values = documents.map((document) => document.text)
    const result = await embedMany({
      model,
      values
    })

    return documents.map(
      (document, index) =>
        new TextNode({
          text: document.text,
          embedding: result.embeddings[index],
          metadata: document.metadata
        })
    )
  }
}
