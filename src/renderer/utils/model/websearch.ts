import type { Model } from '@shared/data/types/model'
import {
  isOpenAIWebSearchChatCompletionOnlyModel as sharedIsOpenAIWebSearchChatCompletionOnlyModel,
  isOpenAIWebSearchModel as sharedIsOpenAIWebSearchModel,
  isWebSearchModel as sharedIsWebSearchModel
} from '@shared/utils/model'

export { GEMINI_FLASH_MODEL_REGEX } from './capabilities'

// ── Pure ID / capability checks delegated to shared ────────────────────────
export const isOpenAIWebSearchModel = (model: Model): boolean => sharedIsOpenAIWebSearchModel(model)

export const isOpenAIWebSearchChatCompletionOnlyModel = (model: Model): boolean =>
  sharedIsOpenAIWebSearchChatCompletionOnlyModel(model)

/**
 * Web-search-capable model. Reads the `WEB_SEARCH` capability. v2
 * `Model.capabilities` is authoritative (registry inference + baked-in user
 * overrides merged by `ModelService`).
 */
export function isWebSearchModel(model: Model): boolean {
  if (!model) return false
  return sharedIsWebSearchModel(model)
}
