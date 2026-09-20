import { debounce, isEqual, trim } from 'es-toolkit/compat'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { loggerService } from '@logger'
import { toast } from '@renderer/services/toast'
import { validateApiHost } from '@renderer/utils/api'
import { ErrorCode, isDataApiError, isSerializedDataApiError, toDataApiError } from '@shared/data/api/errors'
import type { UpdateProviderDto } from '@shared/data/api/schemas/providers'
import { ENDPOINT_TYPE } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { isVertexProvider } from '@shared/utils/provider'

import {
  clearLastWrittenEndpointConfigs,
  getLastWrittenEndpointConfigs,
  serializeEndpointConfigsWrite,
  setLastWrittenEndpointConfigs
} from './endpointConfigsWriteCoordinator'
import type { PatchProvider } from './types'

const logger = loggerService.withContext('ProviderSettings:EndpointActions')

function getEndpointActionErrorMessage(error: unknown, fallback: string): string {
  if (isDataApiError(error) || isSerializedDataApiError(error)) {
    const dataError = toDataApiError(error)
    switch (dataError.code) {
      case ErrorCode.VALIDATION_ERROR:
      case ErrorCode.UNAUTHORIZED:
      case ErrorCode.PERMISSION_DENIED:
      case ErrorCode.NOT_FOUND:
      case ErrorCode.CONFLICT:
      case ErrorCode.SERVICE_UNAVAILABLE:
      case ErrorCode.TIMEOUT:
        return dataError.message
      default:
        return fallback
    }
  }

  if (error instanceof Error && error.message.trim()) {
    return `${fallback}: ${error.message}`
  }

  return fallback
}

interface UseProviderEndpointActionsParams {
  provider: Provider | undefined
  primaryEndpoint: string
  apiHost: string
  setApiHost: (value: string) => void
  providerApiHost: string
  anthropicApiHost: string
  setAnthropicApiHost: (value: string) => void
  apiVersion: string
  /** Registry factory-default host for the primary endpoint; '' when none. */
  defaultApiHost: string
  patchProvider: PatchProvider
}

