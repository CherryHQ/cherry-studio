import { useCallback } from 'react'

import { abortPaintingGeneration } from '../../model/runtime/paintingAbortControllerStore'
import {
  setPaintingFallbackUrls,
  setPaintingLoading,
  usePaintingRuntime
} from '../../model/runtime/paintingRuntimeStore'

export function usePaintingGeneration(paintingId: string) {
  const [paintingRuntime] = usePaintingRuntime(paintingId)

  const setIsLoading = useCallback(
    (value: boolean) => {
      setPaintingLoading(paintingId, value)
    },
    [paintingId]
  )

  const setIsLoadingForPainting = useCallback((targetPaintingId: string, value: boolean) => {
    setPaintingLoading(targetPaintingId, value)
  }, [])

  const setFallbackUrls = useCallback(
    (urls: string[]) => {
      setPaintingFallbackUrls(paintingId, urls)
    },
    [paintingId]
  )

  const setFallbackUrlsForPainting = useCallback((targetPaintingId: string, urls: string[]) => {
    setPaintingFallbackUrls(targetPaintingId, urls)
  }, [])

  const onCancel = useCallback(() => {
    abortPaintingGeneration(paintingId)
  }, [paintingId])

  return {
    isLoading: paintingRuntime.isLoading,
    fallbackUrls: paintingRuntime.fallbackUrls,
    setIsLoading,
    setIsLoadingForPainting,
    setFallbackUrls,
    setFallbackUrlsForPainting,
    onCancel
  }
}
