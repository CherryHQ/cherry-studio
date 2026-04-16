import { loggerService } from '@logger'
import type { Provider } from '@renderer/types'
import { useEffect, useMemo, useRef, useState } from 'react'

const logger = loggerService.withContext('useModelLoader')

export type ModelOption = {
  label: string
  value: string
  group?: string
  [key: string]: any
}

export type ModelConfig =
  | { type: 'static'; options: ModelOption[] }
  | { type: 'async'; loader: () => Promise<ModelOption[]> }
  | { type: 'dynamic'; resolver: (provider: Provider) => ModelOption[] }

export function useModelLoader(
  config: ModelConfig,
  provider: Provider
): {
  modelOptions: ModelOption[]
  isLoadingModels: boolean
} {
  const [asyncModels, setAsyncModels] = useState<ModelOption[]>([])
  const [isLoadingModels, setIsLoadingModels] = useState(config.type === 'async')
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

    config
      .loader()
      .then((models) => {
        if (!mountedRef.current || cancelled) return
        setAsyncModels(models)
      })
      .catch((error) => {
        if (!mountedRef.current || cancelled) return
        logger.error('Failed to load models', error)
        setAsyncModels([])
      })
      .finally(() => {
        if (!mountedRef.current || cancelled) return
        setIsLoadingModels(false)
      })

    return () => {
      cancelled = true
    }
  }, [config])

  const dynamicModels = useMemo(() => {
    if (config.type !== 'dynamic') return []
    return config.resolver(provider)
  }, [config, provider])

  if (config.type === 'static') {
    return { modelOptions: config.options, isLoadingModels: false }
  }

  if (config.type === 'async') {
    return { modelOptions: asyncModels, isLoadingModels }
  }

  return { modelOptions: dynamicModels, isLoadingModels: false }
}
