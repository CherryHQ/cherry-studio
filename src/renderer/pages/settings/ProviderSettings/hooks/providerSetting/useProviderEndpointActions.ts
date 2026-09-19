import { debounce, isEqual, trim } from 'es-toolkit/compat'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import type { ProviderReasoningFormatSelector } from '@cherrystudio/provider-registry'
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
  const apiHostRef = useRef(apiHost)
  const hostPatchInFlightRef = useRef<Promise<void> | null>(null)
  const reasoningPatchInFlightRef = useRef<Promise<void> | null>(null)
  const pendingReasoningFormatRef = useRef<ProviderReasoningFormatSelector | undefined>(undefined)
  const hasPendingReasoningFormatRef = useRef(false)
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

  useEffect(() => {
    apiHostRef.current = apiHost
  }, [apiHost])

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
            const nextEndpoint = { ...nextEndpointConfigs[primaryEndpoint] } as Record<string, unknown>
            delete nextEndpoint.reasoningFormat
            nextEndpointConfigs = {
              ...nextEndpointConfigs,
              [primaryEndpoint]: nextEndpoint
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

        const patchPromise = patchProvider({ endpointConfigs: nextEndpointConfigs })
        const trackedHostPatch = patchPromise
          .catch(() => undefined)
          .finally(() => {
            if (hostPatchInFlightRef.current === trackedHostPatch) hostPatchInFlightRef.current = null
          }) as Promise<void>
        hostPatchInFlightRef.current = trackedHostPatch
        await patchPromise
        lastSentEndpointConfigsRef.current = nextEndpointConfigs
        setLastWrittenEndpointConfigs(currentProvider.id, nextEndpointConfigs)
        lastPersistedApiHostRef.current = trimmedApiHost
        return true
      })
    },
    [buildNextApiEndpointConfigs, patchProvider, primaryEndpoint]
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

        // Serialize with the drawer's save as well as an in-flight
        // reasoning-format save: either holds a snapshot that predates this
        // host value, so writing first would let it clobber the host (and vice
        // versa once this save is tracked below).
        return serializeEndpointConfigsWrite(provider.id, async () => {
          if (reasoningPatchInFlightRef.current) {
            try {
              await reasoningPatchInFlightRef.current
            } catch {
              // Proceed with host save using last known good reasoning format.
            }
          }

          const nextEndpointConfigs = buildNextApiEndpointConfigs(trimmedApiHost)
          if (!nextEndpointConfigs) {
            return false
          }

          if (trimmedApiHost !== trim(apiHost)) {
            setApiHost(trimmedApiHost)
          }

          if (trimmedApiHost !== lastPersistedApiHostRef.current) {
            const patchPromise = patchProvider({ endpointConfigs: nextEndpointConfigs })
            const trackedHostPatch = patchPromise
              .catch(() => undefined)
              .finally(() => {
                if (hostPatchInFlightRef.current === trackedHostPatch) hostPatchInFlightRef.current = null
              }) as Promise<void>
            hostPatchInFlightRef.current = trackedHostPatch
            await patchPromise
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
        // Serialize with the drawer's save as well as an in-flight
        // reasoning-format save so this whole-snapshot write doesn't drop
        // their values before re-render.
        return serializeEndpointConfigsWrite(provider.id, async () => {
          if (reasoningPatchInFlightRef.current) {
            try {
              await reasoningPatchInFlightRef.current
            } catch {
              // Proceed using last known good endpoint configs.
            }
          }
          const baseConfigs = getBaseEndpointConfigs()
          if (trimmedHost) {
            const nextEndpointConfigs = {
              ...baseConfigs,
              [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: {
                ...baseConfigs?.[ENDPOINT_TYPE.ANTHROPIC_MESSAGES],
                baseUrl: trimmedHost
              }
            }
            const patchPromise = patchProvider({ endpointConfigs: nextEndpointConfigs })
            const trackedHostPatch = patchPromise
              .catch(() => undefined)
              .finally(() => {
                if (hostPatchInFlightRef.current === trackedHostPatch) hostPatchInFlightRef.current = null
              }) as Promise<void>
            hostPatchInFlightRef.current = trackedHostPatch
            await patchPromise
            lastSentEndpointConfigsRef.current = nextEndpointConfigs
            setLastWrittenEndpointConfigs(provider.id, nextEndpointConfigs)
            setAnthropicApiHost(trimmedHost)
            return true
          }

          const nextConfigs = { ...baseConfigs }
          delete nextConfigs[ENDPOINT_TYPE.ANTHROPIC_MESSAGES]
          const patchPromise = patchProvider({ endpointConfigs: nextConfigs })
          const trackedHostPatch = patchPromise
            .catch(() => undefined)
            .finally(() => {
              if (hostPatchInFlightRef.current === trackedHostPatch) hostPatchInFlightRef.current = null
            }) as Promise<void>
          hostPatchInFlightRef.current = trackedHostPatch
          await patchPromise
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

    // Coordinate with the drawer's save as well as any in-flight
    // reasoning-format patch to avoid overwriting their snapshots.
    return serializeEndpointConfigsWrite(currentProvider.id, async () => {
      if (reasoningPatchInFlightRef.current) {
        try {
          await reasoningPatchInFlightRef.current
        } catch {
          // Proceed with reset using last known good state.
        }
      }

      const baseConfigs = getBaseEndpointConfigs()
      const nextBaseUrl = defaultApiHost
      const nextEndpoint: Record<string, unknown> = {
        ...baseConfigs?.[primaryEndpoint],
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
      } else if (baseConfigs?.[primaryEndpoint]?.reasoningFormat !== undefined) {
        nextEndpoint.reasoningFormat = baseConfigs[primaryEndpoint]?.reasoningFormat
      }

      const nextEndpointConfigs = {
        ...baseConfigs,
        [primaryEndpoint]: nextEndpoint
      }

      setApiHost(nextBaseUrl)
      try {
        const patchPromise = patchProvider({ endpointConfigs: nextEndpointConfigs })
        const trackedHostPatch = patchPromise
          .catch(() => undefined)
          .finally(() => {
            if (hostPatchInFlightRef.current === trackedHostPatch) hostPatchInFlightRef.current = null
          }) as Promise<void>
        hostPatchInFlightRef.current = trackedHostPatch
        await patchPromise
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

  const commitReasoningFormat = useCallback(
    async (reasoningFormat: ProviderReasoningFormatSelector | undefined): Promise<boolean> => {
      const currentProvider = providerRef.current
      if (!currentProvider) {
        return false
      }

      pendingReasoningFormatRef.current = reasoningFormat
      hasPendingReasoningFormatRef.current = true
      const doCommit = async (): Promise<boolean> => {
        // Serialize with the drawer's save so neither whole-snapshot write
        // lands on a read that predates the other.
        return serializeEndpointConfigsWrite(currentProvider.id, async () => {
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

          const baseConfigs = getBaseEndpointConfigs()
          const baseEndpoint = baseConfigs?.[primaryEndpoint] as Record<string, unknown> | undefined
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
            ...baseConfigs,
            [primaryEndpoint]: nextEndpoint
          }

          try {
            await patchProvider({ endpointConfigs: nextEndpointConfigs })
            lastSentEndpointConfigsRef.current = nextEndpointConfigs
            setLastWrittenEndpointConfigs(currentProvider.id, nextEndpointConfigs)
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
        })
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
    [debouncedPersistApiHost, getBaseEndpointConfigs, patchProvider, primaryEndpoint, setApiHost, t]
  )

  return {
    commitApiHost,
    commitAnthropicApiHost,
    commitApiVersion,
    resetApiHost,
    commitReasoningFormat
  }
}
