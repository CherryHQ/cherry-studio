import { PROVIDER_URLS } from '@renderer/config/providers'
import { isVertexProvider } from '@renderer/pages/settings/ProviderSettingsV2/utils/provider'
import { validateApiHost } from '@renderer/utils'
import { ENDPOINT_TYPE } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { debounce, trim } from 'lodash'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import type { PatchProvider, SyncProviderModels } from './types'

interface UseProviderEndpointActionsParams {
  provider: Provider | undefined
  primaryEndpoint: string
  apiHost: string
  setApiHost: (value: string) => void
  providerApiHost: string
  anthropicApiHost: string
  setAnthropicApiHost: (value: string) => void
  apiVersion: string
  patchProvider: PatchProvider
  syncProviderModels: SyncProviderModels
}

/**
 * Intent: persist endpoint-related drafts and trigger the required follow-up model synchronization.
 * Scope: use where Provider Settings renders endpoint inputs and wants blur/reset actions.
 * Does not handle: ownership of draft values, generic provider enablement, or API key logic.
 *
 * @example
 * ```tsx
 * const endpointActions = useProviderEndpointActions({ provider, primaryEndpoint, apiHost, setApiHost, providerApiHost, anthropicApiHost, setAnthropicApiHost, apiVersion, patchProvider, syncProviderModels })
 * <Input onBlur={endpointActions.commitApiHost} />
 * ```
 */
export function useProviderEndpointActions({
  provider,
  primaryEndpoint,
  apiHost,
  setApiHost,
  providerApiHost,
  anthropicApiHost,
  setAnthropicApiHost,
  apiVersion,
  patchProvider,
  syncProviderModels
}: UseProviderEndpointActionsParams) {
  const { t } = useTranslation()
  const providerConfig = provider ? PROVIDER_URLS[provider.id as keyof typeof PROVIDER_URLS] : undefined
  const lastPersistedApiHostRef = useRef(trim(providerApiHost))

  useEffect(() => {
    lastPersistedApiHostRef.current = trim(providerApiHost)
  }, [providerApiHost])

  const buildNextApiEndpointConfigs = useCallback(
    (baseUrl: string) => {
      if (!provider) {
        return undefined
      }

      return {
        ...provider.endpointConfigs,
        [primaryEndpoint]: { ...provider.endpointConfigs?.[primaryEndpoint], baseUrl }
      }
    },
    [primaryEndpoint, provider]
  )

  const persistApiHostDraft = useCallback(
    async (nextApiHost: string) => {
      if (!provider) {
        return false
      }

      const trimmedApiHost = trim(nextApiHost)
      if (!validateApiHost(trimmedApiHost)) {
        return false
      }

      if (!isVertexProvider(provider) && !trimmedApiHost) {
        return false
      }

      const nextEndpointConfigs = buildNextApiEndpointConfigs(trimmedApiHost)
      if (!nextEndpointConfigs) {
        return false
      }

      await patchProvider({ endpointConfigs: nextEndpointConfigs })
      lastPersistedApiHostRef.current = trimmedApiHost
      return true
    },
    [buildNextApiEndpointConfigs, patchProvider, provider]
  )

  const debouncedPersistApiHost = useMemo(
    () => debounce((nextApiHost: string) => void persistApiHostDraft(nextApiHost), 150),
    [persistApiHostDraft]
  )

  useEffect(() => {
    if (!provider) {
      return
    }

    const trimmedApiHost = trim(apiHost)
    if (!validateApiHost(trimmedApiHost)) {
      debouncedPersistApiHost.cancel()
      return
    }

    if (!isVertexProvider(provider) && !trimmedApiHost) {
      debouncedPersistApiHost.cancel()
      return
    }

    if (trimmedApiHost === lastPersistedApiHostRef.current) {
      debouncedPersistApiHost.cancel()
      return
    }

    debouncedPersistApiHost(apiHost)

    return () => debouncedPersistApiHost.cancel()
  }, [apiHost, debouncedPersistApiHost, provider])

  useEffect(() => () => debouncedPersistApiHost.cancel(), [debouncedPersistApiHost])

  const commitApiHost = useCallback(() => {
    void (async () => {
      if (!provider) {
        return
      }

      debouncedPersistApiHost.cancel()

      const trimmedApiHost = trim(apiHost)
      if (!validateApiHost(trimmedApiHost)) {
        setApiHost(providerApiHost)
        window.toast.error(t('settings.provider.api_host_no_valid'))
        return
      }

      if (!isVertexProvider(provider) && !trimmedApiHost) {
        setApiHost(providerApiHost)
        return
      }

      const nextEndpointConfigs = buildNextApiEndpointConfigs(trimmedApiHost)
      if (!nextEndpointConfigs) {
        return
      }

      if (trimmedApiHost !== apiHost) {
        setApiHost(trimmedApiHost)
      }

      if (trimmedApiHost !== lastPersistedApiHostRef.current) {
        await patchProvider({ endpointConfigs: nextEndpointConfigs })
        lastPersistedApiHostRef.current = trimmedApiHost
      }

      await syncProviderModels({ ...provider, endpointConfigs: nextEndpointConfigs })
    })()
  }, [
    apiHost,
    buildNextApiEndpointConfigs,
    debouncedPersistApiHost,
    patchProvider,
    provider,
    providerApiHost,
    setApiHost,
    syncProviderModels,
    t
  ])

  const commitAnthropicApiHost = useCallback(() => {
    if (!provider) {
      return
    }

    const trimmedHost = anthropicApiHost.trim()
    if (trimmedHost) {
      const nextEndpointConfigs = {
        ...provider.endpointConfigs,
        [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: {
          ...provider.endpointConfigs?.[ENDPOINT_TYPE.ANTHROPIC_MESSAGES],
          baseUrl: trimmedHost
        }
      }
      void (async () => {
        await patchProvider({ endpointConfigs: nextEndpointConfigs })
        await syncProviderModels({ ...provider, endpointConfigs: nextEndpointConfigs })
      })()
      setAnthropicApiHost(trimmedHost)
      return
    }

    const nextConfigs = { ...provider.endpointConfigs }
    delete nextConfigs[ENDPOINT_TYPE.ANTHROPIC_MESSAGES]
    void (async () => {
      await patchProvider({ endpointConfigs: nextConfigs })
      await syncProviderModels({ ...provider, endpointConfigs: nextConfigs })
    })()
    setAnthropicApiHost('')
  }, [anthropicApiHost, patchProvider, provider, setAnthropicApiHost, syncProviderModels])

  const commitApiVersion = useCallback(() => {
    if (!provider) {
      return
    }

    void patchProvider({
      providerSettings: {
        ...provider.settings,
        apiVersion
      }
    })
  }, [apiVersion, patchProvider, provider])

  const resetApiHost = useCallback(() => {
    if (!provider) {
      return
    }

    const nextBaseUrl = providerConfig?.api?.url ?? ''
    const nextEndpointConfigs = {
      ...provider.endpointConfigs,
      [primaryEndpoint]: {
        ...provider.endpointConfigs?.[primaryEndpoint],
        baseUrl: nextBaseUrl
      }
    }

    setApiHost(nextBaseUrl)
    void (async () => {
      await patchProvider({ endpointConfigs: nextEndpointConfigs })
      await syncProviderModels({ ...provider, endpointConfigs: nextEndpointConfigs })
    })()
  }, [patchProvider, primaryEndpoint, provider, providerConfig?.api?.url, setApiHost, syncProviderModels])

  return {
    commitApiHost,
    commitAnthropicApiHost,
    commitApiVersion,
    resetApiHost
  }
}
