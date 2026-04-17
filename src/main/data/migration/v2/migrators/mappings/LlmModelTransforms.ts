import { type LegacyModelRef, legacyModelToUniqueId } from '../transformers/ModelTransformers'
import type { TransformResult } from './ComplexPreferenceMappings'

/**
 * Transform 4 legacy LLM Model objects into UniqueModelId preference values.
 *
 * Sources: llm.defaultModel, llm.topicNamingModel, llm.quickModel, llm.translateModel
 * Targets: chat.default_model_id, topic.naming.model_id, feature.quick_assistant.model_id, feature.translate.model_id
 */
export function transformLlmModelIds(sources: Record<string, unknown>): TransformResult {
  return {
    'chat.default_model_id': legacyModelToUniqueId(sources.defaultModel as LegacyModelRef | null | undefined),
    'topic.naming.model_id': legacyModelToUniqueId(sources.topicNamingModel as LegacyModelRef | null | undefined),
    'feature.quick_assistant.model_id': legacyModelToUniqueId(sources.quickModel as LegacyModelRef | null | undefined),
    'feature.translate.model_id': legacyModelToUniqueId(sources.translateModel as LegacyModelRef | null | undefined)
  }
}
