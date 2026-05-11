import { loggerService } from '@logger'
import { PROVIDER_URLS } from '@renderer/config/providers'
import { isVertexProvider } from '@renderer/pages/settings/ProviderSettings/utils/provider'
import { validateApiHost } from '@renderer/utils'
import { ENDPOINT_TYPE } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { debounce, trim } from 'lodash'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import type { PatchProvider, SyncProviderModels } from './types'

const logger = loggerService.withContext('ProviderSettings:EndpointActions')

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

/** Persists endpoint drafts and triggers the follow-up model synchronization. */
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

  const commitApiHost = useCallback(
    async (explicitNext?: string): Promise<boolean> => {
      try {
        if (!provider) {
          return false
        }

        debouncedPersistApiHost.cancel()

        const raw = explicitNext !== undefined ? explicitNext : apiHost
        const trimmedApiHost = trim(raw)
        if (!validateApiHost(trimmedApiHost)) {
          setApiHost(providerApiHost)
          window.toast.error(t('settings.provider.api_host_no_valid'))
          return false
        }

        if (!isVertexProvider(provider) && !trimmedApiHost) {
          setApiHost(providerApiHost)
          return false
        }

        const nextEndpointConfigs = buildNextApiEndpointConfigs(trimmedApiHost)
        if (!nextEndpointConfigs) {
          return false
        }

        if (trimmedApiHost !== trim(apiHost)) {
          setApiHost(trimmedApiHost)
        }

        if (trimmedApiHost !== lastPersistedApiHostRef.current) {
          await patchProvider({ endpointConfigs: nextEndpointConfigs })
          lastPersistedApiHostRef.current = trimmedApiHost
        }

        await syncProviderModels({ ...provider, endpointConfigs: nextEndpointConfigs })
        return true
      } catch (error) {
        logger.error('Failed to commit provider API host', { providerId: provider?.id, error })
        window.toast.error(t('blocks.edit.save.failed.label'))
        return false
      }
    },
    [
      apiHost,
      buildNextApiEndpointConfigs,
      debouncedPersistApiHost,
      patchProvider,
      provider,
      providerApiHost,
      setApiHost,
      syncProviderModels,
      t
    ]
  )

  const commitAnthropicApiHost = useCallback(
    async (explicitNext?: string): Promise<boolean> => {
      if (!provider) {
        return false
      }

      const rawHost = explicitNext !== undefined ? explicitNext : anthropicApiHost
      const trimmedHost = trim(rawHost)
      try {
        if (trimmedHost) {
          const nextEndpointConfigs = {
            ...provider.endpointConfigs,
            [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: {
              ...provider.endpointConfigs?.[ENDPOINT_TYPE.ANTHROPIC_MESSAGES],
              baseUrl: trimmedHost
            }
          }
          await patchProvider({ endpointConfigs: nextEndpointConfigs })
          await syncProviderModels({ ...provider, endpointConfigs: nextEndpointConfigs })
          setAnthropicApiHost(trimmedHost)
          return true
        }

        const nextConfigs = { ...provider.endpointConfigs }
        delete nextConfigs[ENDPOINT_TYPE.ANTHROPIC_MESSAGES]
        await patchProvider({ endpointConfigs: nextConfigs })
        await syncProviderModels({ ...provider, endpointConfigs: nextConfigs })
        setAnthropicApiHost('')
        return true
      } catch (error) {
        logger.error('Failed to commit Anthropic API host', { providerId: provider?.id, error })
        window.toast.error(t('blocks.edit.save.failed.label'))
        return false
      }
    },
    [anthropicApiHost, patchProvider, provider, setAnthropicApiHost, syncProviderModels, t]
  )

  const commitApiVersion = useCallback(async (): Promise<boolean> => {
    if (!provider) {
      return false
    }

    try {
      await patchProvider({
        providerSettings: {
          ...provider.settings,
          apiVersion
        }
      })
      return true
    } catch (error) {
      logger.error('Failed to commit API version', { providerId: provider.id, error })
      window.toast.error(t('blocks.edit.save.failed.label'))
      return false
    }
  }, [apiVersion, patchProvider, provider, t])

  const resetApiHost = useCallback(async (): Promise<boolean> => {
    if (!provider) {
      return false
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
    try {
      await patchProvider({ endpointConfigs: nextEndpointConfigs })
      await syncProviderModels({ ...provider, endpointConfigs: nextEndpointConfigs })
      return true
    } catch (error) {
      logger.error('Failed to reset provider API host', { providerId: provider.id, error })
      window.toast.error(t('blocks.edit.save.failed.label'))
      return false
    }
  }, [patchProvider, primaryEndpoint, provider, providerConfig?.api?.url, setApiHost, syncProviderModels, t])

  return {
    commitApiHost,
    commitAnthropicApiHost,
    commitApiVersion,
    resetApiHost
  }
}
