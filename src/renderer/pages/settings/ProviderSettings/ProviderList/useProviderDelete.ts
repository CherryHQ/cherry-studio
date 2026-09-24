import { useCallback } from 'react'

import { useProviderActions } from '@renderer/hooks/useProvider'
import type { Provider } from '@shared/data/types/provider'

import { clearLastWrittenEndpointConfigs } from '../hooks/providerSetting/endpointConfigsWriteCoordinator'

export function useProviderDelete() {
  const { deleteProviderById } = useProviderActions()

  // The custom logo lives on the provider row, so it is removed together with
  // the provider — no separate logo cleanup needed.
  const deleteProvider = useCallback(
    async (providerId: Provider['id']) => {
      await deleteProviderById(providerId)
      // A recreated provider under the same ID must not inherit this snapshot.
      clearLastWrittenEndpointConfigs(providerId)
    },
    [deleteProviderById]
  )

  return { deleteProvider }
}
