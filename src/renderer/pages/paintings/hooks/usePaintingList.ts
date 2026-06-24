import { loggerService } from '@logger'
import { usePaintings } from '@renderer/hooks/usePaintings'
import { useCallback, useRef } from 'react'

import { presentPaintingGenerateError } from '../errors/paintingGenerateError'
import { paintingDataToUpdateDto } from '../model/mappers/paintingDataToUpdateDto'
import { createDefaultPainting } from '../model/paintingPipeline'
import type { PaintingData } from '../model/types/paintingData'
import type { ModelOption } from '../model/types/paintingModel'

const logger = loggerService.withContext('paintings/usePaintingList')

interface UsePaintingListInput {
  painting: PaintingData
  setCurrentPainting: (painting: PaintingData) => void
  currentProviderId: string
  modelOptions: ModelOption[]
  historyItems: PaintingData[]
  cancelGeneration: (paintingId: string) => void
}

/**
 * Owns the painting list-item write-side lifecycle: add / remove.
 *
 * - `add()` seeds a fresh in-memory draft on the current provider. It is NOT
 *   persisted — like the page's mount-time draft, it only reaches DataApi when
 *   the user generates (`usePaintingGeneration` creates the row for an unsaved
 *   draft). This keeps blank paintings from piling up in the strip on every click.
 * - `remove(painting)` cancels any in-flight generation, deletes attached files,
 *   removes the DB record, and (if the deleted item is the current one) selects
 *   the next available painting or falls back to a fresh draft via `add()`.
 *
 * Selection (`setCurrentPainting`) is a trivial setter passthrough and is wired
 * directly at the call site instead of being re-exposed here.
 */
export function usePaintingList({
  painting,
  setCurrentPainting,
  currentProviderId,
  modelOptions,
  historyItems,
  cancelGeneration
}: UsePaintingListInput) {
  const { updatePainting, deletePainting, refresh } = usePaintings()
  const modelOptionsRef = useRef<ModelOption[]>([])
  const historyItemsRef = useRef<PaintingData[]>([])
  const paintingRef = useRef(painting)
  modelOptionsRef.current = modelOptions
  historyItemsRef.current = historyItems
  paintingRef.current = painting

  const saveCurrent = useCallback(async () => {
    const current = paintingRef.current
    if (!current.persistedAt) {
      return true
    }

    try {
      await updatePainting(current.id, paintingDataToUpdateDto(current))
      return true
    } catch (error) {
      presentPaintingGenerateError(error)
      return false
    }
  }, [updatePainting])

  const select = useCallback(
    async (target: PaintingData) => {
      const current = paintingRef.current
      if (target.id === current.id) return
      if (!(await saveCurrent())) return
      setCurrentPainting(target)
    },
    [saveCurrent, setCurrentPainting]
  )

  const add = useCallback(() => {
    setCurrentPainting(createDefaultPainting(currentProviderId))
  }, [currentProviderId, setCurrentPainting])

  const selectNextAfterDelete = useCallback(
    async (deletedId: string) => {
      const currentItems = historyItemsRef.current
      const deletedIndex = currentItems.findIndex((item) => item.id === deletedId)
      const nextPainting =
        deletedIndex >= 0
          ? (currentItems[deletedIndex + 1] ?? currentItems[deletedIndex - 1])
          : currentItems.find((item) => item.id !== deletedId)

      await refresh()

      if (nextPainting) {
        setCurrentPainting(nextPainting)
        return
      }
      await add()
    },
    [add, refresh, setCurrentPainting]
  )

  const remove = useCallback(
    async (target: PaintingData) => {
      cancelGeneration(target.id)
      try {
        await deletePainting(target.id)
      } catch (error) {
        // A rejected DELETE (SQLITE_BUSY / FK / IPC) must surface like the
        // sibling write paths — otherwise the row silently reappears on the
        // next refresh with no toast or log.
        logger.error('Failed to delete painting', error as Error)
        presentPaintingGenerateError(error)
        return
      }
      if (target.id === painting.id) {
        await selectNextAfterDelete(target.id)
      } else {
        await refresh()
      }
    },
    [cancelGeneration, deletePainting, painting.id, refresh, selectNextAfterDelete]
  )

  return { add, remove, select, saveCurrent }
}
