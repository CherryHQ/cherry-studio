import { debounce, trim } from 'es-toolkit/compat'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import type { ProviderReasoningFormatSelector } from '@cherrystudio/provider-registry'
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
  const apiHostRef = useRef(apiHost)
  const hostPatchInFlightRef = useRef<Promise<void> | null>(null)
  const reasoningPatchInFlightRef = useRef<Promise<void> | null>(null)
  const pendingReasoningFormatRef = useRef<ProviderReasoningFormatSelector | undefined>(undefined)
  const hasPendingReasoningFormatRef = useRef(false)

  useEffect(() => {
    lastPersistedApiHostRef.current = trim(providerApiHost)
  }, [providerApiHost])

  useEffect(() => {
    providerRef.current = provider
  }, [provider])

  useEffect(() => {
    apiHostRef.current = apiHost
  }, [apiHost])

  const buildNextApiEndpointConfigs = useCallback(
    (baseUrl: string) => {
      const currentProvider = providerRef.current
      if (!currentProvider) {
        return undefined
      }

      return {
        ...currentProvider.endpointConfigs,
        [primaryEndpoint]: { ...currentProvider.endpointConfigs?.[primaryEndpoint], baseUrl }
      }
    },
    [primaryEndpoint]
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

      // If a reasoning-format PATCH is in flight, wait so we don't overwrite its
      // snapshot with a stale whole-config write, then coalesce its pending value.
      if (reasoningPatchInFlightRef.current) {
        try {
          await reasoningPatchInFlightRef.current
        } catch {
          // Proceed with host save using last known good reasoning format.
        }
      }
      const liveProvider = providerRef.current ?? currentProvider
      let nextEndpointConfigs = buildNextApiEndpointConfigs(trimmedApiHost)
      if (!nextEndpointConfigs) {
        return false
      }
      if (hasPendingReasoningFormatRef.current) {
        const pending = pendingReasoningFormatRef.current
        if (pending === undefined) {
          const endpoint = { ...nextEndpointConfigs[primaryEndpoint] }
          delete (endpoint as Record<string, unknown>).reasoningFormat
          nextEndpointConfigs = {
            ...nextEndpointConfigs,
            [primaryEndpoint]: endpoint
          }
        } else {
          nextEndpointConfigs = {
            ...nextEndpointConfigs,
            [primaryEndpoint]: {
              ...nextEndpointConfigs[primaryEndpoint],
              reasoningFormat: pending
            }
          }
        }
      } else if (liveProvider.endpointConfigs?.[primaryEndpoint]?.reasoningFormat !== undefined) {
        // Preserve any reasoningFormat committed while we were awaiting, in case
        // providerRef hasn't re-rendered yet but liveProvider has it.
        nextEndpointConfigs = {
          ...nextEndpointConfigs,
          [primaryEndpoint]: {
            ...nextEndpointConfigs[primaryEndpoint],
            reasoningFormat: liveProvider.endpointConfigs[primaryEndpoint]?.reasoningFormat
          }
        }
      }

      const patchPromise = withEndpointConfigWriteLock(currentProvider.id, () =>
        patchProvider({ endpointConfigs: nextEndpointConfigs })
      )
      const trackedHostPatch = patchPromise
        .catch(() => undefined)
        .finally(() => {
          if (hostPatchInFlightRef.current === trackedHostPatch) hostPatchInFlightRef.current = null
        }) as Promise<void>
      hostPatchInFlightRef.current = trackedHostPatch
      await patchPromise
      lastPersistedApiHostRef.current = trimmedApiHost
      return true
    },
    [buildNextApiEndpointConfigs, patchProvider, primaryEndpoint]
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

        const nextEndpointConfigs = buildNextApiEndpointConfigs(trimmedApiHost)
        if (!nextEndpointConfigs) {
          return false
        }

        if (trimmedApiHost !== trim(apiHost)) {
          setApiHost(trimmedApiHost)
        }

        if (trimmedApiHost !== lastPersistedApiHostRef.current) {
          await withEndpointConfigWriteLock(provider.id, () => patchProvider({ endpointConfigs: nextEndpointConfigs }))
          lastPersistedApiHostRef.current = trimmedApiHost
        }

        return true
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
        if (trimmedHost) {
          const nextEndpointConfigs = {
            ...provider.endpointConfigs,
            [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: {
              ...provider.endpointConfigs?.[ENDPOINT_TYPE.ANTHROPIC_MESSAGES],
              baseUrl: trimmedHost
            }
          }
          await withEndpointConfigWriteLock(provider.id, () => patchProvider({ endpointConfigs: nextEndpointConfigs }))
          setAnthropicApiHost(trimmedHost)
          return true
        }

        const nextConfigs = { ...provider.endpointConfigs }
        delete nextConfigs[ENDPOINT_TYPE.ANTHROPIC_MESSAGES]
        await withEndpointConfigWriteLock(provider.id, () => patchProvider({ endpointConfigs: nextConfigs }))
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

    // Coordinate with any in-flight reasoning-format patch to avoid overwriting its snapshot.
    if (reasoningPatchInFlightRef.current) {
      try {
        await reasoningPatchInFlightRef.current
      } catch {
        // Proceed with reset using last known good state.
      }
    }

    const liveProvider = providerRef.current ?? currentProvider
    const nextBaseUrl = defaultApiHost
    const nextEndpoint: Record<string, unknown> = {
      ...liveProvider.endpointConfigs?.[primaryEndpoint],
      baseUrl: nextBaseUrl
    }
    // Preserve or coalesce a pending reasoning-format change (including clear).
    if (hasPendingReasoningFormatRef.current) {
      const pending = pendingReasoningFormatRef.current
      if (pending === undefined) {
        delete nextEndpoint.reasoningFormat
      } else {
        nextEndpoint.reasoningFormat = pending
      }
    } else if (liveProvider.endpointConfigs?.[primaryEndpoint]?.reasoningFormat !== undefined) {
      nextEndpoint.reasoningFormat = liveProvider.endpointConfigs[primaryEndpoint]!.reasoningFormat
    }

    const nextEndpointConfigs = {
      ...liveProvider.endpointConfigs,
      [primaryEndpoint]: nextEndpoint
    }

    setApiHost(nextBaseUrl)
    try {
      await withEndpointConfigWriteLock(currentProvider.id, () =>
        patchProvider({ endpointConfigs: nextEndpointConfigs })
      )
      lastPersistedApiHostRef.current = nextBaseUrl
      return true
    } catch (error) {
      logger.error('Failed to reset provider API host', { providerId: currentProvider.id, error })
      toast.error(getEndpointActionErrorMessage(error, t('settings.provider.save_failed')))
      return false
    }
  }, [defaultApiHost, patchProvider, primaryEndpoint, setApiHost, t])

  const commitReasoningFormat = useCallback(
    async (reasoningFormat: ProviderReasoningFormatSelector | undefined): Promise<boolean> => {
      const currentProvider = providerRef.current
      if (!currentProvider) {
        return false
      }

      pendingReasoningFormatRef.current = reasoningFormat
      hasPendingReasoningFormatRef.current = true
      const doCommit = async (): Promise<boolean> => {
        // Cancel any pending debounced host save so the two whole-snapshot patches don't race.
        // If a host PATCH is already in flight, wait for it so we don't overwrite its
        // snapshot with a stale whole-config write, then coalesce any pending draft.
        debouncedPersistApiHost.cancel()
        if (hostPatchInFlightRef.current) {
          try {
            await hostPatchInFlightRef.current
          } catch {
            // Host save failed — proceed with reasoning save using the last known good host.
          }
        }
        const trimmedDraft = trim(apiHostRef.current)
        const hasPendingHost =
          validateApiHost(trimmedDraft) &&
          trimmedDraft !== lastPersistedApiHostRef.current &&
          trimmedDraft !== trim(currentProvider.endpointConfigs?.[primaryEndpoint]?.baseUrl ?? '')
        const effectiveBaseUrl = hasPendingHost ? trimmedDraft : undefined

        const baseEndpoint = currentProvider.endpointConfigs?.[primaryEndpoint] as Record<string, unknown> | undefined
        const nextEndpoint: Record<string, unknown> = { ...baseEndpoint }
        if (reasoningFormat === undefined) {
          delete nextEndpoint.reasoningFormat
        } else {
          nextEndpoint.reasoningFormat = reasoningFormat
        }
        if (effectiveBaseUrl !== undefined) {
          nextEndpoint.baseUrl = effectiveBaseUrl
        }

        const nextEndpointConfigs = {
          ...currentProvider.endpointConfigs,
          [primaryEndpoint]: nextEndpoint
        }

        try {
          await withEndpointConfigWriteLock(currentProvider.id, () =>
            patchProvider({ endpointConfigs: nextEndpointConfigs })
          )
          if (hasPendingHost) {
            lastPersistedApiHostRef.current = trimmedDraft
            setApiHost(trimmedDraft)
          }
          return true
        } catch (error) {
          logger.error('Failed to commit provider reasoning format', { providerId: currentProvider.id, error })
          toast.error(getEndpointActionErrorMessage(error, t('settings.provider.save_failed')))
          return false
        }
      }

      const patchPromise = doCommit()
      const trackedReasoningPatch = patchPromise
        .catch(() => undefined)
        .finally(() => {
          if (reasoningPatchInFlightRef.current === trackedReasoningPatch) reasoningPatchInFlightRef.current = null
          pendingReasoningFormatRef.current = undefined
          hasPendingReasoningFormatRef.current = false
        }) as Promise<void>
      reasoningPatchInFlightRef.current = trackedReasoningPatch
      return patchPromise
    },
    [debouncedPersistApiHost, patchProvider, primaryEndpoint, setApiHost, t]
  )

  return {
    commitApiHost,
    commitAnthropicApiHost,
    commitApiVersion,
    resetApiHost,
    commitReasoningFormat
  }
}
