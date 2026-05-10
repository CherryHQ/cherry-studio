import { useProviders } from '@renderer/hooks/useProviders'
import { useEffect, useMemo, useState } from 'react'

import { isPaintingNewApiProvider } from '../model/types/paintingProviderRuntime'
import { getValidPaintingOptions } from '../utils/providerSelection'

const BASE_OPTIONS = ['zhipu', 'aihubmix', 'silicon', 'dmxapi', 'tokenflux', 'ovms', 'ppio'] as const

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

export function usePaintingProviderOptions(): string[] {
  const { providers: allProviders } = useProviders()
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
    const merged = [
      ...new Set([...BASE_OPTIONS, ...allProviders.filter(isPaintingNewApiProvider).map((provider) => provider.id)])
    ]
    return getValidPaintingOptions(merged, ovmsState.supported, ovmsState.status)
  }, [allProviders, ovmsState])
}
