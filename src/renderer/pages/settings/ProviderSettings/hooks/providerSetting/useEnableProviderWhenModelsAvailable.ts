import { loggerService } from '@logger'
import type { UpdateProviderDto } from '@shared/data/api/schemas/providers'
import type { Provider } from '@shared/data/types/provider'
import { useCallback, useRef } from 'react'

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
  // Dedupe in-flight enable requests: `provider.isEnabled` is a closure snapshot
  // that won't reflect an enable already in flight, so without this lock two
  // overlapping calls (StrictMode double-invoke, rapid concurrent flows) could
  // both fire `updateProvider` before the first PATCH re-renders isEnabled.
  const enableInFlightRef = useRef(false)

  return useCallback(
    async (modelCount: number): Promise<boolean> => {
      // `!(modelCount > 0)` also rejects undefined/NaN counts, in case a caller
      // reads `.length` off a non-array (where `undefined <= 0` would be false).
      if (!provider || provider.isEnabled || !(modelCount > 0) || !updateProvider) {
        return false
      }

      if (enableInFlightRef.current) {
        return false
      }
      enableInFlightRef.current = true

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
      } finally {
        enableInFlightRef.current = false
      }
    },
    [provider, providerId, source, updateProvider]
  )
}
