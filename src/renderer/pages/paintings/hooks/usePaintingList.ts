import { loggerService } from '@logger'
import { usePaintings } from '@renderer/hooks/usePaintings'
import { useCallback } from 'react'

import { presentPaintingGenerateError } from '../errors/paintingGenerateError'
import type { PaintingData } from '../model/types/paintingData'

const logger = loggerService.withContext('paintings/usePaintingList')

interface UsePaintingListInput {
  cancelGeneration: (paintingId: string) => void
}

/**
 * Card lifecycle on the canvas: delete, and persist board placement / size.
 * Cards are created by the generation pipeline (not here); the composer draft is
 * a separate, never-persisted concern. So there is no add/select/save — selecting
 * a card is page-level (`selectedId`), and a draft only hits the DB on generate.
 */
export function usePaintingList({ cancelGeneration }: UsePaintingListInput) {
  const { updatePainting, deletePainting, refresh } = usePaintings()

  const move = useCallback(
    async (id: string, x: number, y: number) => {
      try {
        await updatePainting(id, { canvasX: x, canvasY: y })
      } catch (error) {
        // A failed position write is non-fatal — the node holds this session, not across reload.
        logger.error('Failed to persist painting position', error as Error)
      }
    },
    [updatePainting]
  )

  const resize = useCallback(
    async (id: string, width: number) => {
      try {
        await updatePainting(id, { canvasW: width })
      } catch (error) {
        logger.error('Failed to persist painting size', error as Error)
      }
    },
    [updatePainting]
  )

  const remove = useCallback(
    async (target: PaintingData) => {
      cancelGeneration(target.id)
      try {
        await deletePainting(target.id)
      } catch (error) {
        logger.error('Failed to delete painting', error as Error)
        presentPaintingGenerateError(error)
        return
      }
      await refresh()
    },
    [cancelGeneration, deletePainting, refresh]
  )

  return { remove, move, resize }
}