/** Persists endpoint drafts through the provider data API. */
export function useProviderEndpointActions({
  provider,
  primaryEndpoint,
  apiHost,
  setApiHost,
  providerApiHost,
  anthropicApiHost,
  setAnthropicApiHost,
  apiVersion,
  defaultApiHost,
  patchProvider
}: UseProviderEndpointActionsParams) {
  const { t } = useTranslation()
  const lastPersistedApiHostRef = useRef(trim(providerApiHost))
  const providerRef = useRef(provider)
  // Latest endpointConfigs this hook persisted. Whole-snapshot writers build on
  // it because the provider prop may not have re-rendered yet when saves overlap.
  const lastSentEndpointConfigsRef = useRef<NonNullable<UpdateProviderDto['endpointConfigs']> | null>(null)
  const providerIdentityRef = useRef(provider?.id)

  useEffect(() => {
    lastPersistedApiHostRef.current = trim(providerApiHost)
  }, [providerApiHost])

  useEffect(() => {
    providerRef.current = provider
    if (provider?.id !== providerIdentityRef.current) {
      providerIdentityRef.current = provider?.id
      lastSentEndpointConfigsRef.current = null
      return
    }
    if (
      lastSentEndpointConfigsRef.current &&
      provider &&
      !isEqual(provider.endpointConfigs, lastSentEndpointConfigsRef.current)
    ) {
      // Configs changed out from under us (our own echo would equal lastSent) —
      // adopt them so the next snapshot doesn't resurrect stale keys. A shared
      // snapshot from another coordinated writer goes stale the same way.
      lastSentEndpointConfigsRef.current = null
      if (provider.id) clearLastWrittenEndpointConfigs(provider.id)
    }
  }, [provider])

  // Freshest endpointConfigs known to any coordinated writer (this hook or the
  // request-configuration drawer), so overlapping saves build on each other's
  // result instead of on a stale prop that hasn't re-rendered with the echo.
  const getBaseEndpointConfigs = useCallback(() => {
    const currentProvider = providerRef.current ?? provider
    const shared = currentProvider?.id ? getLastWrittenEndpointConfigs(currentProvider.id) : undefined
    return shared ?? lastSentEndpointConfigsRef.current ?? currentProvider?.endpointConfigs
  }, [provider])

  const buildNextApiEndpointConfigs = useCallback(
    (baseUrl: string) => {
      const currentProvider = providerRef.current
      if (!currentProvider) {
        return undefined
      }

      const baseConfigs = getBaseEndpointConfigs()
      return {
        ...baseConfigs,
        [primaryEndpoint]: { ...baseConfigs?.[primaryEndpoint], baseUrl }
      }
    },
    [getBaseEndpointConfigs, primaryEndpoint]
  )

  const persistApiHostDraft = useCallback(
    async (nextApiHost: string) => {
      const currentProvider = providerRef.current
      if (!currentProvider) {
        return false
      }

      const trimmedApiHost = trim(nextApiHost)
      if (!validateApiHost(trimmedApiHost)) {
        return false
      }

      if (!isVertexProvider(currentProvider) && !trimmedApiHost) {
        return false
      }

      // Serialize with the drawer's save (and other hook instances) so this
      // whole-snapshot write builds on their completed result, not a stale read.
      return serializeEndpointConfigsWrite(currentProvider.id, async () => {
        const nextEndpointConfigs = buildNextApiEndpointConfigs(trimmedApiHost)
        if (!nextEndpointConfigs) {
          return false
        }

        await patchProvider({ endpointConfigs: nextEndpointConfigs })
        lastSentEndpointConfigsRef.current = nextEndpointConfigs
        setLastWrittenEndpointConfigs(currentProvider.id, nextEndpointConfigs)
        lastPersistedApiHostRef.current = trimmedApiHost
        return true
      })
    },
    [buildNextApiEndpointConfigs, patchProvider]
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
          toast.error(t('settings.provider.api_host_no_valid'))
          return false
        }

        if (!isVertexProvider(provider) && !trimmedApiHost) {
          setApiHost(providerApiHost)
          return false
        }

        // Serialize with the drawer's save: it holds a snapshot that may predate
        // this host value, so writing first would let it clobber the host.
        return serializeEndpointConfigsWrite(provider.id, async () => {
          const nextEndpointConfigs = buildNextApiEndpointConfigs(trimmedApiHost)
          if (!nextEndpointConfigs) {
            return false
          }

          if (trimmedApiHost !== trim(apiHost)) {
            setApiHost(trimmedApiHost)
          }

          if (trimmedApiHost !== lastPersistedApiHostRef.current) {
            await patchProvider({ endpointConfigs: nextEndpointConfigs })
            lastSentEndpointConfigsRef.current = nextEndpointConfigs
            setLastWrittenEndpointConfigs(provider.id, nextEndpointConfigs)
            lastPersistedApiHostRef.current = trimmedApiHost
          }

          return true
        })
      } catch (error) {
        logger.error('Failed to commit provider API host', { providerId: provider?.id, error })
        toast.error(getEndpointActionErrorMessage(error, t('settings.provider.save_failed')))
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
        // Serialize with the drawer's save so this whole-snapshot write doesn't
        // drop its values before re-render.
        return serializeEndpointConfigsWrite(provider.id, async () => {
          const baseConfigs = getBaseEndpointConfigs()
          if (trimmedHost) {
            const nextEndpointConfigs = {
              ...baseConfigs,
              [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: {
                ...baseConfigs?.[ENDPOINT_TYPE.ANTHROPIC_MESSAGES],
                baseUrl: trimmedHost
              }
            }
            await patchProvider({ endpointConfigs: nextEndpointConfigs })
            lastSentEndpointConfigsRef.current = nextEndpointConfigs
            setLastWrittenEndpointConfigs(provider.id, nextEndpointConfigs)
            setAnthropicApiHost(trimmedHost)
            return true
          }

          const nextConfigs = { ...baseConfigs }
          delete nextConfigs[ENDPOINT_TYPE.ANTHROPIC_MESSAGES]
          await patchProvider({ endpointConfigs: nextConfigs })
          lastSentEndpointConfigsRef.current = nextConfigs
          setLastWrittenEndpointConfigs(provider.id, nextConfigs)
          setAnthropicApiHost('')
          return true
        })
      } catch (error) {
        logger.error('Failed to commit Anthropic API host', { providerId: provider?.id, error })
        toast.error(getEndpointActionErrorMessage(error, t('settings.provider.save_failed')))
        return false
      }
    },
    [anthropicApiHost, getBaseEndpointConfigs, patchProvider, provider, setAnthropicApiHost, t]
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
      toast.error(getEndpointActionErrorMessage(error, t('settings.provider.save_failed')))
      return false
    }
  }, [apiVersion, patchProvider, provider, t])

  const resetApiHost = useCallback(async (): Promise<boolean> => {
    const currentProvider = providerRef.current
    if (!currentProvider) {
      return false
    }

    // Coordinate with the drawer's save to avoid overwriting its snapshot.
    return serializeEndpointConfigsWrite(currentProvider.id, async () => {
      const baseConfigs = getBaseEndpointConfigs()
      const nextBaseUrl = defaultApiHost
      const nextEndpoint: Record<string, unknown> = {
        ...baseConfigs?.[primaryEndpoint],
        baseUrl: nextBaseUrl
      }

      const nextEndpointConfigs = {
        ...baseConfigs,
        [primaryEndpoint]: nextEndpoint
      }

      setApiHost(nextBaseUrl)
      try {
        await patchProvider({ endpointConfigs: nextEndpointConfigs })
        lastSentEndpointConfigsRef.current = nextEndpointConfigs
        setLastWrittenEndpointConfigs(currentProvider.id, nextEndpointConfigs)
        lastPersistedApiHostRef.current = nextBaseUrl
        return true
      } catch (error) {
        logger.error('Failed to reset provider API host', { providerId: currentProvider.id, error })
        toast.error(getEndpointActionErrorMessage(error, t('settings.provider.save_failed')))
        return false
      }
    })
  }, [defaultApiHost, getBaseEndpointConfigs, patchProvider, primaryEndpoint, setApiHost, t])

  return {
    commitApiHost,
    commitAnthropicApiHost,
    commitApiVersion,
    resetApiHost
  }
}
