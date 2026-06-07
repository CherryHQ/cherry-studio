import { loggerService } from '@logger'
import { useModels } from '@renderer/hooks/useModel'
import { useProviders } from '@renderer/hooks/useProvider'
import type { Model } from '@shared/data/types/model'
import { useEffect, useMemo, useState } from 'react'

import { isPaintingNewApiProvider } from '../model/types/paintingProviderRuntime'
import { supportsImageGenerationEndpoint } from '../model/utils/paintingModelOptions'
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
        const supported = await window.api.ovms.isSupported()
        const status: OvmsStatus = supported ? await window.api.ovms.getStatus() : 'not-running'
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
 * Pure merge: capability-derived provider ids ∪ user-added new-api compat
 * ids, sorted for a stable UI, then filtered by the ovms availability gate.
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
  newApiProviderIds: readonly string[]
  ovmsSupported: boolean
  ovmsStatus: OvmsStatus
}): string[] {
  const capabilityProviderIds = new Set<string>()
  for (const model of input.models) {
    if (supportsImageGenerationEndpoint(model)) {
      capabilityProviderIds.add(model.providerId)
    }
  }

  const merged = [...new Set([...[...capabilityProviderIds].sort(), ...input.newApiProviderIds])]
  return getValidPaintingOptions(merged, input.ovmsSupported, input.ovmsStatus)
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

  return useMemo(() => {
    // User-added OpenAI-compatible "new-api"-style providers (presetProviderId
    // based) — kept so manually configured compat providers still surface.
    const newApiProviderIds = allProviders.filter(isPaintingNewApiProvider).map((provider) => provider.id)
    return buildPaintingProviderOptions({
      models,
      newApiProviderIds,
      ovmsSupported: ovmsState.supported,
      ovmsStatus: ovmsState.status
    })
  }, [allProviders, models, ovmsState])
}
