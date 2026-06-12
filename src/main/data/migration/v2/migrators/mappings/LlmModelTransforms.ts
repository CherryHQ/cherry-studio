import { CHERRYAI_DEFAULT_UNIQUE_MODEL_ID } from '@shared/data/presets/cherryai'

import { legacyChatModelToUniqueId, type LegacyModelRef } from '../transformers/ModelTransformers'
import type { TransformResult } from './ComplexPreferenceMappings'

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
