import type { PaintingData, PaintingGenerationStatus } from '../types/paintingData'

export type PaintingGenerationState = Pick<
  PaintingData,
  'generationStatus' | 'generationTaskId' | 'generationError' | 'generationProgress'
>

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
