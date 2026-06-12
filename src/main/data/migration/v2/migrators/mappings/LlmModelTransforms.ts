import { loggerService } from '@logger'
import { CHERRYAI_DEFAULT_UNIQUE_MODEL_ID } from '@shared/data/presets/cherryai'

import { legacyChatModelToUniqueId, type LegacyModelRef } from '../transformers/ModelTransformers'
import type { TransformResult } from './ComplexPreferenceMappings'

const logger = loggerService.withContext('LlmModelTransforms')

function describeLegacyModelRef(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') {
    return { valueType: typeof value }
  }

  const { id, provider } = value as { id?: unknown; provider?: unknown }
  return {
    valueType: 'object',
    id: typeof id === 'string' ? id : undefined,
    provider: typeof provider === 'string' ? provider : undefined
  }
}

function resolveChatModelPreference(preferenceKey: string, value: unknown): string {
  const modelId = legacyChatModelToUniqueId(value as LegacyModelRef | null | undefined)
  if (modelId) {
    return modelId
  }

  if (value != null) {
    logger.warn('Legacy model preference could not be parsed; falling back to managed CherryAI default model', {
      preferenceKey,
      ...describeLegacyModelRef(value)
    })
  }

  return CHERRYAI_DEFAULT_UNIQUE_MODEL_ID
}

/**
 * Transform 4 legacy LLM Model objects into UniqueModelId preference values.
 *
 * Sources: llm.defaultModel, llm.topicNamingModel, llm.quickModel, llm.translateModel
 * Targets: chat.default_model_id, topic.naming.model_id, feature.quick_assistant.model_id, feature.translate.model_id
 */
export function transformLlmModelIds(sources: Record<string, unknown>): TransformResult {
  return {
    'chat.default_model_id': resolveChatModelPreference('chat.default_model_id', sources.defaultModel),
    'topic.naming.model_id': resolveChatModelPreference('topic.naming.model_id', sources.topicNamingModel),
    'feature.quick_assistant.model_id': resolveChatModelPreference(
      'feature.quick_assistant.model_id',
      sources.quickModel
    ),
    'feature.translate.model_id': resolveChatModelPreference('feature.translate.model_id', sources.translateModel)
  }
}
