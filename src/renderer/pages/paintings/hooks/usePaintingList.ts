import { loggerService } from '@logger'
import { usePaintings } from '@renderer/hooks/usePaintings'
import { omit } from 'es-toolkit'
import { useCallback, useRef } from 'react'

import { presentPaintingGenerateError } from '../errors/paintingGenerateError'
import { paintingDataToUpdateDto } from '../model/mappers/paintingDataToUpdateDto'
import { createDefaultPainting, type PaintingDraftDefaults } from '../model/paintingPipeline'
import type { PaintingData } from '../model/types/paintingData'
import type { usePaintingSession } from './usePaintingSession'

const logger = loggerService.withContext('paintings/usePaintingList')

interface UsePaintingListInput {
  painting: PaintingData
  setCurrentPainting: (painting: PaintingData) => void
  draftDefaults: PaintingDraftDefaults
  historyItems: PaintingData[]
  cancelGeneration: (paintingId: string) => void
  beginTransition: ReturnType<typeof usePaintingSession>['beginTransition']
}

/**
 * Owns the painting list-item write-side lifecycle: add / select / remove.
 *
 * - `add()` saves the current record before seeding a fresh draft. The draft is NOT
 *   persisted — like the page's mount-time draft, it only reaches DataApi when
 *   the user generates (`usePaintingGeneration` creates the row for an unsaved
 *   draft). This keeps blank paintings from piling up in the strip on every click.
 * - `remove(painting)` cancels any in-flight generation, deletes attached files,
 *   removes the DB record, and (if the deleted item is the current one) selects
 *   the next available painting or falls back to a fresh draft.
 *
 * Selection saves the current record before switching to the target.
 */
export function usePaintingList({
  painting,
  setCurrentPainting,
  draftDefaults,
  historyItems,
  cancelGeneration,
  beginTransition
}: UsePaintingListInput) {
  const { updatePainting, deletePainting, refresh } = usePaintings()
  const historyItemsRef = useRef<PaintingData[]>([])
  const paintingRef = useRef(painting)
  const deletingIds = useRef(new Set<string>())
  const pendingNavigation = useRef<{ targetId?: string; canceled: boolean; isCurrent: () => boolean } | null>(null)
  historyItemsRef.current = historyItems
  paintingRef.current = painting

  const saveCurrent = useCallback(
    async (current = paintingRef.current) => {
      // Delete is an explicit discard. Its mutation also awaits cache refresh,
      // so navigation must not PATCH this identity while deletion is pending.
      if (!current.persistedAt || deletingIds.current.has(current.id)) {
        return true
      }

      try {
        await updatePainting(current.id, omit(paintingDataToUpdateDto(current), ['files']))
        return true
      } catch (error) {
        presentPaintingGenerateError(error)
        return false
      }
    },
    [updatePainting]
  )

  const saveAndReplace = useCallback(
    async (
      intent: ReturnType<UsePaintingListInput['beginTransition']>,
      next: () => PaintingData,
      targetId?: string
    ) => {
      const navigation = { targetId, canceled: false, isCurrent: intent.isCurrent }
      pendingNavigation.current = navigation
      try {
        // Generation can migrate this session while a save waits. Save its
        // editable fields on the new record before honoring the navigation.
        let savedId: string
        do {
          const current = intent.getPainting()
          if (!(await saveCurrent(current)) || !intent.isCurrent() || navigation.canceled) return
          savedId = current.id
        } while (intent.getPainting().id !== savedId)
        setCurrentPainting(next())
      } finally {
        if (pendingNavigation.current === navigation) pendingNavigation.current = null
      }
    },
    [saveCurrent, setCurrentPainting]
  )

  const select = useCallback(
    async (target: PaintingData) => {
      const intent = beginTransition()
      if (target.id === intent.getPainting().id || deletingIds.current.has(target.id)) return
      await saveAndReplace(intent, () => target, target.id)
    },
    [beginTransition, saveAndReplace]
  )

  const add = useCallback(async () => {
    const intent = beginTransition()
    await saveAndReplace(intent, () => createDefaultPainting(draftDefaults))
  }, [beginTransition, draftDefaults, saveAndReplace])

  const selectNextAfterDelete = useCallback(
    (deletedId: string, migratedId?: string) => {
      const currentItems = historyItemsRef.current.filter(
        (item) => item.id !== migratedId && !deletingIds.current.has(item.id)
      )
      const deletedIndex = currentItems.findIndex((item) => item.id === deletedId)
      const nextPainting =
        deletedIndex >= 0
          ? (currentItems[deletedIndex + 1] ?? currentItems[deletedIndex - 1])
          : currentItems.find((item) => item.id !== deletedId)

      if (nextPainting) {
        setCurrentPainting(nextPainting)
        return
      }
      setCurrentPainting(createDefaultPainting(draftDefaults))
    },
    [draftDefaults, setCurrentPainting]
  )

  const remove = useCallback(
    async (target: PaintingData) => {
      if (deletingIds.current.has(target.id)) return
      deletingIds.current.add(target.id)
      if (pendingNavigation.current?.targetId === target.id) pendingNavigation.current.canceled = true
      const deletion = target.id === paintingRef.current.id ? beginTransition() : undefined
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
      } finally {
        deletingIds.current.delete(target.id)
      }
      // Detach from the deleted record before awaiting the history refresh:
      // navigation must never try to save a record already confirmed deleted.
      const navigation = pendingNavigation.current
      const hasNewerNavigation = navigation && !navigation.canceled && navigation.isCurrent()
      if (deletion?.isSameSession() && !hasNewerNavigation) {
        const currentId = deletion.getPainting().id
        selectNextAfterDelete(target.id, currentId !== target.id ? currentId : undefined)
      }
      await refresh()
    },
    [beginTransition, cancelGeneration, deletePainting, refresh, selectNextAfterDelete]
  )

  return { add, remove, select, saveCurrent }
}
