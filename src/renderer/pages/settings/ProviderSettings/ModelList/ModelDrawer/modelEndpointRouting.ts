import {
  ENDPOINT_TYPE,
  type EndpointType,
  isEndpointCompatibleWithOperation,
  type ModelOperationCapability,
  objectValues
} from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { matchesPreset } from '@shared/utils/provider'
import { isSystemProviderId } from '@shared/utils/systemProviderId'

import type { ModelDrawerMode } from './types'

export const MODEL_CHAT_ENDPOINT_TYPES = [
  ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
  ENDPOINT_TYPE.OPENAI_RESPONSES,
  ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
  ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT
] as const

export type ModelChatEndpointType = (typeof MODEL_CHAT_ENDPOINT_TYPES)[number]

type ModelDrawerProvider = Pick<Provider, 'id' | 'presetProviderId'>
type ProviderEndpoints = Pick<Provider, 'defaultChatEndpoint' | 'endpointConfigs'> &
  Partial<Pick<Provider, 'id' | 'presetProviderId'>>

function isModelChatEndpointType(endpointType: string | undefined): endpointType is ModelChatEndpointType {
  return MODEL_CHAT_ENDPOINT_TYPES.some((candidate) => candidate === endpointType)
}

function isCompatibleWithAnyOperation(
  endpointType: EndpointType,
  operationCapabilities: ReadonlySet<ModelOperationCapability>
): boolean {
  return [...operationCapabilities].some((operation) => isEndpointCompatibleWithOperation(endpointType, operation))
}

function getConfiguredEndpointTypes(provider: ProviderEndpoints): EndpointType[] {
  const configured = new Set(Object.keys(provider.endpointConfigs ?? {}))
  return objectValues(ENDPOINT_TYPE).filter((endpointType) => configured.has(endpointType))
}

export function getModelDrawerMode(provider: ModelDrawerProvider): ModelDrawerMode {
  if (provider.presetProviderId == null && !isSystemProviderId(provider.id)) {
    return 'endpoint-types'
  }
  if (matchesPreset(provider, 'new-api') || matchesPreset(provider, 'cherryin') || matchesPreset(provider, 'aionly')) {
    return 'endpoint-types'
  }
  return 'legacy'
}

export function getProviderChatEndpointTypes(provider: ProviderEndpoints): ModelChatEndpointType[] {
  return getConfiguredEndpointTypes(provider).filter(isModelChatEndpointType)
}

export function resolveEndpointTypeOptions(
  provider: ProviderEndpoints | null | undefined,
  operationCapabilities: ReadonlySet<ModelOperationCapability>
): EndpointType[] {
  if (!provider) return []
  return getConfiguredEndpointTypes(provider).filter((endpointType) =>
    isCompatibleWithAnyOperation(endpointType, operationCapabilities)
  )
}

export function resolvePreferredEndpointOptions(
  provider: ProviderEndpoints | null | undefined,
  mode: ModelDrawerMode,
  modelEndpointTypes: readonly EndpointType[] | undefined,
  operationCapabilities: ReadonlySet<ModelOperationCapability>
): readonly EndpointType[] {
  if (!provider) return []
  const configured = new Set(resolveEndpointTypeOptions(provider, operationCapabilities))
  const candidates = modelEndpointTypes?.length
    ? modelEndpointTypes.filter((endpointType) => configured.has(endpointType))
    : [...configured]
  return mode === 'endpoint-types' || candidates.length > 1 ? candidates : []
}
