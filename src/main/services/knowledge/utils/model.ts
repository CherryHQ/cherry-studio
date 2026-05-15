import type { EmbeddingModelV3 } from '@ai-sdk/provider'
import type { KnowledgeBase } from '@shared/data/types/knowledge'
import { createOllama } from 'ollama-ai-provider-v2'

import { parseCompositeModelId } from './config'

export function getKnowledgeBaseEmbeddingModelMissingMessage(baseId: string): string {
  return `Knowledge base ${baseId} has no embedding model configured. Select a new embedding model before indexing or searching.`
}

export function getEmbedModel(base: KnowledgeBase): EmbeddingModelV3 {
  if (!base.embeddingModelId) {
    throw new Error(getKnowledgeBaseEmbeddingModelMissingMessage(base.id))
  }

  const { providerId, modelId } = parseCompositeModelId(base.embeddingModelId)

  if (providerId !== 'ollama') {
    throw new Error(`Unsupported embedding provider: ${providerId}`)
  }

  return createOllama().textEmbeddingModel(modelId)
}
