import { useProvider, useProviderApiKeys } from '@renderer/hooks/useProviders'
import { useMemo } from 'react'

import {
  createPaintingProviderRuntime,
  type PaintingProviderRuntime,
  pickFirstEnabledApiKey
} from '../model/types/paintingProviderRuntime'

export function usePaintingProviderRuntime(providerId: string): {
  provider: PaintingProviderRuntime
  isLoading: boolean
  error?: unknown
} {
  const { provider, isLoading, error } = useProvider(providerId)
  const { data: apiKeysData } = useProviderApiKeys(providerId)

  const apiKey = useMemo(() => pickFirstEnabledApiKey(apiKeysData?.keys), [apiKeysData])

  const runtimeProvider = useMemo(
    () => createPaintingProviderRuntime(provider, providerId, apiKey),
    [provider, providerId, apiKey]
  )

  return {
    provider: runtimeProvider,
    isLoading,
    error
  }
}
