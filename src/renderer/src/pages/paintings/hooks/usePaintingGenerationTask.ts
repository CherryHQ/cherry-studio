import { useCache } from '@data/hooks/useCache'
import { useCallback, useRef, useState } from 'react'

type GenerationTask = (signal: AbortSignal) => Promise<void>

type UsePaintingGenerationTaskOptions = {
  onError: (error: unknown) => void
}

type CancelGenerationOptions = {
  finishImmediately?: boolean
}

export function usePaintingGenerationTask({ onError }: UsePaintingGenerationTaskOptions) {
  const [isLoading, setIsLoading] = useState(false)
  const abortControllerRef = useRef<AbortController | null>(null)
  const [generating, setGenerating] = useCache('chat.generating')

  const runGeneration = useCallback(
    async (task: GenerationTask) => {
      const controller = new AbortController()
      abortControllerRef.current = controller
      setIsLoading(true)
      setGenerating(true)

      try {
        await task(controller.signal)
      } catch (error: unknown) {
        onError(error)
      } finally {
        setIsLoading(false)
        setGenerating(false)
        abortControllerRef.current = null
      }
    },
    [onError, setGenerating]
  )

  const cancelGeneration = useCallback(
    (options: CancelGenerationOptions = {}) => {
      abortControllerRef.current?.abort()

      if (options.finishImmediately) {
        setIsLoading(false)
        setGenerating(false)
        abortControllerRef.current = null
      }
    },
    [setGenerating]
  )

  return {
    isLoading,
    setIsLoading,
    generating,
    runGeneration,
    cancelGeneration
  }
}
