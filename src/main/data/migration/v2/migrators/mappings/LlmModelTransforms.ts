import { CHERRYAI_DEFAULT_UNIQUE_MODEL_ID, CHERRYAI_PROVIDER_ID } from '@shared/data/presets/cherryai'
import type { UniqueModelId } from '@shared/data/types/model'

import { type LegacyModelRef, legacyModelToUniqueId } from '../transformers/ModelTransformers'
import type { TransformResult } from './ComplexPreferenceMappings'

function legacyChatModelToUniqueId(model: LegacyModelRef | null | undefined): UniqueModelId | null {
  const providerId = typeof model?.provider === 'string' ? model.provider.trim() : null
  if (providerId === CHERRYAI_PROVIDER_ID) {
    return CHERRYAI_DEFAULT_UNIQUE_MODEL_ID
  }

  return legacyModelToUniqueId(model)
}

/**
 * Transform 4 legacy LLM Model objects into UniqueModelId preference values.
 *
 * Sources: llm.defaultModel, llm.topicNamingModel, llm.quickModel, llm.translateModel
 * Targets: chat.default_model_id, topic.naming.model_id, feature.quick_assistant.model_id, feature.translate.model_id
 */
export function transformLlmModelIds(sources: Record<string, unknown>): TransformResult {
  return {
    'chat.default_model_id':
      legacyChatModelToUniqueId(sources.defaultModel as LegacyModelRef | null | undefined) ??
      CHERRYAI_DEFAULT_UNIQUE_MODEL_ID,
    'topic.naming.model_id':
      legacyChatModelToUniqueId(sources.topicNamingModel as LegacyModelRef | null | undefined) ??
      CHERRYAI_DEFAULT_UNIQUE_MODEL_ID,
    'feature.quick_assistant.model_id':
      legacyChatModelToUniqueId(sources.quickModel as LegacyModelRef | null | undefined) ??
      CHERRYAI_DEFAULT_UNIQUE_MODEL_ID,
    'feature.translate.model_id':
      legacyChatModelToUniqueId(sources.translateModel as LegacyModelRef | null | undefined) ??
      CHERRYAI_DEFAULT_UNIQUE_MODEL_ID
  }
}
