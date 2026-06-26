import { cacheService } from '@data/CacheService'
import { usePaintings } from '@renderer/hooks/usePaintings'
import { uuid } from '@renderer/utils/uuid'
import { useCallback, useState } from 'react'

import { presentPaintingGenerateError } from '../errors/paintingGenerateError'
import type { ComposerDraft } from '../model/composerDraft'
import { draftToCreateDto, draftToInflightCard, draftToUpdateDto } from '../model/mappers/draftToDto'
import {
  abortPaintingGeneration,
  clearPaintingAbortController,
  registerPaintingAbortController
} from '../model/paintingAbortControllerStore'
import { paintingGenerate } from '../model/paintingPipeline'
import type { PaintingData } from '../model/types/paintingData'
import { type PaintingGenerationState, paintingGenerationStateToCache } from '../model/utils/paintingGenerationParams'
import { usePaintingProviderRuntime } from './usePaintingProviderRuntime'

interface UsePaintingGenerationInput {
  draft: ComposerDraft
}

/**
 * Runs a generation from the composer's `draft` and produces a painting card —
 * the draft itself is never a record. `draft.targetCardId` decides the path:
 * undefined → `createPainting` (fork a new card); set → `updatePainting` (retry
 * the same card in place). While it runs, `inflightCard` exposes a transient
 * `PaintingData` (status `generating`) so the canvas can show a spinner node
 * optimistically until `refresh()` surfaces the persisted record.
 */
export function usePaintingGeneration({ draft }: UsePaintingGenerationInput) {
  const { createPainting, updatePainting, refresh } = usePaintings()
  const { provider } = usePaintingProviderRuntime(draft.providerId)
  const [inflightCard, setInflightCard] = useState<PaintingData | null>(null)

  const generate = useCallback(async () => {
    const cardId = draft.targetCardId ?? uuid()
    const shouldCreate = !draft.targetCardId
    const inflight = draftToInflightCard(draft, cardId)
    setInflightCard(inflight)

    try {
      if (shouldCreate) {
        await createPainting(draftToCreateDto(draft, cardId))
      } else {
        await updatePainting(cardId, draftToUpdateDto(draft))
      }
    } catch (error) {
      presentPaintingGenerateError(error)
      setInflightCard(null)
      return
    }

    const cacheKey = `painting.generation.${cardId}` as const
    const controller = new AbortController()
    const runningState: PaintingGenerationState = {
      generationStatus: 'running',
      generationTaskId: null,
      generationError: null,
      generationProgress: 0
    }
    // Cache mirror keyed by the card id (not the draft) — lets a navigated-away
    // generation finish and the spinner rehydrate when the user returns.
    cacheService.set(cacheKey, paintingGenerationStateToCache(runningState))
    registerPaintingAbortController(cardId, controller)

    try {
      const generatedFiles = await paintingGenerate({
        painting: inflight,
        provider,
        tab: 'default',
        abortController: controller
      })
      await updatePainting(cardId, {
        files: {
          output: generatedFiles.map((file) => file.id),
          input: draft.inputFiles.map((entry) => entry.id)
        },
        status: 'succeeded'
      })
      cacheService.set(cacheKey, null)
    } catch (error) {
      const isCanceled = controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')
      const status = isCanceled ? 'canceled' : 'failed'
      cacheService.set(
        cacheKey,
        paintingGenerationStateToCache({
          ...runningState,
          generationStatus: status,
          generationError: isCanceled ? null : error instanceof Error ? error.message : String(error)
        })
      )
      // Persist the terminal status so a reloaded card reads as failed/canceled
      // (offers retry) instead of an indistinguishable empty board. Best-effort.
      await updatePainting(cardId, { status }).catch(() => {})
      if (!isCanceled) {
        presentPaintingGenerateError(error)
      }
    } finally {
      clearPaintingAbortController(cardId, controller)
      setInflightCard(null)
      await refresh()
    }
  }, [createPainting, draft, provider, refresh, updatePainting])

  const cancel = useCallback((paintingId: string) => {
    abortPaintingGeneration(paintingId)
  }, [])

  return { generate, cancel, inflightCard }
}
