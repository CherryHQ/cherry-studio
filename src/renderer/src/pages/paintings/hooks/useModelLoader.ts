import { loggerService } from '@logger'
import { useEffect, useMemo, useRef, useState } from 'react'

import type { PaintingProviderRuntime } from '../model/types/paintingProviderRuntime'

const logger = loggerService.withContext('useModelLoader')

export type ModelOption = {
  label: string
  value: string
  group?: string
  [key: string]: any
}

export type ModelConfig =
  | { type: 'static'; options: ModelOption[] }
  | { type: 'async'; loader: (provider?: PaintingProviderRuntime) => Promise<ModelOption[]> }
  | { type: 'dynamic'; resolver: (provider: PaintingProviderRuntime) => ModelOption[] }

export function useModelLoader(
  config: ModelConfig,
  provider: PaintingProviderRuntime
): {
  modelOptions: ModelOption[]
  isLoadingModels: boolean
  modelLoadError?: Error
} {
  const [asyncModels, setAsyncModels] = useState<ModelOption[]>([])
  const [isLoadingModels, setIsLoadingModels] = useState(config.type === 'async')
  const [modelLoadError, setModelLoadError] = useState<Error | undefined>()
  const mountedRef = useRef(true)

  useEffect(() => {
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    if (config.type !== 'async') return

    let cancelled = false
    setIsLoadingModels(true)
    setModelLoadError(undefined)

    config
      .loader(provider)
      .then((models) => {
        if (!mountedRef.current || cancelled) return
        setAsyncModels(models)
      })
      .catch((error) => {
        if (!mountedRef.current || cancelled) return
        logger.error('Failed to load models', error)
        setModelLoadError(error instanceof Error ? error : new Error('Failed to load models'))
        setAsyncModels([])
      })
      .finally(() => {
        if (!mountedRef.current || cancelled) return
        setIsLoadingModels(false)
      })

    return () => {
      cancelled = true
    }
  }, [config, provider])

  const dynamicModels = useMemo(() => {
    if (config.type !== 'dynamic') return []
    return config.resolver(provider)
  }, [config, provider])

  if (config.type === 'static') {
    return { modelOptions: config.options, isLoadingModels: false, modelLoadError: undefined }
  }

  if (config.type === 'async') {
    return { modelOptions: asyncModels, isLoadingModels, modelLoadError }
  }

  return { modelOptions: dynamicModels, isLoadingModels: false, modelLoadError: undefined }
}
