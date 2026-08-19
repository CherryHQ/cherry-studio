import { type Model, SERVER_TOOL } from '@shared/data/types/model'
import {
  isOpenAIModel,
  isOpenAIWebSearchChatCompletionOnlyModel as sharedIsOpenAIWebSearchChatCompletionOnlyModel
} from '@shared/utils/model'
import { isServerToolModelEligible } from '@shared/utils/provider'

export { GEMINI_FLASH_MODEL_REGEX } from './capabilities'

// ── Pure ID / capability checks delegated to shared ────────────────────────
export const isOpenAIWebSearchModel = (model: Model): boolean =>
  isOpenAIModel(model) && isServerToolModelEligible(model, { id: 'openai' }, SERVER_TOOL.WEB_SEARCH)

export const isOpenAIWebSearchChatCompletionOnlyModel = (model: Model): boolean =>
  sharedIsOpenAIWebSearchChatCompletionOnlyModel(model)
