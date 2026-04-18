/**
 * OpenAI / GPT family checks. All pure ID-based — just thin wrappers over
 * the shared/utils/model equivalents so there's one source of truth for
 * the regex / family-matching logic.
 */
import type { Model } from '@renderer/types'
import {
  isGPT5FamilyModel as sharedIsGPT5FamilyModel,
  isGPT5ProModel as sharedIsGPT5ProModel,
  isGPT5SeriesModel as sharedIsGPT5SeriesModel,
  isGPT5SeriesReasoningModel as sharedIsGPT5SeriesReasoningModel,
  isGPT51CodexMaxModel as sharedIsGPT51CodexMaxModel,
  isGPT51SeriesModel as sharedIsGPT51SeriesModel,
  isGPT52ProModel as sharedIsGPT52ProModel,
  isGPT52SeriesModel as sharedIsGPT52SeriesModel,
  isOpenAIChatCompletionOnlyModel as sharedIsOpenAIChatCompletionOnlyModel,
  isOpenAIDeepResearchModel as sharedIsOpenAIDeepResearchModel,
  isOpenAILLMModel as sharedIsOpenAILLMModel,
  isOpenAIModel as sharedIsOpenAIModel,
  isOpenAIOpenWeightModel as sharedIsOpenAIOpenWeightModel,
  isOpenAIReasoningModel as sharedIsOpenAIReasoningModel,
  isSupportedReasoningEffortOpenAIModel as sharedIsSupportedReasoningEffortOpenAIModel,
  isSupportNoneReasoningEffortModel as sharedIsSupportNoneReasoningEffortModel
} from '@shared/utils/model'

import { toSharedCompatModel } from './_bridge'

export const OPENAI_NO_SUPPORT_DEV_ROLE_MODELS = ['o1-preview', 'o1-mini']

export const isOpenAILLMModel = (model?: Model): boolean =>
  model ? sharedIsOpenAILLMModel(toSharedCompatModel(model)) : false

export const isOpenAIModel = (model?: Model): boolean =>
  model ? sharedIsOpenAIModel(toSharedCompatModel(model)) : false

export const isGPT5ProModel = (model: Model): boolean => sharedIsGPT5ProModel(toSharedCompatModel(model))

export const isGPT52ProModel = (model: Model): boolean => sharedIsGPT52ProModel(toSharedCompatModel(model))

export const isGPT51CodexMaxModel = (model: Model): boolean => sharedIsGPT51CodexMaxModel(toSharedCompatModel(model))

export const isOpenAIOpenWeightModel = (model: Model): boolean =>
  sharedIsOpenAIOpenWeightModel(toSharedCompatModel(model))

export const isGPT5SeriesModel = (model: Model): boolean => sharedIsGPT5SeriesModel(toSharedCompatModel(model))

export const isGPT5SeriesReasoningModel = (model: Model): boolean =>
  sharedIsGPT5SeriesReasoningModel(toSharedCompatModel(model))

export const isGPT5FamilyModel = (model: Model): boolean => sharedIsGPT5FamilyModel(toSharedCompatModel(model))

export const isGPT51SeriesModel = (model: Model): boolean => sharedIsGPT51SeriesModel(toSharedCompatModel(model))

export const isGPT52SeriesModel = (model: Model): boolean => sharedIsGPT52SeriesModel(toSharedCompatModel(model))

export const isSupportVerbosityModel = isGPT5FamilyModel

export const isSupportNoneReasoningEffortModel = (model: Model): boolean =>
  sharedIsSupportNoneReasoningEffortModel(toSharedCompatModel(model))

export const isOpenAIChatCompletionOnlyModel = (model?: Model): boolean =>
  model ? sharedIsOpenAIChatCompletionOnlyModel(toSharedCompatModel(model)) : false

export const isOpenAIReasoningModel = (model: Model): boolean =>
  sharedIsOpenAIReasoningModel(toSharedCompatModel(model))

export const isSupportedReasoningEffortOpenAIModel = (model: Model): boolean =>
  sharedIsSupportedReasoningEffortOpenAIModel(toSharedCompatModel(model))

export const isOpenAIDeepResearchModel = (model?: Model): boolean =>
  model ? sharedIsOpenAIDeepResearchModel(toSharedCompatModel(model)) : false
