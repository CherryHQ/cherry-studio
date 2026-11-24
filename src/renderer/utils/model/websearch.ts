import { type Model, SERVER_TOOL } from '@shared/data/types/model'
import { isOpenAIModel } from '@shared/utils/model'
import { isServerToolModelEligible } from '@shared/utils/provider'

export const isOpenAIWebSearchModel = (model: Model): boolean =>
  isOpenAIModel(model) && isServerToolModelEligible(model, { id: 'openai' }, SERVER_TOOL.WEB_SEARCH)
