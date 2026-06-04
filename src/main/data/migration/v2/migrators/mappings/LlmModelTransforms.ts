import { CHERRYAI_DEFAULT_UNIQUE_MODEL_ID, CHERRYAI_PROVIDER_ID } from '@shared/data/presets/cherryai'

import { type LegacyModelRef, legacyModelToUniqueId } from '../transformers/ModelTransformers'
import type { TransformResult } from './ComplexPreferenceMappings'

function isLegacyCherryAIDefaultModel(model: LegacyModelRef | null | undefined): boolean {
  return typeof model?.provider === 'string' && model.provider.trim() === CHERRYAI_PROVIDER_ID
}

function transformModelId(model: LegacyModelRef | null | undefined, fallbackToCherryAI = false) {
  if (isLegacyCherryAIDefaultModel(model)) {
    return CHERRYAI_DEFAULT_UNIQUE_MODEL_ID
  }

  return legacyModelToUniqueId(model) ?? (fallbackToCherryAI ? CHERRYAI_DEFAULT_UNIQUE_MODEL_ID : null)
}

/**
 * Transform 4 legacy LLM Model objects into UniqueModelId preference values.
 *
 * Sources: llm.defaultModel, llm.topicNamingModel, llm.quickModel, llm.translateModel
 * Targets: chat.default_model_id, topic.naming.model_id, feature.quick_assistant.model_id, feature.translate.model_id
 */
export function transformLlmModelIds(sources: Record<string, unknown>): TransformResult {
  return {
    'chat.default_model_id': transformModelId(sources.defaultModel as LegacyModelRef | null | undefined, true),
    'topic.naming.model_id': transformModelId(sources.topicNamingModel as LegacyModelRef | null | undefined),
    'feature.quick_assistant.model_id': transformModelId(sources.quickModel as LegacyModelRef | null | undefined),
    'feature.translate.model_id': transformModelId(sources.translateModel as LegacyModelRef | null | undefined)
  }
}
