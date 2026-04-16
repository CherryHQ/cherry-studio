import type { EmbeddingModelV3 } from '@ai-sdk/provider'
import type { KnowledgeBase } from '@shared/data/types/knowledge'
import { createOllama } from 'ollama-ai-provider-v2'

import { parseCompositeModelId } from './config'

/**
 * Temporary knowledge-domain model resolver.
 * TODO: unify model acquisition after ai-core moves into main.
 */
/**
 * Resolves the embedding model configured on a knowledge base.
 */
export function getEmbedModel(base: KnowledgeBase): EmbeddingModelV3 {
  const { providerId, modelId } = parseCompositeModelId(base.embeddingModelId)
  // todo: wait model/provider pr merged
  // const {baseUrl, apiKey} = model/provider.getxxx

  if (providerId !== 'ollama') {
    throw new Error(`Unsupported embedding provider: ${providerId}`)
  }

  return createOllama().textEmbeddingModel(modelId)
}
