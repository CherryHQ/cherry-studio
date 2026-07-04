import { useReadCache } from '@data/hooks/useDataApi'
import { useReorder } from '@data/hooks/useReorder'
import type { Provider } from '@shared/data/types/provider'
import { useCallback, useMemo } from 'react'

import type { ProviderReorderActions } from '../utils/providerEnablement'

export class ProviderListNotReadyForReorderError extends Error {
  constructor() {
    super('Provider list cache is not ready for reorder')
    this.name = 'ProviderListNotReadyForReorderError'
  }
}

/** Moves providers through the list cache-aware reorder contract used by ProviderSettings. */
export function useMoveProviderToFirst(): ProviderReorderActions {
  const readCache = useReadCache()
  const { move } = useReorder('/providers')

  const assertCanMoveProviderToFirst = useCallback(() => {
    if (readCache<Provider[]>('/providers') === undefined) {
      throw new ProviderListNotReadyForReorderError()
    }
  }, [readCache])

  const moveProviderToFirst = useCallback(
    async (providerId: Provider['id']) => {
      assertCanMoveProviderToFirst()
      await move(providerId, { position: 'first' })
    },
    [assertCanMoveProviderToFirst, move]
  )

  return useMemo(
    () => ({
      assertCanMoveProviderToFirst,
      moveProviderToFirst
    }),
    [assertCanMoveProviderToFirst, moveProviderToFirst]
  )
}
