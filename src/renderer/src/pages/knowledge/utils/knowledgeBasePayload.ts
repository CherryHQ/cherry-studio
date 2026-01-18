import type { KnowledgeBase } from '@renderer/types'

/**
 * Build API payload from KnowledgeBase object
 *
 * Used by both create and update operations to ensure consistent payload structure.
 */
export function buildKnowledgeBasePayload(base: KnowledgeBase) {
  return {
    name: base.name,
    description: base.description,
    embeddingModelId: `${base.model.provider}:${base.model.id}`,
    embeddingModelMeta: {
      id: base.model.id,
      provider: base.model.provider,
      name: base.model.name,
      dimensions: base.dimensions
    },
    rerankModelId: base.rerankModel ? `${base.rerankModel.provider}:${base.rerankModel.id}` : undefined,
    rerankModelMeta: base.rerankModel
      ? {
          id: base.rerankModel.id,
          provider: base.rerankModel.provider,
          name: base.rerankModel.name
        }
      : undefined,
    preprocessProviderId: base.preprocessProvider?.provider.id,
    chunkSize: base.chunkSize,
    chunkOverlap: base.chunkOverlap,
    threshold: base.threshold,
    documentCount: base.documentCount
  }
}
