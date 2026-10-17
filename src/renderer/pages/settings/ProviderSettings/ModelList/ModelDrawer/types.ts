import type { EndpointType, Model } from '@shared/data/types/model'

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

export type ModelMetadata = Pick<Model, 'capabilities' | 'inputModalities' | 'outputModalities'>
