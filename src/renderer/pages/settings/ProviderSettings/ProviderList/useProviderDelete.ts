import { useProviderActions } from '@renderer/hooks/useProvider'
import type { Provider } from '@shared/data/types/provider'
import { useCallback } from 'react'

export function useProviderDelete() {
  const { deleteProviderById } = useProviderActions()

  // The custom logo lives on the provider row, so it is removed together with
  // the provider — no separate logo cleanup needed.
  const deleteProvider = useCallback(
    async (providerId: Provider['id']) => {
      await deleteProviderById(providerId)
    },
    [deleteProviderById]
  )

  return { deleteProvider }
}
