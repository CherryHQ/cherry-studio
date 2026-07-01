import { getLowerBaseModelName } from '@renderer/utils/naming'
import type { Model } from '@shared/data/types/model'
import { parseUniqueModelId } from '@shared/data/types/model'
import {
  isHunyuanSearchModel as sharedIsHunyuanSearchModel,
  isOpenAIWebSearchChatCompletionOnlyModel as sharedIsOpenAIWebSearchChatCompletionOnlyModel,
  isOpenAIWebSearchModel as sharedIsOpenAIWebSearchModel,
  isWebSearchModel as sharedIsWebSearchModel
} from '@shared/utils/model'

export { GEMINI_FLASH_MODEL_REGEX } from './utils'

const PERPLEXITY_SEARCH_MODELS = ['sonar-pro', 'sonar', 'sonar-reasoning', 'sonar-reasoning-pro', 'sonar-deep-research']

// ── Pure ID / capability checks delegated to shared ────────────────────────
export const isOpenAIWebSearchModel = (model: Model): boolean => sharedIsOpenAIWebSearchModel(model)

export const isOpenAIWebSearchChatCompletionOnlyModel = (model: Model): boolean =>
  sharedIsOpenAIWebSearchChatCompletionOnlyModel(model)

export const isHunyuanSearchModel = (model?: Model): boolean => (model ? sharedIsHunyuanSearchModel(model) : false)

/**
 * Web-search-capable model. Reads the `WEB_SEARCH` capability. v2
 * `Model.capabilities` is authoritative (registry inference + baked-in user
 * overrides merged by `ModelService`).
 */
export function isWebSearchModel(model: Model): boolean {
  if (!model) return false
  return sharedIsWebSearchModel(model)
}

/** Provider-host forces web search on every request (Perplexity / OpenRouter sonar). */
export function isMandatoryWebSearchModel(model: Model): boolean {
  if (!model) return false
  const { providerId, modelId } = parseUniqueModelId(model.id)
  if (providerId !== 'perplexity' && providerId !== 'openrouter') return false
  return PERPLEXITY_SEARCH_MODELS.includes(getLowerBaseModelName(modelId))
}

/** OpenRouter exposes native web search for OpenAI's search-preview SKUs and sonar. */
export function isOpenRouterBuiltInWebSearchModel(model: Model): boolean {
  if (!model) return false
  const { providerId, modelId } = parseUniqueModelId(model.id)
  if (providerId !== 'openrouter') return false
  return isOpenAIWebSearchChatCompletionOnlyModel(model) || getLowerBaseModelName(modelId).includes('sonar')
}
