import { cacheService } from '@data/CacheService'
import { useCache } from '@data/hooks/useCache'
import type { PaintingRuntimeState } from '@shared/data/cache/cacheValueTypes'

import type { PaintingData } from '../types/paintingData'

const DEFAULT_PAINTING_RUNTIME_STATE: PaintingRuntimeState = {
  isLoading: false,
  fallbackUrls: []
}

export function getPaintingRuntimeCacheKey(paintingId: string): `painting.runtime.${string}` {
  return `painting.runtime.${paintingId}`
}

export function getPaintingSelectionCacheKey(scope: string): `painting.selection.${string}` {
  return `painting.selection.${scope}`
}

export function getPaintingModeCacheKey(providerId: string): `painting.mode.${string}` {
  return `painting.mode.${providerId}`
}

export function usePaintingRuntime(paintingId: string) {
  return useCache(getPaintingRuntimeCacheKey(paintingId), DEFAULT_PAINTING_RUNTIME_STATE)
}

export function getPaintingRuntimeState(paintingId: string): PaintingRuntimeState {
  return cacheService.get(getPaintingRuntimeCacheKey(paintingId)) ?? DEFAULT_PAINTING_RUNTIME_STATE
}

export function patchPaintingRuntimeState(paintingId: string, updates: Partial<PaintingRuntimeState>): void {
  const current = getPaintingRuntimeState(paintingId)
  cacheService.set(getPaintingRuntimeCacheKey(paintingId), { ...current, ...updates })
}

export function setPaintingLoading(paintingId: string, isLoading: boolean): void {
  patchPaintingRuntimeState(paintingId, { isLoading })
}

export function setPaintingFallbackUrls(paintingId: string, fallbackUrls: string[]): void {
  patchPaintingRuntimeState(paintingId, { fallbackUrls })
}

export function clearPaintingRuntimeState(paintingId: string): void {
  cacheService.set(getPaintingRuntimeCacheKey(paintingId), DEFAULT_PAINTING_RUNTIME_STATE)
}

export function isPaintingLoading(painting: PaintingData, runtimeState?: PaintingRuntimeState): boolean {
  const runtime = runtimeState ?? getPaintingRuntimeState(painting.id)

  return (
    runtime.isLoading ||
    painting.generationStatus === 'starting' ||
    painting.generationStatus === 'processing' ||
    painting.taskStatus === 'pending' ||
    painting.taskStatus === 'processing'
  )
}
