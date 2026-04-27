import { loggerService } from '@logger'
import { useProviderActions } from '@renderer/hooks/useProviders'
import type { Provider } from '@shared/data/types/provider'
import { useCallback } from 'react'

import { removeProviderLogo } from '../hooks/useProviderLogo'

const logger = loggerService.withContext('useProviderDelete')

export function useProviderDelete() {
  const { deleteProviderById } = useProviderActions()

  const deleteProvider = useCallback(
    async (providerId: Provider['id']) => {
      try {
        await removeProviderLogo(providerId)
      } catch (error) {
        logger.error('Failed to delete logo', error as Error)
      }

      await deleteProviderById(providerId)
    },
    [deleteProviderById]
  )

  return { deleteProvider }
}
