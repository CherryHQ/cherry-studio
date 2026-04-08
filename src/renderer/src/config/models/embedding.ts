import { getLowerBaseModelName, isUserSelectedModelType } from '@renderer/utils'

import type { ClassifiableModel } from './classifiable'
import { getModelProviderId } from './classifiable'

// Embedding models
export const EMBEDDING_REGEX =
  /(?:^text-|embed|bge-|e5-|LLM2Vec|retrieval|uae-|gte-|jina-clip|jina-embeddings|voyage-)/i

// Rerank models
export const RERANKING_REGEX = /(?:rerank|re-rank|re-ranker|re-ranking|retrieval|retriever)/i
export function isEmbeddingModel(model: ClassifiableModel): boolean {
  if (!model || isRerankModel(model)) {
    return false
  }

  const modelId = getLowerBaseModelName(model.id)

  if (isUserSelectedModelType(model, 'embedding') !== undefined) {
    return isUserSelectedModelType(model, 'embedding')!
  }

  if (getModelProviderId(model) === 'anthropic') {
    return false
  }

  if (getModelProviderId(model) === 'doubao' || modelId.includes('doubao')) {
    return EMBEDDING_REGEX.test(model.name)
  }

  return EMBEDDING_REGEX.test(modelId) || false
}

export function isRerankModel(model: ClassifiableModel): boolean {
  if (isUserSelectedModelType(model, 'rerank') !== undefined) {
    return isUserSelectedModelType(model, 'rerank')!
  }
  const modelId = getLowerBaseModelName(model.id)
  return model ? RERANKING_REGEX.test(modelId) || false : false
}
