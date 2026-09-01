import {
  ENDPOINT_TYPE,
  endpointDefaultOperationCapability,
  type EndpointType,
  isEndpointCompatibleWithOperation,
  MODEL_CAPABILITY,
  type ModelOperationCapability,
  objectValues
} from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

type ProviderEndpoints = Pick<Provider, 'defaultChatEndpoint' | 'endpointConfigs'>

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
  modelEndpointTypes: readonly EndpointType[] | undefined,
  operationCapabilities: ReadonlySet<ModelOperationCapability>
): readonly EndpointType[] {
  if (!provider) return []
  const configured = new Set(resolveEndpointTypeOptions(provider, operationCapabilities))
  const candidates = modelEndpointTypes?.length
    ? modelEndpointTypes.filter((endpointType) => configured.has(endpointType))
    : [...configured]
  return candidates
}

export function resolveInheritedOperationCapability(
  endpointTypes: readonly EndpointType[],
  operationCapabilities: ReadonlySet<ModelOperationCapability>
): ModelOperationCapability | undefined {
  for (const endpointType of endpointTypes) {
    const endpointOperation = endpointDefaultOperationCapability(endpointType)
    if (endpointOperation && operationCapabilities.has(endpointOperation)) return endpointOperation

    const compatibleOperation = [...operationCapabilities].find((operation) =>
      isEndpointCompatibleWithOperation(endpointType, operation)
    )
    if (compatibleOperation) return compatibleOperation
  }
  if (operationCapabilities.has(MODEL_CAPABILITY.TEXT_GENERATION)) return MODEL_CAPABILITY.TEXT_GENERATION
  return [...operationCapabilities][0]
}
