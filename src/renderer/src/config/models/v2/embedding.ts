import { getLowerBaseModelName } from '@renderer/utils'

import { getCapabilityState } from './shared'
import type { ProviderSettingsCapabilityModel } from './types'

const EMBEDDING_REGEX = /(?:^text-|embed|bge-|e5-|LLM2Vec|retrieval|uae-|gte-|jina-clip|jina-embeddings|voyage-)/i
const RERANKING_REGEX = /(?:rerank|re-rank|re-ranker|re-ranking|retrieval|retriever)/i

export function isRerankModel(model: ProviderSettingsCapabilityModel): boolean {
  const capabilityState = getCapabilityState(model, 'rerank')
  if (capabilityState !== undefined) {
    return capabilityState
  }

  return RERANKING_REGEX.test(getLowerBaseModelName(model.id))
}

export function isEmbeddingModel(model: ProviderSettingsCapabilityModel): boolean {
  if (isRerankModel(model)) {
    return false
  }

  const capabilityState = getCapabilityState(model, 'embedding')
  if (capabilityState !== undefined) {
    return capabilityState
  }

  const modelId = getLowerBaseModelName(model.id)
  if (model.providerId === 'anthropic') {
    return false
  }

  if (model.providerId === 'doubao' || modelId.includes('doubao')) {
    return EMBEDDING_REGEX.test(model.name)
  }

  return EMBEDDING_REGEX.test(modelId)
}
