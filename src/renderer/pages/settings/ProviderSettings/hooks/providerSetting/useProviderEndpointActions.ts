import { debounce, trim } from 'es-toolkit/compat'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { loggerService } from '@logger'
import { toast } from '@renderer/services/toast'
import { validateApiHost } from '@renderer/utils/api'
import { ErrorCode, isDataApiError, isSerializedDataApiError, toDataApiError } from '@shared/data/api/errors'
import { ENDPOINT_TYPE } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { isVertexProvider } from '@shared/utils/provider'

import type { PatchProvider } from './types'

const logger = loggerService.withContext('ProviderSettings:EndpointActions')

// Whole-endpoint-snapshot writers (host save, reasoning format, reset, the endpoint
// drawer) must not overwrite each other's fields: every snapshot is computed from a
// provider copy that the previous write may already have changed. Serializing the
// network writes per provider makes the last computed snapshot win instead of racing.
const endpointConfigWriteLocks = new Map<string, Promise<unknown>>()

/** Last endpointConfigs map successfully persisted per provider (survives failed revalidation). */
const committedEndpointConfigsByProviderId = new Map<string, Provider['endpointConfigs']>()

/** Record a successful whole-map endpointConfigs write for later snapshot writers. */
export function commitCommittedEndpointConfigs(providerId: string, endpointConfigs: Provider['endpointConfigs']): void {
  if (endpointConfigs) {
    committedEndpointConfigsByProviderId.set(providerId, endpointConfigs)
  }
}

function resolveEndpointConfigsForWrite(
  providerId: string,
  providerRef: { current: Provider | undefined },
  fallbackProvider: Provider
): Provider['endpointConfigs'] {
  const liveConfigs = (providerRef.current ?? fallbackProvider).endpointConfigs
  const committed = committedEndpointConfigsByProviderId.get(providerId)
  if (!committed) {
    return liveConfigs
  }
  return { ...liveConfigs, ...committed }
}

/** @internal Test-only reset for module-level committed endpoint state. */
export function resetCommittedEndpointConfigsForTests(): void {
  committedEndpointConfigsByProviderId.clear()
}

/** Run `write` after all previously registered endpoint-config writes for this provider settle. */
export function withEndpointConfigWriteLock<T>(providerId: string, write: () => Promise<T>): Promise<T> {
  const previous = endpointConfigWriteLocks.get(providerId) ?? Promise.resolve()
  const next = previous.catch(() => undefined).then(write)
  endpointConfigWriteLocks.set(
    providerId,
    next.catch(() => undefined)
  )
  return next
}

/** Resolve once every registered endpoint-config write for this provider has settled. */
export function awaitEndpointConfigWrites(providerId: string): Promise<void> {
  return endpointConfigWriteLocks.get(providerId)?.then(() => undefined) ?? Promise.resolve()
}

