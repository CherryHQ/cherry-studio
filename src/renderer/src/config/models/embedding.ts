import { Model } from '@renderer/types'
import { getLowerBaseModelName, isUserSelectedModelType } from '@renderer/utils'

// Embedding models
export const EMBEDDING_REGEX =
  /(?:^text-|embed|bge-|e5-|LLM2Vec|retrieval|uae-|gte-|jina-clip|jina-embeddings|voyage-)/i

// Rerank models
export const RERANKING_REGEX = /(?:rerank|re-rank|re-ranker|re-ranking|retrieval|retriever)/i
export function isEmbeddingModel(model: Model): boolean {
  if (!model || isRerankModel(model)) {
    return false
  }

  const modelId = getLowerBaseModelName(model.id)

  if (isUserSelectedModelType(model, 'embedding') !== undefined) {
    return isUserSelectedModelType(model, 'embedding')!
  }

  if (['anthropic'].includes(model?.provider)) {
    return false
  }

  if (model.provider === 'doubao' || modelId.includes('doubao')) {
    return EMBEDDING_REGEX.test(model.name)
  }

  return EMBEDDING_REGEX.test(modelId) || false
}

export function isRerankModel(model: Model): boolean {
  if (isUserSelectedModelType(model, 'rerank') !== undefined) {
    return isUserSelectedModelType(model, 'rerank')!
  }
  const modelId = getLowerBaseModelName(model.id)
  return model ? RERANKING_REGEX.test(modelId) || false : false
}
