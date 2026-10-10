/**
 * OpenAI / GPT family checks. All pure ID-based — just thin wrappers over
 * the shared/utils/model equivalents so there's one source of truth for
 * the regex / family-matching logic.
 */
import type { Model } from '@shared/data/types/model'
import {
  isGPT5FamilyModel as sharedIsGPT5FamilyModel,
  isGPT5SeriesModel as sharedIsGPT5SeriesModel,
  isGPT5SeriesReasoningModel as sharedIsGPT5SeriesReasoningModel,
  isGPT51SeriesModel as sharedIsGPT51SeriesModel,
  isGPT52SeriesModel as sharedIsGPT52SeriesModel,
  isOpenAIDeepResearchModel as sharedIsOpenAIDeepResearchModel,
  isOpenAILLMModel as sharedIsOpenAILLMModel,
  isOpenAIModel as sharedIsOpenAIModel
} from '@shared/utils/model'

export const OPENAI_NO_SUPPORT_DEV_ROLE_MODELS = ['o1-preview', 'o1-mini']

export const isOpenAILLMModel = (model?: Model): boolean => (model ? sharedIsOpenAILLMModel(model) : false)

export const isOpenAIModel = (model?: Model): boolean => (model ? sharedIsOpenAIModel(model) : false)

export const isGPT5SeriesModel = (model: Model): boolean => sharedIsGPT5SeriesModel(model)

export const isGPT5SeriesReasoningModel = (model: Model): boolean => sharedIsGPT5SeriesReasoningModel(model)

export const isGPT5FamilyModel = (model: Model): boolean => sharedIsGPT5FamilyModel(model)

export const isGPT51SeriesModel = (model: Model): boolean => sharedIsGPT51SeriesModel(model)

export const isGPT52SeriesModel = (model: Model): boolean => sharedIsGPT52SeriesModel(model)

export const isSupportVerbosityModel = isGPT5FamilyModel

export const isOpenAIDeepResearchModel = (model?: Model): boolean =>
  model ? sharedIsOpenAIDeepResearchModel(model) : false
