import { loggerService } from '@logger'
import { useModels } from '@renderer/hooks/useModel'
import { useProviders } from '@renderer/hooks/useProvider'
import { ipcApi } from '@renderer/ipc'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { useEffect, useMemo, useState } from 'react'

import { isAvailablePaintingModel } from '../model/utils/paintingModelOptions'
import { getValidPaintingOptions } from '../utils/providerSelection'

type OvmsStatus = 'not-installed' | 'not-running' | 'running'
interface OvmsState {
  supported: boolean
  status: OvmsStatus
}

const DEFAULT_OVMS_STATE: OvmsState = { supported: false, status: 'not-running' }

const logger = loggerService.withContext('usePaintingProviderOptions')

let cachedOvmsState: OvmsState | undefined
let inflightOvmsPromise: Promise<OvmsState> | undefined

export function resetOvmsCache(): void {
  cachedOvmsState = undefined
  inflightOvmsPromise = undefined
}

async function loadOvmsState(): Promise<OvmsState> {
  if (cachedOvmsState) return cachedOvmsState
  if (!inflightOvmsPromise) {
    inflightOvmsPromise = (async () => {
      try {
        const supported = await ipcApi.request('ovms.is_supported')
        const status: OvmsStatus = supported ? await ipcApi.request('ovms.get_status') : 'not-running'
        cachedOvmsState = { supported, status }
        return cachedOvmsState
      } finally {
        // Clear inflight so a failed load can be retried next render cycle.
        inflightOvmsPromise = undefined
      }
    })()
  }
  return inflightOvmsPromise
}

/**
 * Derive enabled providers that own at least one available painting model,
 * sorted for a stable UI, then filtered by the OVMS availability gate.
 * Exported for unit testing.
 *
 * Provider enablement is fully capability-derived now — any provider whose
 * v2 models carry `image-generation` capability (or an OpenAI image endpoint)
 * appears automatically. Providers with no enabled image-gen model don't
 * appear at all; the empty-dropdown state is the expected UX (users add the
 * model in Manage Models first).
 */
export function buildPaintingProviderOptions(input: {
  models: readonly Model[]
  providers: readonly Pick<Provider, 'id' | 'isEnabled'>[]
  ovmsSupported: boolean
  ovmsStatus: OvmsStatus
}): string[] {
  const enabledProviderIds = new Set(
    input.providers.filter((provider) => provider.isEnabled).map((provider) => provider.id)
  )
  const capabilityProviderIds = new Set<string>()
  for (const model of input.models) {
    if (enabledProviderIds.has(model.providerId) && isAvailablePaintingModel(model)) {
      capabilityProviderIds.add(model.providerId)
    }
  }

  return getValidPaintingOptions([...capabilityProviderIds].sort(), input.ovmsSupported, input.ovmsStatus)
}

export function usePaintingProviderOptions(): string[] {
  const { providers: allProviders } = useProviders()
  const { models } = useModels()
  const [ovmsState, setOvmsState] = useState<OvmsState>(() => cachedOvmsState ?? DEFAULT_OVMS_STATE)

  useEffect(() => {
    if (cachedOvmsState) return
    let cancelled = false
    loadOvmsState()
      .then((state) => {
        if (!cancelled) setOvmsState(state)
      })
      .catch((error) => {
        logger.warn('Failed to load OVMS state', error)
        if (!cancelled) setOvmsState(DEFAULT_OVMS_STATE)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return useMemo(
    () =>
      buildPaintingProviderOptions({
        providers: allProviders,
        models,
        ovmsSupported: ovmsState.supported,
        ovmsStatus: ovmsState.status
      }),
    [allProviders, models, ovmsState]
  )
}
