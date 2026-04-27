import type { EndpointType, Model } from '@shared/data/types/model'

export type ModelDrawerMode = 'legacy' | 'new-api'

export type ModelDrawerEndpointType = EndpointType

export interface AddModelDrawerPrefill {
  model?: Model
  endpointType?: ModelDrawerEndpointType
}

export interface ModelBasicFormState {
  modelId: string
  name: string
  group: string
  endpointType?: ModelDrawerEndpointType | ''
}

export type ModelCapabilityToggle = 'vision' | 'reasoning' | 'function_calling' | 'web_search' | 'embedding' | 'rerank'
