import {
  ENDPOINT_TYPE,
  MODALITY,
  type Modality,
  type Model,
  MODEL_CAPABILITY,
  type ModelCapability,
  parseUniqueModelId
} from '@shared/data/types/model'

import type {
  AddModelDrawerPrefill,
  ModelBasicFormState,
  ModelCapabilityToggle,
  ModelClassificationState,
  ModelDrawerEndpointType,
  ModelInputModality
} from './types'

const TOGGLE_TO_CAPABILITY: Record<ModelCapabilityToggle, ModelCapability> = {
  [MODEL_CAPABILITY.REASONING]: MODEL_CAPABILITY.REASONING,
  [MODEL_CAPABILITY.FUNCTION_CALL]: MODEL_CAPABILITY.FUNCTION_CALL,
  [MODEL_CAPABILITY.WEB_SEARCH]: MODEL_CAPABILITY.WEB_SEARCH
}

const CAPABILITY_TO_TOGGLE: Record<string, ModelCapabilityToggle> = Object.fromEntries(
  Object.entries(TOGGLE_TO_CAPABILITY).map(([key, value]) => [value, key as ModelCapabilityToggle])
) as Record<string, ModelCapabilityToggle>

export const MODEL_DRAWER_CURRENCY_SYMBOLS = ['$', '¥'] as const

export const MODEL_ENDPOINT_OPTIONS = [
  { id: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS, label: 'endpoint_type.openai' },
  { id: ENDPOINT_TYPE.OPENAI_RESPONSES, label: 'endpoint_type.openai-response' },
  { id: ENDPOINT_TYPE.ANTHROPIC_MESSAGES, label: 'endpoint_type.anthropic' },
  { id: ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT, label: 'endpoint_type.gemini' },
  { id: ENDPOINT_TYPE.OPENAI_EMBEDDINGS, label: 'endpoint_type.openai-embeddings' },
  { id: ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION, label: 'endpoint_type.image-generation' },
  { id: ENDPOINT_TYPE.OPENAI_IMAGE_EDIT, label: 'endpoint_type.image-edit' },
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
    contextWindow: prefill?.model?.contextWindow != null ? String(prefill.model.contextWindow) : '',
    maxInputTokens: prefill?.model?.maxInputTokens != null ? String(prefill.model.maxInputTokens) : '',
    maxOutputTokens: prefill?.model?.maxOutputTokens != null ? String(prefill.model.maxOutputTokens) : '',
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
    const toggle = CAPABILITY_TO_TOGGLE[capability]
    if (toggle) {
      selected.add(toggle)
    }
  }

  return selected
}

const MODEL_PRIMARY_TYPE_CAPABILITIES = [
  MODEL_CAPABILITY.IMAGE_GENERATION,
  MODEL_CAPABILITY.EMBEDDING,
  MODEL_CAPABILITY.RERANK
] as const satisfies readonly ModelCapability[]

const UNEDITABLE_MODEL_TYPE_CAPABILITIES = new Set<ModelCapability>([
  MODEL_CAPABILITY.AUDIO_GENERATION,
  MODEL_CAPABILITY.VIDEO_GENERATION,
  MODEL_CAPABILITY.AUDIO_TRANSCRIPT
])

const LEGACY_INPUT_MODALITY_CAPABILITIES = [
  MODEL_CAPABILITY.IMAGE_RECOGNITION,
  MODEL_CAPABILITY.AUDIO_RECOGNITION,
  MODEL_CAPABILITY.VIDEO_RECOGNITION
] as const satisfies readonly ModelCapability[]

const PRIMARY_TYPE_TO_CAPABILITY = {
  image: MODEL_CAPABILITY.IMAGE_GENERATION,
  embedding: MODEL_CAPABILITY.EMBEDDING,
  rerank: MODEL_CAPABILITY.RERANK
} as const

const INPUT_MODALITY_TO_LEGACY_CAPABILITY = {
  [MODALITY.IMAGE]: MODEL_CAPABILITY.IMAGE_RECOGNITION,
  [MODALITY.AUDIO]: MODEL_CAPABILITY.AUDIO_RECOGNITION,
  [MODALITY.VIDEO]: MODEL_CAPABILITY.VIDEO_RECOGNITION
} as const

export function getInitialModelClassification(model?: Model | null): ModelClassificationState {
  const capabilities = model?.capabilities ?? []
  let primaryType: ModelClassificationState['primaryType'] = 'text'

  if (capabilities.includes(MODEL_CAPABILITY.RERANK)) {
    primaryType = 'rerank'
  } else if (capabilities.includes(MODEL_CAPABILITY.EMBEDDING)) {
    primaryType = 'embedding'
  } else if (capabilities.includes(MODEL_CAPABILITY.IMAGE_GENERATION)) {
    primaryType = 'image'
  } else if (capabilities.some((capability) => UNEDITABLE_MODEL_TYPE_CAPABILITIES.has(capability))) {
    // These catalog types are intentionally not editable until they have a
    // complete custom-model execution path. Keep the source capability intact.
    primaryType = null
  }

  const inputModalities = new Set<ModelInputModality>()
  for (const modality of [MODALITY.IMAGE, MODALITY.AUDIO, MODALITY.VIDEO] as const) {
    if (
      model?.inputModalities?.includes(modality) ||
      capabilities.includes(INPUT_MODALITY_TO_LEGACY_CAPABILITY[modality])
    ) {
      inputModalities.add(modality)
    }
  }

  return {
    primaryType,
    capabilities: capsToToggleSet(capabilities),
    inputModalities
  }
}

export function buildModelCapabilities(
  original: readonly ModelCapability[],
  classification: ModelClassificationState
): ModelCapability[] {
  const managedCapabilities = new Set<ModelCapability>([
    ...MODEL_PRIMARY_TYPE_CAPABILITIES,
    ...LEGACY_INPUT_MODALITY_CAPABILITIES,
    ...Object.values(TOGGLE_TO_CAPABILITY)
  ])
  if (classification.primaryType !== null) {
    for (const capability of UNEDITABLE_MODEL_TYPE_CAPABILITIES) {
      managedCapabilities.add(capability)
    }
  }
  const next = original.filter((capability) => !managedCapabilities.has(capability))

  if (classification.primaryType && classification.primaryType !== 'text') {
    next.push(PRIMARY_TYPE_TO_CAPABILITY[classification.primaryType])
  }

  for (const toggle of classification.capabilities) {
    next.push(TOGGLE_TO_CAPABILITY[toggle])
  }

  return next
}

export function buildModelInputModalities(
  original: readonly Modality[],
  classification: ModelClassificationState
): Modality[] {
  const managedModalities = new Set<Modality>([MODALITY.IMAGE, MODALITY.AUDIO, MODALITY.VIDEO])
  const next = original.filter((modality) => !managedModalities.has(modality))

  for (const modality of [MODALITY.IMAGE, MODALITY.AUDIO, MODALITY.VIDEO] as const) {
    if (classification.inputModalities.has(modality)) {
      next.push(modality)
    }
  }

  return next
}

export function areModelClassificationsEqual(left: ModelClassificationState, right: ModelClassificationState): boolean {
  if (left.primaryType !== right.primaryType) {
    return false
  }

  return (
    left.capabilities.size === right.capabilities.size &&
    [...left.capabilities].every((capability) => right.capabilities.has(capability)) &&
    left.inputModalities.size === right.inputModalities.size &&
    [...left.inputModalities].every((modality) => right.inputModalities.has(modality))
  )
}
