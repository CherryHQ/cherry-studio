import type { CachePaintingGenerationState } from '@shared/data/cache/cacheValueTypes'

import type { PaintingData } from '../types/paintingData'

export type PaintingGenerationState = Pick<
  PaintingData,
  'generationStatus' | 'generationTaskId' | 'generationError' | 'generationProgress'
>

/**
 * Project the painting-shaped `PaintingGenerationState` to the cache-shaped
 * `CachePaintingGenerationState`. Returns `null` for the absent / completed
 * state so the cache value `null` represents "no in-flight run".
 */
export function paintingGenerationStateToCache(state: PaintingGenerationState): CachePaintingGenerationState | null {
  if (!state.generationStatus) return null
  return {
    status: state.generationStatus,
    taskId: state.generationTaskId ?? null,
    error: state.generationError ?? null,
    progress: state.generationProgress ?? null
  }
}

/** Inverse of `paintingGenerationStateToCache` for hydrating the painting view. */
export function cacheToPaintingGenerationState(cached: CachePaintingGenerationState | null): PaintingGenerationState {
  if (!cached) {
    return { generationStatus: null, generationTaskId: null, generationError: null, generationProgress: null }
  }
  return {
    generationStatus: cached.status,
    generationTaskId: cached.taskId,
    generationError: cached.error,
    generationProgress: cached.progress
  }
}
