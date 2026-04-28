import {
  isEmbeddingModel,
  isFunctionCallingModel,
  isReasoningModel,
  isRerankModel,
  isVisionModel,
  isWebSearchModel
} from '@renderer/pages/settings/ProviderSettingsV2/config/models'
import { ENDPOINT_TYPE, type Model, MODEL_CAPABILITY, parseUniqueModelId } from '@shared/data/types/model'

import type {
  AddModelDrawerPrefill,
  ModelBasicFormState,
  ModelCapabilityToggle,
  ModelDrawerEndpointType
} from './types'

const TOGGLE_TO_V2: Record<ModelCapabilityToggle, string> = {
  vision: MODEL_CAPABILITY.IMAGE_RECOGNITION,
  reasoning: MODEL_CAPABILITY.REASONING,
  function_calling: MODEL_CAPABILITY.FUNCTION_CALL,
  web_search: MODEL_CAPABILITY.WEB_SEARCH,
  embedding: MODEL_CAPABILITY.EMBEDDING,
  rerank: MODEL_CAPABILITY.RERANK
}

const V2_TO_TOGGLE: Record<string, ModelCapabilityToggle> = Object.fromEntries(
  Object.entries(TOGGLE_TO_V2).map(([key, value]) => [value, key as ModelCapabilityToggle])
) as Record<string, ModelCapabilityToggle>

export const MODEL_DRAWER_CURRENCY_SYMBOLS = ['$', '¥', '€', '£'] as const

export const MODEL_ENDPOINT_OPTIONS = [
  { id: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS, label: 'endpoint_type.openai' },
  { id: ENDPOINT_TYPE.OPENAI_RESPONSES, label: 'endpoint_type.openai-response' },
  { id: ENDPOINT_TYPE.ANTHROPIC_MESSAGES, label: 'endpoint_type.anthropic' },
  { id: ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT, label: 'endpoint_type.gemini' },
  { id: ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION, label: 'endpoint_type.image-generation' },
  { id: ENDPOINT_TYPE.JINA_RERANK, label: 'endpoint_type.jina-rerank' }
] as const

export function getModelApiId(model: Model): string {
  return model.apiModelId ?? parseUniqueModelId(model.id).modelId
}

function resolveInitialEndpointTypes(
  prefill: AddModelDrawerPrefill | null | undefined,
  defaultEndpointType: ModelDrawerEndpointType
): ModelDrawerEndpointType[] {
  if (prefill?.endpointTypes?.length) {
    return [...prefill.endpointTypes]
  }
  if (prefill?.model?.endpointTypes?.length) {
    return [...prefill.model.endpointTypes]
  }
  if (prefill?.endpointType) {
    return [prefill.endpointType]
  }
  return [defaultEndpointType]
}

export function getInitialAddModelFormState(
  prefill: AddModelDrawerPrefill | null | undefined,
  defaultEndpointType: ModelDrawerEndpointType = ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
): ModelBasicFormState {
  return {
    modelId: prefill?.model ? getModelApiId(prefill.model) : '',
    name: prefill?.model?.name ?? '',
    group: prefill?.model?.group ?? '',
    endpointTypes: resolveInitialEndpointTypes(prefill, defaultEndpointType)
  }
}

export function splitModelIds(rawModelId: string): string[] {
  return rawModelId
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

export function readCurrency(model: Model): string {
  return model.pricing?.input?.currency ?? model.pricing?.output?.currency ?? '$'
}

export function capsToToggleSet(capabilities: string[]): Set<ModelCapabilityToggle> {
  const selected = new Set<ModelCapabilityToggle>()

  for (const capability of capabilities) {
    const toggle = V2_TO_TOGGLE[capability]
    if (toggle) {
      selected.add(toggle)
    }
  }

  return selected
}

export function toggleSetToCaps(original: string[], selected: Set<ModelCapabilityToggle>): string[] {
  const toggleCapabilities = new Set(Object.values(TOGGLE_TO_V2))
  const next = original.filter((capability) => !toggleCapabilities.has(capability))

  for (const toggle of selected) {
    next.push(TOGGLE_TO_V2[toggle])
  }

  return next
}

export function getInitialSelectedCapabilities(model: Model): Set<ModelCapabilityToggle> {
  const inferred = new Set<ModelCapabilityToggle>([
    ...(isVisionModel(model) ? (['vision'] as const) : []),
    ...(isReasoningModel(model) ? (['reasoning'] as const) : []),
    ...(isFunctionCallingModel(model) ? (['function_calling'] as const) : []),
    ...(isWebSearchModel(model) ? (['web_search'] as const) : []),
    ...(isEmbeddingModel(model) ? (['embedding'] as const) : []),
    ...(isRerankModel(model) ? (['rerank'] as const) : [])
  ])

  return new Set([...capsToToggleSet(model.capabilities ?? []), ...inferred])
}
