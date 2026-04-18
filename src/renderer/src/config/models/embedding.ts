import type { Model } from '@renderer/types'
import { isUserSelectedModelType } from '@renderer/utils'
import { isEmbeddingModel as sharedIsEmbeddingModel, isRerankModel as sharedIsRerankModel } from '@shared/utils/model'

import { toSharedCompatModel } from './_bridge'

/**
 * Embedding-model check. Reads shared's `EMBEDDING` capability (populated
 * via `inferEmbeddingFromModelId`). User overrides take priority; Anthropic
 * short-circuits (no embedding SKUs); Doubao falls back to `name` because
 * catalog ids are opaque.
 */
export function isEmbeddingModel(model: Model): boolean {
  const override = isUserSelectedModelType(model, 'embedding')
  if (override !== undefined) return override
  const isDoubao = model.provider === 'doubao' || model.id.includes('doubao')
  if (isDoubao && model.name) {
    return sharedIsEmbeddingModel(toSharedCompatModel({ ...model, id: model.name }))
  }
  return sharedIsEmbeddingModel(toSharedCompatModel(model))
}

/**
 * Reranker check. Reads shared's `RERANK` capability; honours user override.
 */
export function isRerankModel(model: Model): boolean {
  if (!model) return false
  const override = isUserSelectedModelType(model, 'rerank')
  if (override !== undefined) return override
  return sharedIsRerankModel(toSharedCompatModel(model))
}
