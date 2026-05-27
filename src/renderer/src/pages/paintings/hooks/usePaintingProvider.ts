import { useModels } from '@renderer/hooks/useModels'
import { useProviderApiKeys, useProviders as useDataApiProviders } from '@renderer/hooks/useProviders'
import { toV1ModelShim, toV1ProviderShim } from '@renderer/pages/settings/ProviderSettings/utils/v1ProviderShim'
import type { Model as LegacyModel, Provider as LegacyProvider } from '@renderer/types'
import { ENDPOINT_TYPE, type EndpointType, type Model as DataModel } from '@shared/data/types/model'
import type { Provider as DataProvider } from '@shared/data/types/provider'
import { useMemo } from 'react'

const OPENAI_IMAGE_ENDPOINTS = new Set<EndpointType>([
  ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION,
  ENDPOINT_TYPE.OPENAI_IMAGE_EDIT
])

function toLegacyEndpointType(endpointType: EndpointType): LegacyModel['endpoint_type'] {
  if (OPENAI_IMAGE_ENDPOINTS.has(endpointType)) {
    return 'image-generation'
  }

  switch (endpointType) {
    case ENDPOINT_TYPE.ANTHROPIC_MESSAGES:
      return 'anthropic'
    case ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT:
      return 'gemini'
    case ENDPOINT_TYPE.JINA_RERANK:
      return 'jina-rerank'
    case ENDPOINT_TYPE.OPENAI_RESPONSES:
      return 'openai-response'
    case ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS:
    case ENDPOINT_TYPE.OPENAI_TEXT_COMPLETIONS:
      return 'openai'
    default:
      return undefined
  }
}

function toPaintingModel(model: DataModel): LegacyModel {
  const legacyModel = toV1ModelShim(model)
  const endpointTypes = model.endpointTypes
    ?.map(toLegacyEndpointType)
    .filter((endpointType): endpointType is NonNullable<LegacyModel['endpoint_type']> => endpointType !== undefined)

  return {
    ...legacyModel,
    endpoint_type: endpointTypes?.[0],
    supported_endpoint_types: endpointTypes
  }
}

function getPaintingApiHost(provider: DataProvider): string | undefined {
  return (
    provider.endpointConfigs?.[ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION]?.baseUrl ??
    provider.endpointConfigs?.[ENDPOINT_TYPE.OPENAI_IMAGE_EDIT]?.baseUrl
  )
}

function toPaintingProvider(provider: DataProvider, models: DataModel[], apiKeys: string[] = []): LegacyProvider {
  const legacyProvider = toV1ProviderShim(provider, {
    apiKey: apiKeys.join(','),
    apiHost: getPaintingApiHost(provider)
  })

  return {
    ...legacyProvider,
    models: models.map(toPaintingModel)
  }
}

function createFallbackProvider(providerId: string): LegacyProvider {
  return {
    id: providerId,
    name: providerId,
    type: 'openai',
    apiKey: '',
    apiHost: '',
    models: [],
    enabled: false
  }
}

export function usePaintingProvider(providerId: string) {
  const { providers, isLoading: isProviderLoading } = useDataApiProviders()
  const { models, isLoading: isModelsLoading } = useModels({ providerId }, { fetchEnabled: providerId.length > 0 })
  const { data: apiKeysData, isLoading: isApiKeysLoading } = useProviderApiKeys(providerId, {
    enabled: providerId.length > 0,
    onlyEnabled: true
  })

  const provider = useMemo(() => {
    const dataProvider = providers.find((item) => item.id === providerId)
    if (!dataProvider) {
      return createFallbackProvider(providerId)
    }

    const apiKeys = apiKeysData?.keys.map((entry) => entry.key) ?? []
    return toPaintingProvider(dataProvider, models, apiKeys)
  }, [apiKeysData?.keys, models, providerId, providers])

  return {
    provider,
    isLoading: isProviderLoading || isModelsLoading || isApiKeysLoading
  }
}

export function usePaintingProviders() {
  const { providers, isLoading: isProvidersLoading } = useDataApiProviders()
  const { models, isLoading: isModelsLoading } = useModels()

  const paintingProviders = useMemo(
    () =>
      providers.map((provider) =>
        toPaintingProvider(
          provider,
          models.filter((model) => model.providerId === provider.id)
        )
      ),
    [models, providers]
  )

  return {
    providers: paintingProviders,
    isLoading: isProvidersLoading || isModelsLoading
  }
}
