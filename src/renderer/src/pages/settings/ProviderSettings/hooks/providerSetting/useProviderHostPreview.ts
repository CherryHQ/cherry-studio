import { PROVIDER_URLS } from '@renderer/config/providers'
import { useProviderAuthConfig } from '@renderer/hooks/useProviders'
import { getProviderHostTopology } from '@renderer/pages/settings/ProviderSettings/utils/providerTopology'
import type { Provider } from '@shared/data/types/provider'
import { useMemo } from 'react'

import { buildHostEndpointPreviews } from './buildHostEndpointPreviews'

/** Derives endpoint preview URLs and reset affordances from the current host drafts. */
export function useProviderHostPreview(params: {
  provider: Provider | undefined
  apiHost: string
  anthropicApiHost: string
}) {
  const { provider, apiHost, anthropicApiHost } = params
  // Vertex preview reads project/location from authConfig; safe to fetch
  // unconditionally — SWR dedupes and other providers ignore the result.
  const { data: authConfig } = useProviderAuthConfig(provider?.id ?? '')

  return useMemo(() => {
    if (!provider) {
      return {
        hostPreview: '',
        anthropicHostPreview: '',
        isApiHostResettable: false
      }
    }

    const topology = getProviderHostTopology(provider)
    const previews = buildHostEndpointPreviews({
      provider,
      authConfig,
      primaryEndpoint: topology.primaryEndpoint,
      apiHost,
      anthropicApiHost,
      providerAnthropicHost: topology.anthropicBaseUrl
    })
    const configuredApiHost = provider ? PROVIDER_URLS[provider.id as keyof typeof PROVIDER_URLS]?.api?.url : undefined

    return {
      ...previews,
      isApiHostResettable: Boolean(configuredApiHost && apiHost !== configuredApiHost)
    }
  }, [anthropicApiHost, apiHost, authConfig, provider])
}
