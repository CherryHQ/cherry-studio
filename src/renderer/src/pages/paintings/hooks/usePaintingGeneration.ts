import { usePaintings } from '@renderer/hooks/usePaintings'
import { uuid } from '@renderer/utils'
import type { PaintingMode } from '@shared/data/types/painting'
import { type Dispatch, type SetStateAction, useCallback, useEffect, useRef } from 'react'

import { presentPaintingGenerateError } from '../model/errors/paintingGenerateError'
import { paintingDataToCreateDto, paintingParamsForPersistence } from '../model/mappers/paintingDataToCreateDto'
import { paintingDataToUpdateDto } from '../model/mappers/paintingDataToUpdateDto'
import { recordToPaintingData } from '../model/mappers/recordToPaintingData'
import {
  clearPaintingAbortController,
  registerPaintingAbortController
} from '../model/runtime/paintingAbortControllerStore'
import type { PaintingData } from '../model/types/paintingData'
import type { PaintingProviderRuntime } from '../model/types/paintingProviderRuntime'
import { cleanRuntime, type PaintingGenerationState, withRuntime } from '../model/utils/paintingGenerationParams'
import type { PaintingProviderDefinition } from '../providers/types'

function hasOutput(painting: PaintingData) {
  return (painting.files?.length ?? 0) > 0
}

interface UsePaintingGenerationInput {
  painting: PaintingData
  persisted: boolean
  provider: PaintingProviderRuntime
  definition: PaintingProviderDefinition
  tab: string
  setPainting: Dispatch<SetStateAction<PaintingData>>
  setPersisted: (value: boolean) => void
}

export function usePaintingGeneration({
  painting,
  persisted,
  provider,
  definition,
  tab,
  setPainting,
  setPersisted
}: UsePaintingGenerationInput) {
  const { createPainting, updatePainting, refresh } = usePaintings()
  const abortControllersRef = useRef(new Map<string, AbortController>())
  const visibleIdRef = useRef(painting.id)

  useEffect(() => {
    visibleIdRef.current = painting.id
  }, [painting.id])

  const isGenerating = useCallback((p: Pick<PaintingData, 'generationStatus'>) => {
    return p.generationStatus === 'running'
  }, [])

  const applyIfVisible = useCallback(
    (next: PaintingData) => {
      if (visibleIdRef.current === next.id) {
        setPainting(next)
      }
    },
    [setPainting]
  )

  const generate = useCallback(async () => {
    const shouldCreate = hasOutput(painting) || !persisted
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
    let generationStateQueue = Promise.resolve()
    const controller = new AbortController()

    const updateGenerationState = (updates: Partial<PaintingGenerationState>) => {
      Object.assign(generationState, updates, { generationStatus: 'running' as const })
      generationStateQueue = generationStateQueue
        .then(async () => {
          if (controller.signal.aborted) return
          const updatedRecord = await updatePainting(targetPainting.id, {
            params: withRuntime(paintingParamsForPersistence(targetPainting), generationState)
          })
          applyIfVisible(await recordToPaintingData(updatedRecord))
          await refresh()
        })
        .catch((error) => {
          presentPaintingGenerateError(error)
        })
    }

    abortControllersRef.current.set(targetPainting.id, controller)
    visibleIdRef.current = targetPainting.id
    setPainting({ ...targetPainting, ...generationState } as PaintingData)
    setPersisted(true)
    registerPaintingAbortController(targetPainting.id, controller)
    updateGenerationState(generationState)

    try {
      const files = await definition.generate({
        painting: targetPainting,
        provider,
        tab,
        abortController: controller,
        onGenerationStateChange: updateGenerationState
      })
      await generationStateQueue
      const updatedRecord = await updatePainting(targetPainting.id, {
        files: { output: files.map((file) => file.id), input: [] },
        params: cleanRuntime(paintingParamsForPersistence(targetPainting))
      })
      applyIfVisible(await recordToPaintingData(updatedRecord))
      setPersisted(true)
      await refresh()
    } catch (error) {
      const isCanceled = controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')
      await generationStateQueue

      const failedState: PaintingGenerationState = {
        ...generationState,
        generationStatus: isCanceled ? 'canceled' : 'failed',
        generationError: isCanceled ? null : error instanceof Error ? error.message : String(error)
      }
      try {
        const updatedRecord = await updatePainting(targetPainting.id, {
          params: withRuntime(paintingParamsForPersistence(targetPainting), failedState)
        })
        applyIfVisible(await recordToPaintingData(updatedRecord))
        await refresh()
      } catch {
        await refresh()
      }
      if (!isCanceled) {
        presentPaintingGenerateError(error)
      }
    } finally {
      clearPaintingAbortController(targetPainting.id, controller)
      if (abortControllersRef.current.get(targetPainting.id) === controller) {
        abortControllersRef.current.delete(targetPainting.id)
      }
    }
  }, [
    applyIfVisible,
    createPainting,
    definition,
    persisted,
    painting,
    provider,
    refresh,
    setPainting,
    setPersisted,
    tab,
    updatePainting
  ])

  const cancel = useCallback((paintingId: string) => {
    abortControllersRef.current.get(paintingId)?.abort()
  }, [])

  return {
    generate,
    cancel,
    generating: isGenerating(painting)
  }
}
