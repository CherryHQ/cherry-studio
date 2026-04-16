import { cacheService } from '@data/CacheService'
import { useCache } from '@data/hooks/useCache'
import type { PaintingCanvas } from '@renderer/types'
import type { PaintingRuntimeState } from '@shared/data/cache/cacheValueTypes'

const DEFAULT_PAINTING_RUNTIME_STATE: PaintingRuntimeState = {
  isLoading: false,
  fallbackUrls: []
}

const abortControllers = new Map<string, AbortController>()

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

export function registerPaintingAbortController(paintingId: string, controller: AbortController): void {
  abortControllers.get(paintingId)?.abort()
  abortControllers.set(paintingId, controller)
}

export function getPaintingAbortController(paintingId: string): AbortController | null {
  return abortControllers.get(paintingId) ?? null
}

export function clearPaintingAbortController(paintingId: string, controller?: AbortController): void {
  if (!controller || abortControllers.get(paintingId) === controller) {
    abortControllers.delete(paintingId)
  }
}

export function abortPaintingGeneration(paintingId: string): void {
  abortControllers.get(paintingId)?.abort()
}

export function isPaintingLoading(painting: PaintingCanvas, runtimeState?: PaintingRuntimeState): boolean {
  const runtime = runtimeState ?? getPaintingRuntimeState(painting.id)

  return (
    runtime.isLoading ||
    painting.status === 'starting' ||
    painting.status === 'processing' ||
    painting.ppioStatus === 'pending' ||
    painting.ppioStatus === 'processing'
  )
}
