import { formatApiKeys, splitApiKeyString } from '@renderer/utils/api'
import type { WebSearchProviderUpdates } from '@renderer/utils/webSearchProviders'
import type { WebSearchCapability, WebSearchProviderId } from '@shared/data/preference/preferenceTypes'
import type { ResolvedWebSearchProvider } from '@shared/data/types/webSearch'
import { useCallback, useEffect, useMemo, useState } from 'react'

import type { ResolvedWebSearchProviderCapability } from '../utils/webSearchProviderMeta'

type UpdateProvider = (providerId: WebSearchProviderId, updates: WebSearchProviderUpdates) => Promise<void>

export function useWebSearchProviderForm(
  provider: ResolvedWebSearchProvider,
  updateProvider: UpdateProvider,
  activeCapability?: WebSearchCapability
) {
  const [apiKeys, setApiKeys] = useState<string[]>(provider.apiKeys)
  const [apiHosts, setApiHosts] = useState<Record<string, string>>({})
  const [basicAuthUsername, setBasicAuthUsername] = useState(provider.basicAuthUsername)
  const [basicAuthPassword, setBasicAuthPassword] = useState(provider.basicAuthPassword)

  useEffect(() => {
    setApiKeys(provider.apiKeys)
    setApiHosts(
      Object.fromEntries(provider.capabilities.map((capability) => [capability.feature, capability.apiHost ?? '']))
    )
    setBasicAuthUsername(provider.basicAuthUsername)
    setBasicAuthPassword(provider.basicAuthPassword)
  }, [provider.apiKeys, provider.capabilities, provider.basicAuthUsername, provider.basicAuthPassword])

  const apiKeyInput = useMemo(() => apiKeys.join(','), [apiKeys])
  const apiHostCapabilities = useMemo(
    () =>
      provider.capabilities.filter(
        (capability) =>
          capability.apiHost !== undefined && (!activeCapability || capability.feature === activeCapability)
      ),
    [activeCapability, provider.capabilities]
  )

  const setApiKeyInput = useCallback((value: string) => {
    setApiKeys(splitApiKeyString(formatApiKeys(value)))
  }, [])

  const commitApiKeys = useCallback(() => {
    if (apiKeyInput !== provider.apiKeys.join(',')) {
      void updateProvider(provider.id, { apiKeys })
    }
  }, [apiKeyInput, apiKeys, provider.apiKeys, provider.id, updateProvider])

  const setApiHostInput = useCallback((feature: string, value: string) => {
    setApiHosts((current) => ({ ...current, [feature]: value }))
  }, [])

  const commitApiHost = useCallback(
    (capability: ResolvedWebSearchProviderCapability) => {
      let trimmedHost = apiHosts[capability.feature]?.trim() || ''
      if (trimmedHost.endsWith('/')) {
        trimmedHost = trimmedHost.slice(0, -1)
      }

      if (trimmedHost !== (capability.apiHost ?? '')) {
        void updateProvider(provider.id, {
          capabilities: provider.capabilities.map((item) =>
            item.feature === capability.feature ? { ...item, apiHost: trimmedHost } : item
          )
        })
        return
      }

      setApiHosts((current) => ({ ...current, [capability.feature]: capability.apiHost ?? '' }))
    },
    [apiHosts, provider.capabilities, provider.id, updateProvider]
  )

  const commitBasicAuthUsername = useCallback(() => {
    const currentValue = basicAuthUsername || ''
    const savedValue = provider.basicAuthUsername || ''
    if (currentValue !== savedValue) {
      void updateProvider(provider.id, { basicAuthUsername })
      return
    }

    setBasicAuthUsername(provider.basicAuthUsername || '')
  }, [basicAuthUsername, provider.basicAuthUsername, provider.id, updateProvider])

  const commitBasicAuthPassword = useCallback(() => {
    const currentValue = basicAuthPassword || ''
    const savedValue = provider.basicAuthPassword || ''
    if (currentValue !== savedValue) {
      void updateProvider(provider.id, { basicAuthPassword })
      return
    }

    setBasicAuthPassword(provider.basicAuthPassword || '')
  }, [basicAuthPassword, provider.basicAuthPassword, provider.id, updateProvider])

  return {
    apiKeys,
    apiKeyInput,
    apiHosts,
    apiHostCapabilities,
    basicAuthUsername,
    basicAuthPassword,
    setApiKeyInput,
    setApiHostInput,
    setBasicAuthUsername,
    setBasicAuthPassword,
    commitApiKeys,
    commitApiHost,
    commitBasicAuthUsername,
    commitBasicAuthPassword
  }
}
