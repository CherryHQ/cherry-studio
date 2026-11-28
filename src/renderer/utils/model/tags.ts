import {
  MODALITY,
  type Modality,
  type Model,
  MODEL_CAPABILITY,
  type ModelCapability,
  type ModelTag,
  SERVER_TOOL
} from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { isFreeModel } from '@shared/utils/model'
import { isBuiltinWebSearchAvailable } from '@shared/utils/provider'

export type ModelDisplayTagSource = Pick<Model, 'id' | 'name' | 'providerId' | 'capabilities' | 'inputModalities'>

export const MODEL_DISPLAY_CAPABILITY_TAGS = [
  // Input modalities
  MODEL_CAPABILITY.IMAGE_RECOGNITION,
  MODEL_CAPABILITY.AUDIO_RECOGNITION,
  MODEL_CAPABILITY.VIDEO_RECOGNITION,
  // Capabilities
  MODEL_CAPABILITY.REASONING,
  MODEL_CAPABILITY.FUNCTION_CALL,
  MODEL_CAPABILITY.EMBEDDING,
  MODEL_CAPABILITY.RERANK
] as const satisfies readonly ModelCapability[]

export const MODEL_DISPLAY_TAGS = [
  ...MODEL_DISPLAY_CAPABILITY_TAGS,
  SERVER_TOOL.WEB_SEARCH,
  'free'
] as const satisfies readonly ModelTag[]

export type ModelDisplayCapabilityTag = (typeof MODEL_DISPLAY_CAPABILITY_TAGS)[number]
export type ModelDisplayTag = (typeof MODEL_DISPLAY_TAGS)[number]

const INPUT_MODALITY_BY_DISPLAY_TAG: Partial<Record<ModelDisplayCapabilityTag, Modality>> = {
  [MODEL_CAPABILITY.IMAGE_RECOGNITION]: MODALITY.IMAGE,
  [MODEL_CAPABILITY.AUDIO_RECOGNITION]: MODALITY.AUDIO,
  [MODEL_CAPABILITY.VIDEO_RECOGNITION]: MODALITY.VIDEO
}

export interface ModelTagVisibilityOptions {
  showFree?: boolean
  showReasoning?: boolean
  showToolsCalling?: boolean
}

export function isModelTagVisible(
  tag: ModelDisplayTag,
  { showFree = true, showReasoning = true, showToolsCalling = true }: ModelTagVisibilityOptions = {}
) {
  if (tag === 'free') {
    return showFree
  }

  if (tag === MODEL_CAPABILITY.REASONING) {
    return showReasoning
  }

  if (tag === MODEL_CAPABILITY.FUNCTION_CALL) {
    return showToolsCalling
  }

  return true
}

export function modelMatchesDisplayTag(
  model: ModelDisplayTagSource,
  tag: ModelDisplayTag,
  provider?: Pick<Provider, 'id' | 'presetProviderId' | 'defaultChatEndpoint' | 'serverTools'>
) {
  if (tag === 'free') {
    return isFreeModel(model)
  }

  if (tag === SERVER_TOOL.WEB_SEARCH) {
    return provider ? isBuiltinWebSearchAvailable(model as Model, provider) : false
  }

  return modelMatchesDisplayCapabilityTag(model, tag)
}

function modelMatchesDisplayCapabilityTag(
  model: Pick<Model, 'capabilities' | 'inputModalities'>,
  tag: ModelDisplayCapabilityTag
) {
  const inputModality = INPUT_MODALITY_BY_DISPLAY_TAG[tag]
  return model.capabilities.includes(tag) || Boolean(inputModality && model.inputModalities?.includes(inputModality))
}

export function getModelDisplayCapabilityTags(model: Pick<Model, 'capabilities' | 'inputModalities'>) {
  return MODEL_DISPLAY_CAPABILITY_TAGS.filter((tag) => modelMatchesDisplayCapabilityTag(model, tag))
}

export function getModelDisplayTags(
  model: ModelDisplayTagSource,
  options?: ModelTagVisibilityOptions,
  provider?: Pick<Provider, 'id' | 'presetProviderId' | 'defaultChatEndpoint' | 'serverTools'>
) {
  return MODEL_DISPLAY_TAGS.filter(
    (tag) => isModelTagVisible(tag, options) && modelMatchesDisplayTag(model, tag, provider)
  )
}
