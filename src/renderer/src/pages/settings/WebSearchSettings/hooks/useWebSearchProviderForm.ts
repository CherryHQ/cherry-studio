import { formatApiKeys, splitApiKeyString, withoutTrailingSlash } from '@renderer/utils/api'
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

  const commitApiKeys = useCallback(async () => {
    if (apiKeyInput !== provider.apiKeys.join(',')) {
      await updateProvider(provider.id, { apiKeys })
    }
  }, [apiKeyInput, apiKeys, provider.apiKeys, provider.id, updateProvider])

  const setApiHostInput = useCallback((feature: string, value: string) => {
    setApiHosts((current) => ({ ...current, [feature]: value }))
  }, [])

  const commitApiHost = useCallback(
    async (capability: ResolvedWebSearchProviderCapability) => {
      const trimmedHost = withoutTrailingSlash(apiHosts[capability.feature]?.trim() || '')

      if (trimmedHost !== (capability.apiHost ?? '')) {
        return updateProvider(provider.id, {
          capabilities: provider.capabilities.map((item) =>
            item.feature === capability.feature ? { ...item, apiHost: trimmedHost } : item
          )
        })
      }

      setApiHosts((current) => ({ ...current, [capability.feature]: capability.apiHost ?? '' }))
    },
    [apiHosts, provider.capabilities, provider.id, updateProvider]
  )

  const commitBasicAuthUsername = useCallback(async () => {
    const currentValue = basicAuthUsername || ''
    const savedValue = provider.basicAuthUsername || ''
    if (currentValue !== savedValue) {
      await updateProvider(provider.id, { basicAuthUsername })
      return
    }

    setBasicAuthUsername(provider.basicAuthUsername || '')
  }, [basicAuthUsername, provider.basicAuthUsername, provider.id, updateProvider])

  const commitBasicAuthPassword = useCallback(async () => {
    const currentValue = basicAuthPassword || ''
    const savedValue = provider.basicAuthPassword || ''
    if (currentValue !== savedValue) {
      await updateProvider(provider.id, { basicAuthPassword })
      return
    }

    setBasicAuthPassword(provider.basicAuthPassword || '')
  }, [basicAuthPassword, provider.basicAuthPassword, provider.id, updateProvider])

  const commitForm = useCallback(async () => {
    const updates: WebSearchProviderUpdates = {}

    if (apiKeyInput !== provider.apiKeys.join(',')) {
      updates.apiKeys = apiKeys
    }

    const apiHostFeatures = new Set(apiHostCapabilities.map((capability) => capability.feature))
    const nextCapabilities = provider.capabilities.map((item) => {
      if (!apiHostFeatures.has(item.feature)) {
        return item
      }

      return {
        ...item,
        apiHost: withoutTrailingSlash(apiHosts[item.feature]?.trim() || '')
      }
    })

    const hasApiHostChanges = nextCapabilities.some(
      (item, index) => item.apiHost !== provider.capabilities[index]?.apiHost
    )
    if (hasApiHostChanges) {
      updates.capabilities = nextCapabilities
    }

    const currentBasicAuthUsername = basicAuthUsername || ''
    const savedBasicAuthUsername = provider.basicAuthUsername || ''
    if (currentBasicAuthUsername !== savedBasicAuthUsername) {
      updates.basicAuthUsername = basicAuthUsername
    }

    const currentBasicAuthPassword = basicAuthPassword || ''
    const savedBasicAuthPassword = provider.basicAuthPassword || ''
    if (currentBasicAuthPassword !== savedBasicAuthPassword) {
      updates.basicAuthPassword = basicAuthPassword
    }

    if (Object.keys(updates).length > 0) {
      await updateProvider(provider.id, updates)
    }
  }, [
    apiHostCapabilities,
    apiHosts,
    apiKeyInput,
    apiKeys,
    basicAuthPassword,
    basicAuthUsername,
    provider.apiKeys,
    provider.basicAuthPassword,
    provider.basicAuthUsername,
    provider.capabilities,
    provider.id,
    updateProvider
  ])

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
    commitBasicAuthPassword,
    commitForm
  }
}
