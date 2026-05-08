import { type EndpointType, type Model, MODEL_CAPABILITY, type ModelCapability } from '@shared/data/types/model'

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
  maxInputTokens: string
  maxOutputTokens: string
  endpointTypes?: ModelDrawerEndpointType[]
}

export const MODEL_CAPABILITY_TOGGLE_VALUES = [
  MODEL_CAPABILITY.IMAGE_RECOGNITION,
  MODEL_CAPABILITY.REASONING,
  MODEL_CAPABILITY.FUNCTION_CALL,
  MODEL_CAPABILITY.WEB_SEARCH,
  MODEL_CAPABILITY.EMBEDDING,
  MODEL_CAPABILITY.RERANK
] as const satisfies readonly ModelCapability[]

export type ModelCapabilityToggle = (typeof MODEL_CAPABILITY_TOGGLE_VALUES)[number]
