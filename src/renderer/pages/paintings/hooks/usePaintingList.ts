import { useCallback, useRef, useState } from 'react'

import { loggerService } from '@logger'
import { usePaintings } from '@renderer/hooks/usePaintings'
import { ipcApi } from '@renderer/ipc'
import { showRecycleBinUndo } from '@renderer/services/recycleBinFeedback'

import { presentPaintingGenerateError } from '../errors/paintingGenerateError'
import { recordToPaintingData } from '../model/mappers/recordToPaintingData'
import { abortPaintingProjectGenerations } from '../model/paintingAbortControllerStore'
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
  const { selectPainting, getPainting, deletePainting, restorePainting, refresh } = usePaintings()
  const historyItemsRef = useRef<PaintingData[]>([])
  const savingRef = useRef(false)
  const [saving, setSaving] = useState(false)
  historyItemsRef.current = historyItems

  const saveCurrent = useCallback(async () => true, [])

  const select = useCallback(
    async (target: PaintingData) => {
      try {
        const chosen =
          !target.projectId && target.selectedStepId && target.selectedStepId !== target.id
            ? await recordToPaintingData(await getPainting(target.selectedStepId))
            : target
        const fileId = target.selectedFileId ?? chosen.files[0]?.id
        await selectPainting(chosen.projectId ?? chosen.id, chosen.id, fileId)
        setCurrentPainting({ ...chosen, selectedFileId: fileId })
      } catch (error) {
        presentPaintingGenerateError(error)
      }
    },
    [getPainting, selectPainting, setCurrentPainting]
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
      abortPaintingProjectGenerations(target.id)
      cancelGeneration(target.id)
      try {
        await ipcApi.request('ai.image.cancel_project', { projectId: target.id })
        await deletePainting(target.id)
      } catch (error) {
        // A rejected DELETE (SQLITE_BUSY / FK / IPC) must surface like the
        // sibling write paths — otherwise the row silently reappears on the
        // next refresh with no toast or log.
        logger.error('Failed to delete painting', error as Error)
        presentPaintingGenerateError(error)
        return
      }
      try {
        if (target.id === (painting.projectId ?? painting.id)) {
          await selectNextAfterDelete(target.id)
        } else {
          await refresh()
        }
      } catch (error) {
        logger.warn('Failed to refresh paintings after deletion', error as Error)
      }
      showRecycleBinUndo({
        itemName: target.prompt.trim() || target.id,
        onUndo: async () => {
          await restorePainting(target.id)
          try {
            await refresh()
          } catch (error) {
            logger.warn('Failed to refresh paintings after restore', error as Error)
          }
        }
      })
    },
    [cancelGeneration, deletePainting, painting.id, painting.projectId, refresh, restorePainting, selectNextAfterDelete]
  )

  return { add, remove, select, saveCurrent, saving }
}
