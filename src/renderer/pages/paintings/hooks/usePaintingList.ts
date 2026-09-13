import { omit } from 'es-toolkit'
import { useCallback, useRef, useState } from 'react'

import { loggerService } from '@logger'
import { usePaintings } from '@renderer/hooks/usePaintings'

import { presentPaintingGenerateError } from '../errors/paintingGenerateError'
import { paintingDataToUpdateDto } from '../model/mappers/paintingDataToUpdateDto'
import { createDefaultPainting, type PaintingDraftDefaults } from '../model/paintingPipeline'
import type { PaintingData } from '../model/types/paintingData'

const logger = loggerService.withContext('paintings/usePaintingList')

interface UsePaintingListInput {
  painting: PaintingData
  setCurrentPainting: (painting: PaintingData) => void
  draftDefaults: PaintingDraftDefaults
  historyItems: PaintingData[]
  cancelGeneration: (paintingId: string) => void
}

/**
 * Owns the painting list-item write-side lifecycle: add / remove.
 *
 * - `add()` saves the current edits, then seeds a fresh draft. The draft is NOT
 *   persisted — like the page's mount-time draft, it only reaches DataApi when
 *   the user generates (`usePaintingGeneration` creates the row for an unsaved
 *   draft). This keeps blank paintings from piling up in the strip on every click.
 * - `remove(painting)` cancels any in-flight generation, deletes attached files,
 *   removes the DB record, and (if the deleted item is the current one) selects
 *   the next available painting or falls back to a fresh draft without saving the deleted record.
 *
 * Selection saves the current record before opening the target.
 */
export function usePaintingList({
  painting,
  setCurrentPainting,
  draftDefaults,
  historyItems,
  cancelGeneration
}: UsePaintingListInput) {
  const { updatePainting, deletePainting, refresh } = usePaintings()
  const historyItemsRef = useRef<PaintingData[]>([])
  const paintingRef = useRef(painting)
  const savingRef = useRef(false)
  const [saving, setSaving] = useState(false)
  historyItemsRef.current = historyItems
  paintingRef.current = painting

  const saveCurrent = useCallback(async () => {
    const current = paintingRef.current
    if (!current.persistedAt) {
      return true
    }

    try {
      await updatePainting(current.id, omit(paintingDataToUpdateDto(current), ['files']))
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

  const resetDraft = useCallback(() => {
    setCurrentPainting(createDefaultPainting(draftDefaults))
  }, [draftDefaults, setCurrentPainting])

  const add = useCallback(async () => {
    if (savingRef.current) return
    savingRef.current = true
    setSaving(true)
    try {
      if (await saveCurrent()) resetDraft()
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }, [resetDraft, saveCurrent])

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
      resetDraft()
    },
    [resetDraft, refresh, setCurrentPainting]
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

  return { add, remove, select, saveCurrent, saving }
}
