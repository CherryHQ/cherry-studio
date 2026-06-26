import { cacheService } from '@data/CacheService'
import { usePaintings } from '@renderer/hooks/usePaintings'
import { uuid } from '@renderer/utils/uuid'
import { useCallback, useState } from 'react'

import { presentPaintingGenerateError } from '../errors/paintingGenerateError'
import type { ComposerDraft } from '../model/composerDraft'
import {
  draftToCreateDto,
  draftToInflightCard,
  draftToOutputCreateDto,
  draftToUpdateDto
} from '../model/mappers/draftToDto'
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

/** Requested image count from the draft params (`numImages`), clamped to 1..16. */
function requestedImageCount(params: Record<string, unknown> | undefined): number {
  const raw = Number(params?.numImages)
  if (!Number.isFinite(raw) || raw < 1) return 1
  return Math.min(Math.floor(raw), 16)
}

/**
 * Runs a generation from the composer's `draft` and produces painting cards —
 * the draft itself is never a record. Nothing is persisted until the run reaches
 * a terminal outcome (so an interrupted run leaves no ghost). While it runs,
 * `inflightCards` exposes N transient `PaintingData` placeholders (status
 * `generating`, sharing a `groupId` when N>1) so the canvas shows N spinner
 * nodes inside a hull immediately. On success they become N real records sharing
 * the same ids + groupId (no flicker); `draft.targetCardId` makes the first card
 * a retry-in-place of an existing record instead of a fresh create.
 */
export function usePaintingGeneration({ draft }: UsePaintingGenerationInput) {
  const { createPainting, updatePainting, refresh } = usePaintings()
  const { provider } = usePaintingProviderRuntime(draft.providerId)
  const [inflightCards, setInflightCards] = useState<PaintingData[]>([])

  const generate = useCallback(async () => {
    const requested = requestedImageCount(draft.params)
    const targetCardId = draft.targetCardId
    const primaryId = targetCardId ?? uuid()
    // Pre-allocate ids + a group tag so the placeholders and the final records
    // share identity (the spinner node becomes the image node in place).
    const groupId = requested > 1 ? uuid() : undefined
    const ids = [primaryId, ...Array.from({ length: requested - 1 }, () => uuid())]
    const inputIds = draft.inputFiles.map((entry) => entry.id)
    setInflightCards(ids.map((id) => ({ ...draftToInflightCard(draft, id), groupId: groupId ?? null })))

    const cacheKey = `painting.generation.${primaryId}` as const
    const controller = new AbortController()
    const runningState: PaintingGenerationState = {
      generationStatus: 'running',
      generationTaskId: null,
      generationError: null,
      generationProgress: 0
    }
    // Cache mirror keyed by the primary id — lets a navigated-away generation
    // finish and the spinner rehydrate when the user returns.
    cacheService.set(cacheKey, paintingGenerationStateToCache(runningState))
    registerPaintingAbortController(primaryId, controller)

    try {
      const generatedFiles = await paintingGenerate({
        painting: draftToInflightCard(draft, primaryId),
        provider,
        tab: 'default',
        abortController: controller
      })
      // Each generated image becomes its own painting record. They share a
      // `groupId` only when more than one came back. Reuse the pre-allocated ids
      // (so placeholder → record is in place); the first card retries in place
      // when the draft targets an existing record.
      const realGroupId = generatedFiles.length > 1 ? (groupId ?? uuid()) : undefined
      for (let index = 0; index < generatedFiles.length; index++) {
        const fileId = generatedFiles[index].id
        if (index === 0 && targetCardId) {
          await updatePainting(targetCardId, {
            ...draftToUpdateDto(draft),
            files: { output: [fileId], input: inputIds },
            status: 'succeeded',
            groupId: realGroupId
          })
        } else {
          const id = index < ids.length ? ids[index] : uuid()
          await createPainting(draftToOutputCreateDto(draft, id, fileId, realGroupId))
        }
      }
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
      // Persist a single terminal record so a reloaded run reads as failed/canceled
      // (offers retry) instead of vanishing. Best-effort.
      if (targetCardId) {
        await updatePainting(targetCardId, { status }).catch(() => {})
      } else {
        await createPainting({ ...draftToCreateDto(draft, primaryId), status }).catch(() => {})
      }
      if (!isCanceled) {
        presentPaintingGenerateError(error)
      }
    } finally {
      clearPaintingAbortController(primaryId, controller)
      // Refresh first so the real records are in `items` before the placeholders
      // are dropped — the cards keep their identity + cluster slots (no flicker /
      // overlap). Clear even if the refetch rejects.
      try {
        await refresh()
      } finally {
        setInflightCards([])
      }
    }
  }, [createPainting, draft, provider, refresh, updatePainting])

  const cancel = useCallback((paintingId: string) => {
    abortPaintingGeneration(paintingId)
  }, [])

  return { generate, cancel, inflightCards }
}
