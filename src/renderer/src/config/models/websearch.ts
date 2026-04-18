/**
 * Web-search capability checks.
 *
 * `isWebSearchModel` reads shared's `WEB_SEARCH` capability (populated by
 * the bridge via `inferWebSearchFromModelId`). Provider-host nuances
 * (Bedrock disabling Claude search, Vertex allowing only 4-series, etc.)
 * belong at the provider-routing layer — not in this model-identity check.
 *
 * `isMandatoryWebSearchModel` / `isOpenRouterBuiltInWebSearchModel` remain
 * provider-aware because they answer "is this host forcing the search on?" —
 * a routing concern that can't be derived from the model alone.
 */
import { getProviderByModel } from '@renderer/services/AssistantService'
import type { Model } from '@renderer/types'
import { getLowerBaseModelName, isUserSelectedModelType } from '@renderer/utils'
import {
  isHunyuanSearchModel as sharedIsHunyuanSearchModel,
  isOpenAIWebSearchChatCompletionOnlyModel as sharedIsOpenAIWebSearchChatCompletionOnlyModel,
  isOpenAIWebSearchModel as sharedIsOpenAIWebSearchModel,
  isWebSearchModel as sharedIsWebSearchModel
} from '@shared/utils/model'

export { GEMINI_FLASH_MODEL_REGEX } from './utils'

import { toSharedCompatModel } from './_bridge'

const PERPLEXITY_SEARCH_MODELS = ['sonar-pro', 'sonar', 'sonar-reasoning', 'sonar-reasoning-pro', 'sonar-deep-research']

// ── Pure ID / capability checks delegated to shared ────────────────────────
export const isOpenAIWebSearchModel = (model: Model): boolean =>
  sharedIsOpenAIWebSearchModel(toSharedCompatModel(model))

export const isOpenAIWebSearchChatCompletionOnlyModel = (model: Model): boolean =>
  sharedIsOpenAIWebSearchChatCompletionOnlyModel(toSharedCompatModel(model))

export const isHunyuanSearchModel = (model?: Model): boolean =>
  model ? sharedIsHunyuanSearchModel(toSharedCompatModel(model)) : false

/**
 * Web-search-capable model. Reads the `WEB_SEARCH` capability; user
 * preference override wraps it.
 */
export function isWebSearchModel(model: Model): boolean {
  if (!model) return false
  const override = isUserSelectedModelType(model, 'web_search')
  if (override !== undefined) return override
  return sharedIsWebSearchModel(toSharedCompatModel(model))
}

/** Provider-host forces web search on every request (Perplexity / OpenRouter sonar). */
export function isMandatoryWebSearchModel(model: Model): boolean {
  if (!model) return false
  const provider = getProviderByModel(model)
  if (!provider) return false
  if (provider.id !== 'perplexity' && provider.id !== 'openrouter') return false
  return PERPLEXITY_SEARCH_MODELS.includes(getLowerBaseModelName(model.id))
}

/** OpenRouter exposes native web search for OpenAI's search-preview SKUs and sonar. */
export function isOpenRouterBuiltInWebSearchModel(model: Model): boolean {
  if (!model) return false
  const provider = getProviderByModel(model)
  if (provider?.id !== 'openrouter') return false
  return isOpenAIWebSearchChatCompletionOnlyModel(model) || getLowerBaseModelName(model.id).includes('sonar')
}
