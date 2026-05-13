import { useProvider } from '@renderer/hooks/useProviders'
import { useMemo } from 'react'

import { createPaintingProviderRuntime, type PaintingProviderRuntime } from '../model/types/paintingProviderRuntime'

export function usePaintingProviderRuntime(providerId: string): {
  provider: PaintingProviderRuntime
  isLoading: boolean
  error?: unknown
} {
  const { provider, isLoading, error } = useProvider(providerId)

  const runtimeProvider = useMemo(() => createPaintingProviderRuntime(provider, providerId), [provider, providerId])

  return {
    provider: runtimeProvider,
    isLoading,
    error
  }
}
