import { ENDPOINT_TYPE, type Model, parseUniqueModelId } from '@shared/data/types/model'

import type { AddModelDrawerPrefill, ModelBasicFormState, ModelDrawerEndpointType } from './types'

export const MODEL_ENDPOINT_OPTIONS = [
  { id: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS, label: 'endpoint_type.openai' },
  { id: ENDPOINT_TYPE.OPENAI_RESPONSES, label: 'endpoint_type.openai-response' },
  { id: ENDPOINT_TYPE.ANTHROPIC_MESSAGES, label: 'endpoint_type.anthropic' },
  { id: ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT, label: 'endpoint_type.gemini' },
  { id: ENDPOINT_TYPE.OPENAI_EMBEDDINGS, label: 'endpoint_type.openai-embeddings' },
  { id: ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION, label: 'endpoint_type.image-generation' },
  { id: ENDPOINT_TYPE.OPENAI_IMAGE_EDIT, label: 'endpoint_type.image-edit' },
  { id: ENDPOINT_TYPE.OPENAI_TEXT_TO_SPEECH, label: 'settings.voice.speech.title' },
  { id: ENDPOINT_TYPE.JINA_RERANK, label: 'endpoint_type.jina-rerank' }
] as const

export function getModelApiId(model: Model): string {
  return model.apiModelId ?? parseUniqueModelId(model.id).modelId
}

function resolveInitialEndpointTypes(
  prefill: AddModelDrawerPrefill | null | undefined,
  defaultEndpointType?: ModelDrawerEndpointType
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
  return defaultEndpointType ? [defaultEndpointType] : []
}

export function getInitialAddModelFormState(
  prefill: AddModelDrawerPrefill | null | undefined,
  defaultEndpointType?: ModelDrawerEndpointType
): ModelBasicFormState {
  return {
    modelId: prefill?.model ? getModelApiId(prefill.model) : '',
    name: prefill?.model?.name ?? '',
    group: prefill?.model?.group ?? '',
    contextWindow: prefill?.model?.contextWindow ?? null,
    maxInputTokens: prefill?.model?.maxInputTokens ?? null,
    maxOutputTokens: prefill?.model?.maxOutputTokens ?? null,
    endpointTypes: resolveInitialEndpointTypes(prefill, defaultEndpointType)
  }
}

export function splitModelIds(rawModelId: string): string[] {
  return [
    ...new Set(
      rawModelId
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    )
  ]
}

export function toggleModelValue<T>(values: readonly T[] | undefined, value: T): T[] {
  return values?.includes(value) ? values.filter((item) => item !== value) : [...(values ?? []), value]
}