function commitEndpointConfigsToProviderRef(
  providerId: string,
  providerRef: { current: Provider | undefined },
  fallbackProvider: Provider,
  nextEndpointConfigs: Provider['endpointConfigs']
): void {
  const live = providerRef.current ?? fallbackProvider
  providerRef.current = { ...live, endpointConfigs: nextEndpointConfigs }
  commitCommittedEndpointConfigs(providerId, nextEndpointConfigs)
}

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
  useEffect(() => {
    lastPersistedApiHostRef.current = trim(providerApiHost)
  }, [providerApiHost])

  const observedProviderRef = useRef(provider)
  useEffect(() => {
    providerRef.current = provider
    // A provider object that changed after mount is an authoritative refresh: it already reflects every
    // committed write plus edits from writers that don't record snapshots (e.g. API Options dialect flags),
    // so the retained snapshot must stop overriding it. A failed revalidation delivers no new object and
    // keeps the snapshot.
    if (provider && observedProviderRef.current !== provider) {
      committedEndpointConfigsByProviderId.delete(provider.id)
    }
    observedProviderRef.current = provider
  }, [provider])

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

      await awaitEndpointConfigWrites(currentProvider.id)

      await withEndpointConfigWriteLock(currentProvider.id, async () => {
        const liveProvider = providerRef.current ?? currentProvider
        const baseEndpointConfigs = resolveEndpointConfigsForWrite(currentProvider.id, providerRef, liveProvider)
        const nextEndpointConfigs = {
          ...baseEndpointConfigs,
          [primaryEndpoint]: {
            ...baseEndpointConfigs?.[primaryEndpoint],
            baseUrl: trimmedApiHost
          }
        }
        await patchProvider({ endpointConfigs: nextEndpointConfigs })
        commitEndpointConfigsToProviderRef(currentProvider.id, providerRef, liveProvider, nextEndpointConfigs)
      })
      lastPersistedApiHostRef.current = trimmedApiHost
      return true
    },
    [patchProvider, primaryEndpoint]
  )

  const debouncedPersistApiHost = useMemo(
    () =>
      debounce((nextApiHost: string) => {
        void persistApiHostDraft(nextApiHost).catch((error: unknown) => {
          // The queued write runs outside any caller's try/catch — surface
          // failures through the same error handling as explicit commits.
          logger.error('Failed to persist provider API host draft', { providerId: providerRef.current?.id, error })
          toast.error(getEndpointActionErrorMessage(error, t('settings.provider.save_failed')))
        })
      }, 150),
    [persistApiHostDraft, t]
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

        await awaitEndpointConfigWrites(provider.id)

        if (trimmedApiHost !== trim(apiHost)) {
          setApiHost(trimmedApiHost)
        }

        if (trimmedApiHost !== lastPersistedApiHostRef.current) {
          await withEndpointConfigWriteLock(provider.id, async () => {
            const liveProvider = providerRef.current ?? provider
            const baseEndpointConfigs = resolveEndpointConfigsForWrite(provider.id, providerRef, liveProvider)
            const nextEndpointConfigs = {
              ...baseEndpointConfigs,
              [primaryEndpoint]: {
                ...baseEndpointConfigs?.[primaryEndpoint],
                baseUrl: trimmedApiHost
              }
            }
            await patchProvider({ endpointConfigs: nextEndpointConfigs })
            commitEndpointConfigsToProviderRef(provider.id, providerRef, liveProvider, nextEndpointConfigs)
          })
          lastPersistedApiHostRef.current = trimmedApiHost
        }

        return true
      } catch (error) {
        logger.error('Failed to commit provider API host', { providerId: provider?.id, error })
        toast.error(getEndpointActionErrorMessage(error, t('settings.provider.save_failed')))
        return false
      }
    },
    [apiHost, debouncedPersistApiHost, patchProvider, primaryEndpoint, provider, providerApiHost, setApiHost, t]
  )

  const commitAnthropicApiHost = useCallback(
    async (explicitNext?: string): Promise<boolean> => {
      if (!provider) {
        return false
      }

      const rawHost = explicitNext !== undefined ? explicitNext : anthropicApiHost
      const trimmedHost = trim(rawHost)
      try {
        await awaitEndpointConfigWrites(provider.id)
        if (trimmedHost) {
          await withEndpointConfigWriteLock(provider.id, async () => {
            const liveProvider = providerRef.current ?? provider
            const baseEndpointConfigs = resolveEndpointConfigsForWrite(provider.id, providerRef, liveProvider)
            const nextEndpointConfigs = {
              ...baseEndpointConfigs,
              [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: {
                ...baseEndpointConfigs?.[ENDPOINT_TYPE.ANTHROPIC_MESSAGES],
                baseUrl: trimmedHost
              }
            }
            await patchProvider({ endpointConfigs: nextEndpointConfigs })
            commitEndpointConfigsToProviderRef(provider.id, providerRef, liveProvider, nextEndpointConfigs)
          })
          setAnthropicApiHost(trimmedHost)
          return true
        }

        await withEndpointConfigWriteLock(provider.id, async () => {
          const liveProvider = providerRef.current ?? provider
          const baseEndpointConfigs = resolveEndpointConfigsForWrite(provider.id, providerRef, liveProvider)
          const nextConfigs = { ...baseEndpointConfigs }
          delete nextConfigs[ENDPOINT_TYPE.ANTHROPIC_MESSAGES]
          await patchProvider({ endpointConfigs: nextConfigs })
          commitEndpointConfigsToProviderRef(provider.id, providerRef, liveProvider, nextConfigs)
        })
        setAnthropicApiHost('')
        return true
      } catch (error) {
        logger.error('Failed to commit Anthropic API host', { providerId: provider?.id, error })
        toast.error(getEndpointActionErrorMessage(error, t('settings.provider.save_failed')))
        return false
      }
    },
    [anthropicApiHost, patchProvider, provider, setAnthropicApiHost, t]
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

    const nextBaseUrl = defaultApiHost
    setApiHost(nextBaseUrl)
    try {
      await awaitEndpointConfigWrites(currentProvider.id)
      await withEndpointConfigWriteLock(currentProvider.id, async () => {
        const liveProvider = providerRef.current ?? currentProvider
        const baseEndpointConfigs = resolveEndpointConfigsForWrite(currentProvider.id, providerRef, liveProvider)
        const nextEndpointConfigs = {
          ...baseEndpointConfigs,
          [primaryEndpoint]: {
            ...baseEndpointConfigs?.[primaryEndpoint],
            baseUrl: nextBaseUrl
          }
        }
        await patchProvider({ endpointConfigs: nextEndpointConfigs })
        commitEndpointConfigsToProviderRef(currentProvider.id, providerRef, liveProvider, nextEndpointConfigs)
      })
      lastPersistedApiHostRef.current = nextBaseUrl
      return true
    } catch (error) {
      logger.error('Failed to reset provider API host', { providerId: currentProvider.id, error })
      toast.error(getEndpointActionErrorMessage(error, t('settings.provider.save_failed')))
      return false
    }
  }, [defaultApiHost, patchProvider, primaryEndpoint, setApiHost, t])

  return {
    commitApiHost,
    commitAnthropicApiHost,
    commitApiVersion,
    resetApiHost
  }
}
