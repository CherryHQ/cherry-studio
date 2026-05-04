import { dataApiService } from '@data/DataApiService'
import { withoutTrailingSlash } from '@renderer/utils/api'
import { ENDPOINT_TYPE } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

export interface PaintingProviderRuntime {
  id: string
  name: string
  presetProviderId?: string
  isEnabled: boolean
  apiHost: string
  getApiKey: () => Promise<string>
}

const NEW_API_PROVIDER_IDS = new Set(['new-api', 'cherryin', 'aionly'])

export function isPaintingNewApiProvider(provider: Pick<Provider, 'id' | 'presetProviderId'>) {
  return NEW_API_PROVIDER_IDS.has(provider.id) || provider.presetProviderId === 'new-api'
}

export function resolvePaintingApiHost(provider?: Provider): string {
  if (!provider?.endpointConfigs) {
    return ''
  }

  const endpointConfigs = provider.endpointConfigs
  const preferredEndpoint = provider.defaultChatEndpoint

  return withoutTrailingSlash(
    endpointConfigs[ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION]?.baseUrl ||
      (preferredEndpoint ? endpointConfigs[preferredEndpoint]?.baseUrl : undefined) ||
      endpointConfigs[ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]?.baseUrl ||
      ''
  )
}

export async function getPaintingProviderApiKey(providerId: string): Promise<string> {
  const response = await dataApiService.get(`/providers/${providerId}/rotated-key` as any)
  return (response as { apiKey?: string }).apiKey || ''
}

export function createPaintingProviderRuntime(
  provider: Provider | undefined,
  providerId: string
): PaintingProviderRuntime {
  return {
    id: provider?.id || providerId,
    name: provider?.name || providerId,
    presetProviderId: provider?.presetProviderId,
    isEnabled: provider?.isEnabled ?? false,
    apiHost: resolvePaintingApiHost(provider),
    getApiKey: () => getPaintingProviderApiKey(provider?.id || providerId)
  }
}
