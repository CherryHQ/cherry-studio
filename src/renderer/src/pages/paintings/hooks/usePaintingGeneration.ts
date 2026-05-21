import { loggerService } from '@logger'
import { presentPaintingGenerateError } from '@renderer/aiCore/errors/paintingGenerateError'
import { usePaintings } from '@renderer/hooks/usePaintings'
import { uuid } from '@renderer/utils'
import type { PaintingMode } from '@shared/data/types/painting'
import { useCallback, useEffect, useMemo, useRef } from 'react'

const logger = loggerService.withContext('paintings/generation')

import { paintingDataToCreateDto, paintingParamsForPersistence } from '../model/mappers/paintingDataToCreateDto'
import { paintingDataToUpdateDto } from '../model/mappers/paintingDataToUpdateDto'
import { recordToPaintingData } from '../model/mappers/recordToPaintingData'
import {
  abortPaintingGeneration,
  clearPaintingAbortController,
  registerPaintingAbortController
} from '../model/paintingAbortControllerStore'
import type { PaintingData } from '../model/types/paintingData'
import { cleanRuntime, type PaintingGenerationState, withRuntime } from '../model/utils/paintingGenerationParams'
import { moveEditImageFiles } from '../providers/newapi/editFiles'
import { resolvePaintingProviderDefinition, resolvePaintingTabForMode } from '../utils/paintingProviderMode'
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
  const definition = useMemo(() => resolvePaintingProviderDefinition(currentProviderId), [currentProviderId])
  const tab = useMemo(
    () => resolvePaintingTabForMode(definition, painting.mode) ?? definition.mode.defaultTab,
    [definition, painting.mode]
  )
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

    if (shouldCreate) {
      moveEditImageFiles(painting.id, targetPaintingInput.id)
    }

    const targetPainting = await recordToPaintingData(targetRecord)
    const generationState: PaintingGenerationState = {
      generationStatus: 'running',
      generationTaskId: null,
      generationError: null,
      generationProgress: 0
    }
    let generationStateQueue = Promise.resolve()
    let generationStatePersistFailed = false
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
          generationStatePersistFailed = true
          presentPaintingGenerateError(error)
        })
    }

    visibleIdRef.current = targetPainting.id
    onPaintingChange({ ...targetPainting, ...generationState } as PaintingData)
    registerPaintingAbortController(targetPainting.id, controller)
    inFlightIdRef.current = targetPainting.id
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
      // A mid-generation persistence failure was already surfaced by the
      // queue's catch handler. Don't continue as if the in-progress state
      // was saved — and crucially, force the painting into a terminal
      // 'failed' state. Otherwise the DB still reads 'running'; the next
      // refresh re-hydrates 'running' into the UI; the controller is
      // cleared in the `finally` below; so the painting would be stuck
      // on the spinner with no way to cancel.
      if (generationStatePersistFailed) {
        const failedState: PaintingGenerationState = {
          ...generationState,
          generationStatus: 'failed',
          generationError: 'Mid-stream state persistence failed'
        }
        try {
          const updatedRecord = await updatePainting(targetPainting.id, {
            params: withRuntime(paintingParamsForPersistence(targetPainting), failedState)
          })
          applyIfVisible(await recordToPaintingData(updatedRecord))
          await refresh()
        } catch (persistErr) {
          // Even the failed-state write failed. Push the failed state to
          // the in-memory record so the UI at least stops spinning;
          // skip `refresh()` because it would re-hydrate the stale
          // 'running' from DB and undo this fallback.
          logger.error('Failed to persist painting failed-state (early-return path)', persistErr as Error)
          applyIfVisible({ ...targetPainting, ...failedState } as PaintingData)
        }
        return
      }
      const updatedRecord = await updatePainting(targetPainting.id, {
        files: {
          output: files.map((file) => file.id),
          input: paintingDataToCreateDto(targetPainting).files?.input ?? []
        },
        params: cleanRuntime(paintingParamsForPersistence(targetPainting))
      })
      applyIfVisible(await recordToPaintingData(updatedRecord))
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
      } catch (persistErr) {
        // Failed-state persistence ALSO failed — push the failed state
        // to the in-memory record so the spinner stops. Skipping
        // `refresh()` because it would re-fetch the stale 'running'
        // from DB and overwrite this fallback. The original `error`
        // gets surfaced via `presentPaintingGenerateError` below.
        logger.error('Failed to persist painting failed-state (catch path)', persistErr as Error)
        applyIfVisible({ ...targetPainting, ...failedState } as PaintingData)
      }
      if (!isCanceled) {
        presentPaintingGenerateError(error)
      }
    } finally {
      clearPaintingAbortController(targetPainting.id, controller)
      if (inFlightIdRef.current === targetPainting.id) {
        inFlightIdRef.current = null
      }
    }
  }, [applyIfVisible, createPainting, definition, painting, provider, refresh, onPaintingChange, tab, updatePainting])

  const cancel = useCallback((paintingId: string) => {
    abortPaintingGeneration(paintingId)
  }, [])

  return {
    generate,
    cancel,
    generating: isGenerating(painting)
  }
}
