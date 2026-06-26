import { loggerService } from '@logger'
import { usePaintings } from '@renderer/hooks/usePaintings'
import { uuid } from '@renderer/utils/uuid'
import { useCallback } from 'react'

import type { CanvasPoint } from '../components/canvas/CanvasToolbar'
import { presentPaintingGenerateError } from '../errors/paintingGenerateError'
import type { PaintingData } from '../model/types/paintingData'

const logger = loggerService.withContext('paintings/usePaintingList')

interface UsePaintingListInput {
  cancelGeneration: (paintingId: string) => void
}

/**
 * Card lifecycle on the canvas: create empty boards / imported assets, delete,
 * and persist board placement / size. Generated cards come from the generation
 * pipeline (not here); the composer draft is a separate, never-persisted
 * concern. Selecting a card is page-level (`selectedId`); a draft only hits the
 * DB on generate.
 */
export function usePaintingList({ cancelGeneration }: UsePaintingListInput) {
  const { createPainting, updatePainting, deletePainting, refresh } = usePaintings()

  // An empty board: no output, no status (= empty board, not a failed run). The
  // page points the composer's draft at it so the next generation fills it.
  const createBoard = useCallback(
    async (providerId: string, position: CanvasPoint): Promise<string | undefined> => {
      const id = uuid()
      try {
        await createPainting({
          id,
          providerId,
          prompt: '',
          files: { output: [], input: [] },
          canvasX: position.x,
          canvasY: position.y
        })
      } catch (error) {
        logger.error('Failed to create blank board', error as Error)
        presentPaintingGenerateError(error)
        return undefined
      }
      await refresh()
      return id
    },
    [createPainting, refresh]
  )

  // An imported image as a source card: it carries the file as output + a
  // `succeeded` status so it renders like any other image and feeds lineage.
  const createAsset = useCallback(
    async (providerId: string, fileId: string, position: CanvasPoint): Promise<string | undefined> => {
      const id = uuid()
      try {
        await createPainting({
          id,
          providerId,
          prompt: '',
          files: { output: [fileId], input: [] },
          status: 'succeeded',
          canvasX: position.x,
          canvasY: position.y
        })
      } catch (error) {
        logger.error('Failed to create asset card', error as Error)
        presentPaintingGenerateError(error)
        return undefined
      }
      await refresh()
      return id
    },
    [createPainting, refresh]
  )

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

  // Detach a card from its multi-image group (clears its group_id). The card
  // keeps its position; the group's hull shrinks to the remaining members.
  const ungroup = useCallback(
    async (id: string) => {
      try {
        await updatePainting(id, { groupId: null })
      } catch (error) {
        logger.error('Failed to ungroup painting', error as Error)
      }
    },
    [updatePainting]
  )

  return { remove, move, resize, createBoard, createAsset, ungroup }
}
