import { useProviderAuthConfig } from '@renderer/hooks/useProvider'
import type { Provider } from '@shared/data/types/provider'
import { getProviderHostTopology } from '@shared/utils/providerTopology'
import { useMemo } from 'react'

import { buildHostEndpointPreviews } from './buildHostEndpointPreviews'

/** Derives endpoint preview URLs and reset affordances from the current host drafts. */
export function useProviderHostPreview(params: {
  provider: Provider | undefined
  apiHost: string
  anthropicApiHost: string
  /** Registry factory-default host for the primary endpoint; '' when none. */
  defaultApiHost: string
}) {
  const { provider, apiHost, anthropicApiHost, defaultApiHost } = params
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
    return {
      ...previews,
      isApiHostResettable: Boolean(defaultApiHost && apiHost !== defaultApiHost)
    }
  }, [anthropicApiHost, apiHost, authConfig, defaultApiHost, provider])
}
