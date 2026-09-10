import {
  type EndpointType,
  MODALITY,
  type Modality,
  type Model,
  MODEL_CAPABILITY,
  type ModelCapability,
  type ModelOperationCapability
} from '@shared/data/types/model'

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
  contextWindow: number | null
  maxInputTokens: number | null
  maxOutputTokens: number | null
  endpointTypes?: ModelDrawerEndpointType[]
}

export const MODEL_CAPABILITY_TOGGLE_VALUES = [
  MODEL_CAPABILITY.REASONING,
  MODEL_CAPABILITY.FUNCTION_CALL
] as const satisfies readonly ModelCapability[]

export type ModelCapabilityToggle = (typeof MODEL_CAPABILITY_TOGGLE_VALUES)[number]

export const EDITABLE_MODEL_OPERATION_CAPABILITIES = [
  MODEL_CAPABILITY.TEXT_GENERATION,
  MODEL_CAPABILITY.IMAGE_GENERATION,
  MODEL_CAPABILITY.EMBEDDING,
  MODEL_CAPABILITY.RERANK
] as const satisfies readonly ModelOperationCapability[]

export type EditableModelOperationCapability = (typeof EDITABLE_MODEL_OPERATION_CAPABILITIES)[number]

export const MODEL_INPUT_MODALITY_VALUES = [
  MODALITY.IMAGE,
  MODALITY.AUDIO,
  MODALITY.VIDEO
] as const satisfies readonly Modality[]

export type ModelInputModality = (typeof MODEL_INPUT_MODALITY_VALUES)[number]

export interface ModelClassificationState {
  operationCapabilities: Set<ModelOperationCapability>
  capabilities: Set<ModelCapabilityToggle>
  inputModalities: Set<ModelInputModality>
}
