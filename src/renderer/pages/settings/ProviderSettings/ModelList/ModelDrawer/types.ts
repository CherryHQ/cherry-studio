import {
  type EndpointType,
  MODALITY,
  type Modality,
  type Model,
  MODEL_CAPABILITY,
  type ModelCapability
} from '@shared/data/types/model'

export type ModelDrawerMode = 'legacy' | 'new-api'

export type ModelDrawerEndpointType = EndpointType

export interface AddModelDrawerPrefill {
  model?: Model
  endpointType?: ModelDrawerEndpointType
  endpointTypes?: ModelDrawerEndpointType[]
}

export interface ModelBasicFormState {
  modelId: string
  name: string
  group: string
  contextWindow: string
  maxInputTokens: string
  maxOutputTokens: string
  endpointTypes?: ModelDrawerEndpointType[]
}

export const MODEL_CAPABILITY_TOGGLE_VALUES = [
  MODEL_CAPABILITY.REASONING,
  MODEL_CAPABILITY.FUNCTION_CALL,
  MODEL_CAPABILITY.WEB_SEARCH
] as const satisfies readonly ModelCapability[]

export type ModelCapabilityToggle = (typeof MODEL_CAPABILITY_TOGGLE_VALUES)[number]

export const MODEL_PRIMARY_TYPE_VALUES = ['text', 'image', 'embedding', 'rerank'] as const

export type ModelPrimaryType = (typeof MODEL_PRIMARY_TYPE_VALUES)[number]

export const MODEL_INPUT_MODALITY_VALUES = [
  MODALITY.IMAGE,
  MODALITY.AUDIO,
  MODALITY.VIDEO
] as const satisfies readonly Modality[]

export type ModelInputModality = (typeof MODEL_INPUT_MODALITY_VALUES)[number]

export interface ModelClassificationState {
  primaryType: ModelPrimaryType | null
  capabilities: Set<ModelCapabilityToggle>
  inputModalities: Set<ModelInputModality>
}
