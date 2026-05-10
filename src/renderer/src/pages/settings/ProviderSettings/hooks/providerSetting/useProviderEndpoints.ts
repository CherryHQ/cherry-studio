import { isAnthropicProvider, isVertexProvider } from '@renderer/pages/settings/ProviderSettings/utils/provider'
import { getProviderHostTopology } from '@renderer/pages/settings/ProviderSettings/utils/providerTopology'
import type { Provider } from '@shared/data/types/provider'
import { trim } from 'lodash'
import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Boundary rule: this is a domain-cohesive hook for the provider endpoint-draft subdomain.
 * It should internalize provider-local endpoint reads, translation lookups, and draft synchronization rules,
 * expose only the minimal UI-facing state/actions for endpoint editing, and converge toward providerId-only input
 * unless a true shared draft must stay owned by the nearest page/section owner.
 * Callers should pass only ids or true shared drafts, never page-assembled domain-local dependencies.
 *
 * Intent: own editable endpoint drafts and host-tab state for the provider settings connection UI.
 * Scope: use wherever Provider Settings renders endpoint inputs and needs provider -> draft synchronization.
 * Does not handle: persistence, connection checks, or model sync side effects.
 *
 * @example
 * ```tsx
 * const endpoints = useProviderEndpoints(provider)
 * <Input value={endpoints.apiHost} onChange={(event) => endpoints.setApiHost(event.target.value)} />
 * ```
 */
export function useProviderEndpoints(provider: Provider | undefined) {
  const topology = getProviderHostTopology(provider)
  const primaryEndpoint = topology.primaryEndpoint
  const providerApiHost = topology.primaryBaseUrl
  const providerAnthropicHost = topology.anthropicBaseUrl
  const providerApiVersion = provider?.settings?.apiVersion ?? ''
  const isCherryIN = provider?.id === 'cherryin'
  const providerId = provider?.id

  const [apiHost, setApiHostValue] = useState(providerApiHost)
  const [anthropicApiHost, setAnthropicApiHost] = useState(providerAnthropicHost)
  const [apiVersion, setApiVersion] = useState(providerApiVersion)
  const [expectedProviderApiHost, setExpectedProviderApiHost] = useState<string | null>(null)
  const previousProviderIdRef = useRef<string | undefined>(providerId)

  const setApiHost = useCallback(
    (value: string) => {
      const normalizedValue = trim(value)
      setApiHostValue(value)
      setExpectedProviderApiHost(normalizedValue === trim(providerApiHost) ? null : normalizedValue)
    },
    [providerApiHost]
  )

  useEffect(() => {
    if (previousProviderIdRef.current === providerId) {
      return
    }

    previousProviderIdRef.current = providerId

    if (!provider || provider.id === 'copilot') {
      return
    }

    setExpectedProviderApiHost(null)
    setApiHostValue(providerApiHost)
  }, [provider, providerApiHost, providerId])

  useEffect(() => {
    if (!provider || provider.id === 'copilot') {
      return
    }

    if (expectedProviderApiHost === null) {
      setApiHostValue(providerApiHost)
      return
    }

    if (trim(providerApiHost) === expectedProviderApiHost) {
      setExpectedProviderApiHost(null)
      setApiHostValue(providerApiHost)
    }
  }, [expectedProviderApiHost, provider, providerApiHost])

  useEffect(() => {
    setAnthropicApiHost(providerAnthropicHost)
  }, [providerAnthropicHost])

  useEffect(() => {
    setApiVersion(providerApiVersion)
  }, [providerApiVersion])

  return {
    apiHost,
    setApiHost,
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
