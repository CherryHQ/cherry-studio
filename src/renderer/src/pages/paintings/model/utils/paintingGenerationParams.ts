import type { CachePaintingGenerationState } from '@shared/data/cache/cacheValueTypes'

import type { PaintingData, PaintingGenerationStatus } from '../types/paintingData'

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

const GENERATION_PARAM_KEYS = new Set(['generationStatus', 'generationTaskId', 'generationError', 'generationProgress'])

export function isRuntimeKey(key: string): boolean {
  return GENERATION_PARAM_KEYS.has(key)
}

function isStatus(value: unknown): value is PaintingGenerationStatus {
  return value === 'running' || value === 'failed' || value === 'canceled'
}

export function readRuntime(params: Record<string, unknown>): Partial<PaintingGenerationState> {
  const generationStatus = isStatus(params.generationStatus) ? params.generationStatus : undefined
  const generationTaskId = typeof params.generationTaskId === 'string' ? params.generationTaskId : undefined
  const generationError =
    typeof params.generationError === 'string' || params.generationError === null ? params.generationError : undefined
  const generationProgress =
    typeof params.generationProgress === 'number' && Number.isFinite(params.generationProgress)
      ? params.generationProgress
      : undefined

  return {
    ...(generationStatus !== undefined ? { generationStatus } : {}),
    ...(generationTaskId !== undefined ? { generationTaskId } : {}),
    ...(generationError !== undefined ? { generationError } : {}),
    ...(generationProgress !== undefined ? { generationProgress } : {})
  }
}

export function cleanRuntime(params: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(params).filter(([key]) => !isRuntimeKey(key)))
}

export function withRuntime(
  params: Record<string, unknown>,
  generation: PaintingGenerationState
): Record<string, unknown> {
  return {
    ...cleanRuntime(params),
    generationStatus: generation.generationStatus,
    generationTaskId: generation.generationTaskId ?? null,
    generationError: generation.generationError ?? null,
    generationProgress: generation.generationProgress ?? null
  }
}
