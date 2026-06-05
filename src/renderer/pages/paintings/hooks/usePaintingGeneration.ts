import { cacheService } from '@data/CacheService'
import { usePaintings } from '@renderer/hooks/usePaintings'
import { uuid } from '@renderer/utils'
import type { PaintingMode } from '@shared/data/types/painting'
import { useCallback, useEffect, useRef } from 'react'

import { presentPaintingGenerateError } from '../errors/paintingGenerateError'
import { paintingDataToCreateDto } from '../model/mappers/paintingDataToCreateDto'
import { paintingDataToUpdateDto } from '../model/mappers/paintingDataToUpdateDto'
import {
  abortPaintingGeneration,
  clearPaintingAbortController,
  registerPaintingAbortController
} from '../model/paintingAbortControllerStore'
import { paintingGenerate } from '../model/paintingPipeline'
import type { PaintingData } from '../model/types/paintingData'
import { type PaintingGenerationState, paintingGenerationStateToCache } from '../model/utils/paintingGenerationParams'
import { usePaintingProviderRuntime } from './usePaintingProviderRuntime'

function hasOutput(painting: PaintingData) {
  return (painting.files?.length ?? 0) > 0
}

interface UsePaintingGenerationInput {
  painting: PaintingData
  onPaintingChange: (painting: PaintingData) => void
}

export function usePaintingGeneration({ painting, onPaintingChange }: UsePaintingGenerationInput) {
  const { createPainting, updatePainting, refresh } = usePaintings()
  const currentProviderId = painting.providerId
  const { provider } = usePaintingProviderRuntime(currentProviderId)
  const visibleIdRef = useRef(painting.id)

  useEffect(() => {
    visibleIdRef.current = painting.id
  }, [painting.id])

  // No unmount-abort: the page-level cache mirror in
  // `painting.generation.${id}` lets a navigated-away generation finish,
  // and the spinner rehydrates when the user returns. Explicit cancel still
  // flows through `cancelGeneration → abortPaintingGeneration`.

  const isGenerating = useCallback((p: Pick<PaintingData, 'generationStatus'>) => {
    return p.generationStatus === 'running'
  }, [])

  const applyIfVisible = useCallback(
    (next: PaintingData) => {
      if (visibleIdRef.current === next.id) {
        onPaintingChange(next)
      }
    },
    [onPaintingChange]
  )

  const generate = useCallback(async () => {
    // The in-memory draft is the source of truth for this whole flow.
    // DB writes are bookkeeping for the frozen receipt (prompt + file ids);
    // they're not consulted again to rebuild the live painting. That keeps
    // form-only fields — `mode`, `params`, `inputFiles` — intact end to end
    // without re-stitching them after each persist call.
    const shouldCreate = hasOutput(painting) || !painting.persistedAt
    const targetPainting: PaintingData = shouldCreate
      ? { ...painting, id: uuid(), files: hasOutput(painting) ? [] : painting.files }
      : { ...painting }

    try {
      const persisted = shouldCreate
        ? await createPainting(
            paintingDataToCreateDto(targetPainting as PaintingData & { providerId: string; mode: PaintingMode })
          )
        : await updatePainting(targetPainting.id, paintingDataToUpdateDto(targetPainting))
      targetPainting.persistedAt = persisted.createdAt
    } catch (error) {
      presentPaintingGenerateError(error)
      return
    }

    const generationState: PaintingGenerationState = {
      generationStatus: 'running',
      generationTaskId: null,
      generationError: null,
      generationProgress: 0
    }
    const controller = new AbortController()
    const cacheKey = `painting.generation.${targetPainting.id}` as const

    // Generation state (running/failed/canceled, taskId, progress) is the
    // page's in-memory state plus a Memory-cache mirror keyed by paintingId.
    // The cache mirror outlives this component's unmount, so navigating away
    // and back rehydrates the running spinner.
    const pushGenerationState = (updates: Partial<PaintingGenerationState>) => {
      Object.assign(generationState, updates, { generationStatus: 'running' as const })
      cacheService.set(cacheKey, paintingGenerationStateToCache(generationState))
      applyIfVisible({ ...targetPainting, ...generationState } as PaintingData)
    }

    visibleIdRef.current = targetPainting.id
    onPaintingChange({ ...targetPainting, ...generationState } as PaintingData)
    registerPaintingAbortController(targetPainting.id, controller)
    pushGenerationState(generationState)

    try {
      const generatedFiles = await paintingGenerate({
        painting: targetPainting,
        provider,
        tab: 'default',
        abortController: controller
      })
      await updatePainting(targetPainting.id, {
        files: {
          output: generatedFiles.map((file) => file.id),
          input: targetPainting.inputFiles?.map((entry) => entry.id) ?? []
        }
      })
      cacheService.set(cacheKey, null)
      // Merge the freshly-generated output into the in-memory draft; do not
      // re-read from the DB record (which would drop params / mode again).
      applyIfVisible({ ...targetPainting, files: generatedFiles } as PaintingData)
      await refresh()
    } catch (error) {
      const isCanceled = controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')
      const failedState: PaintingGenerationState = {
        ...generationState,
        generationStatus: isCanceled ? 'canceled' : 'failed',
        generationError: isCanceled ? null : error instanceof Error ? error.message : String(error)
      }
      cacheService.set(cacheKey, paintingGenerationStateToCache(failedState))
      applyIfVisible({ ...targetPainting, ...failedState } as PaintingData)
      if (!isCanceled) {
        presentPaintingGenerateError(error)
      }
    } finally {
      clearPaintingAbortController(targetPainting.id, controller)
    }
  }, [applyIfVisible, createPainting, painting, provider, refresh, onPaintingChange, updatePainting])

  const cancel = useCallback((paintingId: string) => {
    abortPaintingGeneration(paintingId)
  }, [])

  return {
    generate,
    cancel,
    generating: isGenerating(painting)
  }
}
