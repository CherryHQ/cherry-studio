import { isAnthropicProvider, isVertexProvider } from '@renderer/pages/settings/ProviderSettings/utils/provider'
import { getProviderHostTopology } from '@renderer/pages/settings/ProviderSettings/utils/providerTopology'
import type { Provider } from '@shared/data/types/provider'
import { useCallback, useEffect, useRef, useState } from 'react'

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
  const apiHostDirtyRef = useRef(false)
  const anthropicApiHostDirtyRef = useRef(false)
  const apiVersionDirtyRef = useRef(false)

  useEffect(() => {
    if (!provider || provider.id === 'copilot') {
      return
    }

    if (apiHostDirtyRef.current) {
      if (apiHost === providerApiHost) {
        apiHostDirtyRef.current = false
      }
      return
    }

    setApiHostValue(providerApiHost)
  }, [apiHost, provider, providerApiHost])

  useEffect(() => {
    if (anthropicApiHostDirtyRef.current) {
      if (anthropicApiHost === providerAnthropicHost) {
        anthropicApiHostDirtyRef.current = false
      }
      return
    }

    setAnthropicApiHost(providerAnthropicHost)
  }, [anthropicApiHost, providerAnthropicHost])

  useEffect(() => {
    if (apiVersionDirtyRef.current) {
      if (apiVersion === providerApiVersion) {
        apiVersionDirtyRef.current = false
      }
      return
    }

    setApiVersion(providerApiVersion)
  }, [apiVersion, providerApiVersion])

  const setApiHost = useCallback((value: string) => {
    apiHostDirtyRef.current = true
    setApiHostValue(value)
  }, [])

  const setAnthropicApiHostDraft = useCallback((value: string) => {
    anthropicApiHostDirtyRef.current = true
    setAnthropicApiHost(value)
  }, [])

  const setApiVersionDraft = useCallback((value: string) => {
    apiVersionDirtyRef.current = true
    setApiVersion(value)
  }, [])

  return {
    apiHost,
    setApiHost,
    anthropicApiHost,
    setAnthropicApiHost: setAnthropicApiHostDraft,
    apiVersion,
    setApiVersion: setApiVersionDraft,
    primaryEndpoint,
    providerApiHost,
    providerAnthropicHost,
    isVertexProvider: provider ? isVertexProvider(provider) : false,
    isAnthropicProvider: provider ? isAnthropicProvider(provider) : false,
    isCherryIN
  }
}
