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
import type { PaintingGenerationState } from '../model/utils/paintingGenerationParams'
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
  const inFlightIdRef = useRef<string | null>(null)

  useEffect(() => {
    visibleIdRef.current = painting.id
  }, [painting.id])

  useEffect(
    () => () => {
      if (inFlightIdRef.current) {
        abortPaintingGeneration(inFlightIdRef.current)
      }
    },
    []
  )

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

    const targetPainting = await recordToPaintingData(targetRecord)
    const generationState: PaintingGenerationState = {
      generationStatus: 'running',
      generationTaskId: null,
      generationError: null,
      generationProgress: 0
    }
    const controller = new AbortController()

    // Generation state (running/failed/canceled, taskId, progress) is
    // in-memory only — the painting row is a frozen receipt of completed
    // work, not a state container. On reload, in-flight generations from a
    // previous session are simply gone; on success we persist final files.
    const pushGenerationState = (updates: Partial<PaintingGenerationState>) => {
      Object.assign(generationState, updates, { generationStatus: 'running' as const })
      applyIfVisible({ ...targetPainting, ...generationState } as PaintingData)
    }

    visibleIdRef.current = targetPainting.id
    onPaintingChange({ ...targetPainting, ...generationState } as PaintingData)
    registerPaintingAbortController(targetPainting.id, controller)
    inFlightIdRef.current = targetPainting.id
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
      applyIfVisible(await recordToPaintingData(updatedRecord))
      await refresh()
    } catch (error) {
      const isCanceled = controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')
      const failedState: PaintingGenerationState = {
        ...generationState,
        generationStatus: isCanceled ? 'canceled' : 'failed',
        generationError: isCanceled ? null : error instanceof Error ? error.message : String(error)
      }
      applyIfVisible({ ...targetPainting, ...failedState } as PaintingData)
      if (!isCanceled) {
        presentPaintingGenerateError(error)
      }
    } finally {
      clearPaintingAbortController(targetPainting.id, controller)
      if (inFlightIdRef.current === targetPainting.id) {
        inFlightIdRef.current = null
      }
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
