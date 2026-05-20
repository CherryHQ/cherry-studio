import { useModels } from '@renderer/hooks/useModels'
import { useProviders } from '@renderer/hooks/useProviders'
import type { Model } from '@shared/data/types/model'
import { useEffect, useMemo, useState } from 'react'

import { isPaintingNewApiProvider } from '../model/types/paintingProviderRuntime'
import { supportsImageGenerationEndpoint } from '../model/utils/paintingModelOptions'
import { getValidPaintingOptions } from '../utils/providerSelection'

/**
 * Transitional coexistence list — NOT an enablement allowlist.
 *
 * Provider enablement is derived from model capability (any provider whose v2
 * models carry IMAGE_GENERATION appears automatically). These ids are kept
 * visible only because their painting models still live in painting-local
 * static catalogs, not yet in v2 `userModel` (Phase 1A — deferred). This list
 * is removed in Phase 4 once Phase 1A migrates those models, at which point
 * enablement is fully capability-derived. Order also preserves the existing
 * provider ordering in the UI so this change is UX-neutral.
 */
const LEGACY_STATIC_CATALOG_PROVIDERS = [
  'zhipu',
  'aihubmix',
  'silicon',
  'dmxapi',
  'tokenflux',
  'new-api',
  'cherryin',
  'aionly',
  'ovms',
  'ppio'
] as const

type OvmsStatus = 'not-installed' | 'not-running' | 'running'
interface OvmsState {
  supported: boolean
  status: OvmsStatus
}

const DEFAULT_OVMS_STATE: OvmsState = { supported: false, status: 'not-running' }

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
 * Pure merge: capability-derived provider ids ∪ transitional legacy catalog
 * ids ∪ user-added new-api compat ids, in a stable UX-neutral order, then
 * filtered by the ovms availability gate. Exported for unit testing.
 */
export function buildPaintingProviderOptions(input: {
  models: readonly Model[]
  newApiProviderIds: readonly string[]
  ovmsSupported: boolean
  ovmsStatus: OvmsStatus
}): string[] {
  // Capability-derived: any provider whose v2 models can generate images.
  // This is the real enablement source — a new image-capable provider
  // appears here with no allowlist edit.
  const capabilityProviderIds = new Set<string>()
  for (const model of input.models) {
    if (supportsImageGenerationEndpoint(model)) {
      capabilityProviderIds.add(model.providerId)
    }
  }

  // Stable, UX-neutral order: legacy catalog ids first (preserves current
  // ordering), then any newly capability-derived providers (sorted), then
  // new-api compat ids.
  const derivedExtras = [...capabilityProviderIds]
    .filter((id) => !LEGACY_STATIC_CATALOG_PROVIDERS.includes(id as (typeof LEGACY_STATIC_CATALOG_PROVIDERS)[number]))
    .sort()

  const merged = [...new Set([...LEGACY_STATIC_CATALOG_PROVIDERS, ...derivedExtras, ...input.newApiProviderIds])]
  return getValidPaintingOptions(merged, input.ovmsSupported, input.ovmsStatus)
}

export function usePaintingProviderOptions(): string[] {
  const { providers: allProviders } = useProviders()
  const { models } = useModels()
  const [ovmsState, setOvmsState] = useState<OvmsState>(() => cachedOvmsState ?? DEFAULT_OVMS_STATE)

  useEffect(() => {
    if (cachedOvmsState) return
    let cancelled = false
    void loadOvmsState().then((state) => {
      if (!cancelled) setOvmsState(state)
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
