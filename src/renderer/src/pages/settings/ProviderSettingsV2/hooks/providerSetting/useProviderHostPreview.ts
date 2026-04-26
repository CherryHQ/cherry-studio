import { PROVIDER_URLS } from '@renderer/config/providers'
import { getProviderHostTopology } from '@renderer/pages/settings/ProviderSettingsV2/utils/providerTopology'
import type { Provider } from '@shared/data/types/provider'
import { useMemo } from 'react'

import { buildHostEndpointPreviews } from './buildHostEndpointPreviews'

/**
 * Intent: derive endpoint preview URLs and reset affordances from the current editable host drafts.
 * Scope: use in the Provider Settings connection UI when rendering preview help text and reset controls.
 * Does not handle: field visibility, persistence, or any provider patching.
 *
 * @example
 * ```tsx
 * const preview = useProviderHostPreview({ provider, apiHost, anthropicApiHost })
 * <p>{preview.hostPreview}</p>
 * ```
 */
export function useProviderHostPreview(params: {
  provider: Provider | undefined
  apiHost: string
  anthropicApiHost: string
}) {
  const { provider, apiHost, anthropicApiHost } = params

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
  }, [anthropicApiHost, apiHost, provider])
}
