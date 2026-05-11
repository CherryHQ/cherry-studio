import { formatApiKeys, splitApiKeyString, withoutTrailingSlash } from '@renderer/utils/api'
import type {
  WebSearchCapability,
  WebSearchProviderId,
  WebSearchProviderOverride,
  WebSearchProviderOverrides
} from '@shared/data/preference/preferenceTypes'
import type { ResolvedWebSearchProvider } from '@shared/data/types/webSearch'
import { useCallback, useMemo, useState } from 'react'

import type { ResolvedWebSearchProviderCapability } from '../utils/webSearchProviderMeta'

export type WebSearchProviderFormActions = {
  providerOverrides: WebSearchProviderOverrides
  updateProvider: (providerId: WebSearchProviderId, patch: WebSearchProviderOverride) => Promise<void>
  setApiKeys: (providerId: WebSearchProviderId, apiKeys: string[]) => Promise<void>
  setCapabilityApiHost: (
    providerId: WebSearchProviderId,
    capability: WebSearchCapability,
    apiHost: string
  ) => Promise<void>
  setBasicAuth: (
    providerId: WebSearchProviderId,
    patch: {
      username?: string
      password?: string
    }
  ) => Promise<void>
}

export function useWebSearchProviderForm(
  provider: ResolvedWebSearchProvider,
  actions: WebSearchProviderFormActions,
  activeCapability?: WebSearchCapability
) {
  const [apiKeys, setApiKeys] = useState<string[]>(provider.apiKeys)
  const [apiHosts, setApiHosts] = useState<Record<string, string>>(() =>
    Object.fromEntries(provider.capabilities.map((capability) => [capability.feature, capability.apiHost ?? '']))
  )
  const [basicAuthUsername, setBasicAuthUsername] = useState(provider.basicAuthUsername)
  const [basicAuthPassword, setBasicAuthPassword] = useState(provider.basicAuthPassword)

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
      await actions.setApiKeys(provider.id, apiKeys)
    }
  }, [actions, apiKeyInput, apiKeys, provider.apiKeys, provider.id])

  const setApiHostInput = useCallback((feature: string, value: string) => {
    setApiHosts((current) => ({ ...current, [feature]: value }))
  }, [])

  const commitApiHost = useCallback(
    async (capability: ResolvedWebSearchProviderCapability) => {
      const trimmedHost = withoutTrailingSlash(apiHosts[capability.feature]?.trim() || '')

      if (trimmedHost !== (capability.apiHost ?? '')) {
        return actions.setCapabilityApiHost(provider.id, capability.feature, trimmedHost)
      }

      setApiHosts((current) => ({ ...current, [capability.feature]: capability.apiHost ?? '' }))
    },
    [actions, apiHosts, provider.id]
  )

  const commitBasicAuthUsername = useCallback(async () => {
    const currentValue = basicAuthUsername.trim()
    const savedValue = provider.basicAuthUsername || ''
    if (currentValue !== savedValue) {
      await actions.setBasicAuth(provider.id, { username: basicAuthUsername })
      return
    }

    setBasicAuthUsername(provider.basicAuthUsername || '')
  }, [actions, basicAuthUsername, provider.basicAuthUsername, provider.id])

  const commitBasicAuthPassword = useCallback(async () => {
    const currentValue = basicAuthPassword.trim()
    const savedValue = provider.basicAuthPassword || ''
    if (currentValue !== savedValue) {
      await actions.setBasicAuth(provider.id, { password: basicAuthPassword })
      return
    }

    setBasicAuthPassword(provider.basicAuthPassword || '')
  }, [actions, basicAuthPassword, provider.basicAuthPassword, provider.id])

  const commitForm = useCallback(async () => {
    const patch: WebSearchProviderOverride = {}

    if (apiKeyInput !== provider.apiKeys.join(',')) {
      patch.apiKeys = apiKeys
    }

    for (const capability of apiHostCapabilities) {
      const nextApiHost = withoutTrailingSlash(apiHosts[capability.feature]?.trim() || '')
      if (nextApiHost !== (capability.apiHost ?? '')) {
        patch.capabilities = {
          ...actions.providerOverrides[provider.id]?.capabilities,
          ...patch.capabilities,
          [capability.feature]: {
            ...actions.providerOverrides[provider.id]?.capabilities?.[capability.feature],
            apiHost: nextApiHost
          }
        }
      }
    }

    const currentBasicAuthUsername = basicAuthUsername.trim()
    const savedBasicAuthUsername = provider.basicAuthUsername || ''
    const currentBasicAuthPassword = basicAuthPassword.trim()
    const savedBasicAuthPassword = provider.basicAuthPassword || ''

    if (currentBasicAuthUsername !== savedBasicAuthUsername || currentBasicAuthPassword !== savedBasicAuthPassword) {
      patch.basicAuthUsername = currentBasicAuthUsername
      patch.basicAuthPassword = currentBasicAuthUsername ? currentBasicAuthPassword : ''
    }

    if (Object.keys(patch).length > 0) {
      await actions.updateProvider(provider.id, patch)
    }
  }, [
    actions,
    apiHostCapabilities,
    apiHosts,
    apiKeyInput,
    apiKeys,
    basicAuthPassword,
    basicAuthUsername,
    provider.apiKeys,
    provider.basicAuthPassword,
    provider.basicAuthUsername,
    provider.id
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
