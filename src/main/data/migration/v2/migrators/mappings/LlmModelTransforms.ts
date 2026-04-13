/**
 * Transform functions for LLM model preference migration
 *
 * Converts legacy Redux Model objects (with separate `id` and `provider` fields)
 * into v2 UniqueModelId format (`providerId::modelId`).
 */

import { createUniqueModelId } from '@shared/data/types/model'

import type { TransformResult } from './ComplexPreferenceMappings'

/**
 * Extract a UniqueModelId from a legacy Model object.
 *
 * Legacy format: { id: 'gpt-4', provider: 'openai', name: 'GPT-4', ... }
 * v2 format:     'openai::gpt-4'
 *
 * Returns null if the model is missing, has no provider, or has no id.
 */
export function extractUniqueModelId(model: unknown): string | null {
  if (!model || typeof model !== 'object') return null

  const m = model as Record<string, unknown>
  const provider = typeof m.provider === 'string' ? m.provider : ''
  const id = typeof m.id === 'string' ? m.id : ''

  if (!provider || !id) return null
  return createUniqueModelId(provider, id)
}

/**
 * Transform 4 legacy LLM Model objects into UniqueModelId preference values.
 *
 * Sources: llm.defaultModel, llm.topicNamingModel, llm.quickModel, llm.translateModel
 * Targets: chat.default_model_id, topic.naming.model_id, feature.quick_assistant.model_id, feature.translate.model_id
 */
export function transformLlmModelIds(sources: Record<string, unknown>): TransformResult {
  return {
    'chat.default_model_id': extractUniqueModelId(sources.defaultModel),
    'topic.naming.model_id': extractUniqueModelId(sources.topicNamingModel),
    'feature.quick_assistant.model_id': extractUniqueModelId(sources.quickModel),
    'feature.translate.model_id': extractUniqueModelId(sources.translateModel)
  }
}
