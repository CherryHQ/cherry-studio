import { cacheService } from '@data/CacheService'
import { presentPaintingGenerateError } from '@renderer/aiCore/errors/paintingGenerateError'
import { usePaintings } from '@renderer/hooks/usePaintings'
import { uuid } from '@renderer/utils'
import type { PaintingMode } from '@shared/data/types/painting'
import { useCallback, useEffect, useRef } from 'react'

import { paintingDataToCreateDto } from '../model/mappers/paintingDataToCreateDto'
import { paintingDataToUpdateDto } from '../model/mappers/paintingDataToUpdateDto'
import { recordToPaintingData } from '../model/mappers/recordToPaintingData'
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
    const shouldCreate = hasOutput(painting) || !painting.persistedAt
    const targetPaintingInput = shouldCreate
      ? ({
          ...painting,
          id: uuid(),
          files: hasOutput(painting) ? [] : painting.files
        } as PaintingData)
      : painting
    let targetRecord: Awaited<ReturnType<typeof createPainting>>

    try {
      targetRecord = shouldCreate
        ? await createPainting(
            paintingDataToCreateDto(targetPaintingInput as PaintingData & { providerId: string; mode: PaintingMode })
          )
        : await updatePainting(targetPaintingInput.id, paintingDataToUpdateDto(targetPaintingInput))
    } catch (error) {
      presentPaintingGenerateError(error)
      return
    }

    // `recordToPaintingData` is the DB→draft hydrator — the DB row stores
    // only the frozen receipt (prompt + files), not the live form draft
    // (mode / params). Round-tripping through it would silently drop every
    // sidebar value the user picked. Restore the form-only fields from the
    // pre-persist input so canonicalGenerate sees the params bag.
    const persistedPainting = await recordToPaintingData(targetRecord)
    const targetPainting: PaintingData = {
      ...persistedPainting,
      mode: targetPaintingInput.mode,
      params: targetPaintingInput.params,
      inputFiles: targetPaintingInput.inputFiles ?? persistedPainting.inputFiles
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
    // and back rehydrates the running spinner. The painting DB row stays a
    // frozen receipt — only final files persist there.
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
      const files = await paintingGenerate({
        painting: targetPainting,
        provider,
        tab: 'default',
        abortController: controller,
        onGenerationStateChange: pushGenerationState
      })
      const updatedRecord = await updatePainting(targetPainting.id, {
        files: {
          output: files.map((file) => file.id),
          input: paintingDataToCreateDto(targetPainting).files?.input ?? []
        }
      })
      cacheService.set(cacheKey, null)
      applyIfVisible(await recordToPaintingData(updatedRecord))
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
