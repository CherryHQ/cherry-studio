import { isAnthropicProvider, isVertexProvider } from '@renderer/pages/settings/ProviderSettings/utils/provider'
import { getProviderHostTopology } from '@renderer/pages/settings/ProviderSettings/utils/providerTopology'
import type { Provider } from '@shared/data/types/provider'
import { useState } from 'react'

/** Owns endpoint display state for the provider settings connection UI. */
export function useProviderEndpoints(provider: Provider | undefined) {
  const topology = getProviderHostTopology(provider)
  const primaryEndpoint = topology.primaryEndpoint
  const providerApiHost = topology.primaryBaseUrl
  const providerAnthropicHost = topology.anthropicBaseUrl
  const providerApiVersion = provider?.settings?.apiVersion ?? ''
  const isCherryIN = provider?.id === 'cherryin'

  const [apiHost, setApiHostValue] = useState(providerApiHost)
  const [anthropicApiHost, setAnthropicApiHost] = useState(providerAnthropicHost)
  const [apiVersion, setApiVersion] = useState(providerApiVersion)

  return {
    apiHost,
    setApiHost: setApiHostValue,
    anthropicApiHost,
    setAnthropicApiHost,
    apiVersion,
    setApiVersion,
    primaryEndpoint,
    providerApiHost,
    providerAnthropicHost,
    isVertexProvider: provider ? isVertexProvider(provider) : false,
    isAnthropicProvider: provider ? isAnthropicProvider(provider) : false,
    isCherryIN
  }
}
