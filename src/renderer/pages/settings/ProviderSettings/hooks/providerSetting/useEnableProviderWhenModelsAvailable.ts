import { loggerService } from '@logger'
import type { UpdateProviderDto } from '@shared/data/api/schemas/providers'
import type { Provider } from '@shared/data/types/provider'
import { useCallback } from 'react'

const logger = loggerService.withContext('ProviderSettings:EnableProviderWhenModelsAvailable')

type UpdateProvider = (updates: UpdateProviderDto) => Promise<unknown>

interface UseEnableProviderWhenModelsAvailableOptions {
  providerId: string
  provider: Pick<Provider, 'id' | 'isEnabled'> | undefined
  updateProvider?: UpdateProvider
  source: string
}

export function useEnableProviderWhenModelsAvailable({
  providerId,
  provider,
  updateProvider,
  source
}: UseEnableProviderWhenModelsAvailableOptions) {
  return useCallback(
    async (modelCount: number): Promise<boolean> => {
      if (!provider || provider.isEnabled || modelCount <= 0 || !updateProvider) {
        return false
      }

      try {
        await updateProvider({ isEnabled: true })
        return true
      } catch (error) {
        logger.error('Failed to enable provider when models are available', {
          providerId,
          modelCount,
          source,
          error
        })
        return false
      }
    },
    [provider, providerId, source, updateProvider]
  )
}
