import type { Model } from '@shared/data/types/model'
import { isOpenAIModel as sharedIsOpenAIModel } from '@shared/utils/model'

export const OPENAI_NO_SUPPORT_DEV_ROLE_MODELS = ['o1-preview', 'o1-mini']
export const isOpenAIModel = (model?: Model): boolean => (model ? sharedIsOpenAIModel(model) : false)
