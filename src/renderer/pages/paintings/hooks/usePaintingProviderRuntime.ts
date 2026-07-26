import { useProvider, useProviderApiKeys, useProviderPreset } from '@renderer/hooks/useProvider'
import { useMemo } from 'react'

import {
  createPaintingProviderRuntime,
  type PaintingProviderRuntime,
  pickFirstEnabledApiKey
} from '../model/types/paintingProviderRuntime'

const ENDPOINT_CONFIG_PRESET_FIELDS = ['endpointConfigs'] as const

export function usePaintingProviderRuntime(providerId: string): {
  provider: PaintingProviderRuntime
  isLoading: boolean
  error?: unknown
} {
  const { provider, isLoading, error } = useProvider(providerId)
  const { data: apiKeysData } = useProviderApiKeys(providerId)
  const {
    data: preset,
    isLoading: isPresetLoading,
    error: presetError
  } = useProviderPreset(providerId, ENDPOINT_CONFIG_PRESET_FIELDS)

  const apiKey = useMemo(() => pickFirstEnabledApiKey(apiKeysData?.keys), [apiKeysData])

  const runtimeProvider = useMemo(
    () => createPaintingProviderRuntime(provider, providerId, apiKey, preset?.endpointConfigs),
    [provider, providerId, apiKey, preset?.endpointConfigs]
  )

  return {
    provider: runtimeProvider,
    isLoading: isLoading || isPresetLoading,
    error: error ?? presetError
  }
}
