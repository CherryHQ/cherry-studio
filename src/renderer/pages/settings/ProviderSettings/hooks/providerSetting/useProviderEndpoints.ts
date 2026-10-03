import { useEffect, useRef, useState } from 'react'

import type { Provider } from '@shared/data/types/provider'
import { isAnthropicProvider, isVertexProvider } from '@shared/utils/provider'
import { getProviderHostTopology } from '@shared/utils/providerTopology'

type ProviderEndpointSnapshot = {
  providerId: string | undefined
  apiHost: string
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
  const [apiVersion, setApiVersion] = useState(providerApiVersion)
  const previousServerEndpoint = useRef<ProviderEndpointSnapshot>({
    providerId,
    apiHost: providerApiHost,
    apiVersion: providerApiVersion
  })

  useEffect(() => {
    const previous = previousServerEndpoint.current
    const providerChanged = previous.providerId !== providerId

    setApiHostValue((current) => (providerChanged || current === previous.apiHost ? providerApiHost : current))
    setApiVersion((current) => (providerChanged || current === previous.apiVersion ? providerApiVersion : current))

    previousServerEndpoint.current = {
      providerId,
      apiHost: providerApiHost,
      apiVersion: providerApiVersion
    }
  }, [providerId, providerApiHost, providerApiVersion])

  return {
    apiHost,
    setApiHost: setApiHostValue,
    anthropicApiHost: providerAnthropicHost,
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
