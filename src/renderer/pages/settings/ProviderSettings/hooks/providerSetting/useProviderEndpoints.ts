import { isAnthropicProvider, isVertexProvider } from '@renderer/pages/settings/ProviderSettings/utils/provider'
import { getProviderHostTopology } from '@renderer/pages/settings/ProviderSettings/utils/providerTopology'
import type { Provider } from '@shared/data/types/provider'
import { useEffect, useRef, useState } from 'react'

type ProviderEndpointSnapshot = {
  providerId: string | undefined
  apiHost: string
  anthropicApiHost: string
  apiVersion: string
}

/** Owns endpoint display state for the provider settings connection UI. */
export function useProviderEndpoints(provider: Provider | undefined) {
  const topology = getProviderHostTopology(provider)
  const providerId = provider?.id
  const primaryEndpoint = topology.primaryEndpoint
  const providerApiHost = topology.primaryBaseUrl
  const providerAnthropicHost = topology.anthropicBaseUrl
  const providerApiVersion = provider?.settings?.apiVersion ?? ''
  const isCherryIN = provider?.id === 'cherryin'

  const [apiHost, setApiHostValue] = useState(providerApiHost)
  const [anthropicApiHost, setAnthropicApiHost] = useState(providerAnthropicHost)
  const [apiVersion, setApiVersion] = useState(providerApiVersion)
  const previousServerEndpoint = useRef<ProviderEndpointSnapshot>({
    providerId,
    apiHost: providerApiHost,
    anthropicApiHost: providerAnthropicHost,
    apiVersion: providerApiVersion
  })

  useEffect(() => {
    const previous = previousServerEndpoint.current
    const providerChanged = previous.providerId !== providerId

    setApiHostValue((current) => (providerChanged || current === previous.apiHost ? providerApiHost : current))
    setAnthropicApiHost((current) =>
      providerChanged || current === previous.anthropicApiHost ? providerAnthropicHost : current
    )
    setApiVersion((current) => (providerChanged || current === previous.apiVersion ? providerApiVersion : current))

    previousServerEndpoint.current = {
      providerId,
      apiHost: providerApiHost,
      anthropicApiHost: providerAnthropicHost,
      apiVersion: providerApiVersion
    }
  }, [providerId, providerApiHost, providerAnthropicHost, providerApiVersion])

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
