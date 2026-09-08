import { dataApiService } from '@data/DataApiService'
import { loggerService } from '@logger'
import { usePaintings } from '@renderer/hooks/usePaintings'
import { isDataApiNotFoundError } from '@shared/data/api/errors'
import { omit } from 'es-toolkit'
import { useCallback, useRef } from 'react'

import { presentPaintingGenerateError } from '../errors/paintingGenerateError'
import { paintingDataToUpdateDto } from '../model/mappers/paintingDataToUpdateDto'
import { recordToPaintingData } from '../model/mappers/recordToPaintingData'
import { createDefaultPainting, type PaintingDraftDefaults } from '../model/paintingPipeline'
import type { PaintingData } from '../model/types/paintingData'
import type { usePaintingSession } from './usePaintingSession'

const logger = loggerService.withContext('paintings/usePaintingList')

interface UsePaintingListInput {
  setCurrentPainting: (painting: PaintingData) => void
  draftDefaults: PaintingDraftDefaults
  historyItems: PaintingData[]
  cancelGeneration: (paintingId: string) => void
  captureSession: ReturnType<typeof usePaintingSession>['capture']
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
  setCurrentPainting,
  draftDefaults,
  historyItems,
  cancelGeneration,
  beginTransition,
  captureSession
}: UsePaintingListInput) {
  const { updatePainting, deletePainting, refresh } = usePaintings()
  const historyItemsRef = useRef<PaintingData[]>([])
  const deletingIds = useRef(new Set<string>())
  const deletionRevision = useRef(0)
  const pendingNavigation = useRef<{ targetId?: string; canceled: boolean; isCurrent: () => boolean } | null>(null)
  historyItemsRef.current = historyItems

  const saveCurrent = useCallback(
    (session = captureSession()) =>
      session.write(async () => {
        const current = session.getPainting()
        if (!current.persistedAt || session.isDeleted()) return true
        try {
          await updatePainting(current.id, omit(paintingDataToUpdateDto(current), ['files']))
          return true
        } catch (error) {
          presentPaintingGenerateError(error)
          return false
        }
      }),
    [captureSession, updatePainting]
  )

  const readTarget = useCallback(async (id: string): Promise<PaintingData | undefined> => {
    // Hydrated history is a display cache. Confirm membership from the record API.
    for (;;) {
      const version = deletionRevision.current
      if (deletingIds.current.has(id)) return
      try {
        const record = await dataApiService.get(`/paintings/${encodeURIComponent(id)}`)
        const target = await recordToPaintingData(record)
        if (version !== deletionRevision.current) continue
        return target
      } catch (error) {
        if (isDataApiNotFoundError(error)) return
        throw error
      }
    }
  }, [])

  const saveAndReplace = useCallback(
    async (
      intent: ReturnType<UsePaintingListInput['beginTransition']>,
      next: () => PaintingData | undefined | Promise<PaintingData | undefined>,
      targetId?: string
    ) => {
      const navigation = { targetId, canceled: false, isCurrent: intent.isCurrent }
      pendingNavigation.current = navigation
      try {
        if (!(await saveCurrent(intent)) || !intent.isCurrent() || navigation.canceled) return
        const target = await next()
        if (!intent.isCurrent() || navigation.canceled) return
        if (target) setCurrentPainting(target)
      } catch (error) {
        presentPaintingGenerateError(error)
      } finally {
        if (pendingNavigation.current === navigation) pendingNavigation.current = null
        const pending = pendingNavigation.current
        if (intent.isSameSession() && intent.isDeleted() && !(pending && !pending.canceled && pending.isCurrent())) {
          setCurrentPainting(createDefaultPainting(draftDefaults))
        }
      }
    },
    [draftDefaults, saveCurrent, setCurrentPainting]
  )

  const select = useCallback(
    async (target: PaintingData) => {
      const intent = beginTransition()
      if (target.id === intent.getPainting().id || deletingIds.current.has(target.id)) return
      await saveAndReplace(intent, () => readTarget(target.id), target.id)
    },
    [beginTransition, readTarget, saveAndReplace]
  )

  const add = useCallback(async () => {
    const intent = beginTransition()
    await saveAndReplace(intent, () => createDefaultPainting(draftDefaults))
  }, [beginTransition, draftDefaults, saveAndReplace])

  const selectNextAfterDelete = useCallback(
    async (deletedId: string, migratedId?: string) => {
      const items = historyItemsRef.current
      const index = items.findIndex((item) => item.id === deletedId)
      const candidates = index >= 0 ? [...items.slice(index + 1), ...items.slice(0, index).reverse()] : items
      for (const item of candidates) {
        if (item.id === deletedId || item.id === migratedId) continue
        const target = await readTarget(item.id)
        if (target) return target
      }
      return createDefaultPainting(draftDefaults)
    },
    [draftDefaults, readTarget]
  )

  const remove = useCallback(
    async (target: PaintingData) => {
      if (deletingIds.current.has(target.id)) return
      deletingIds.current.add(target.id)
      deletionRevision.current++
      if (pendingNavigation.current?.targetId === target.id) pendingNavigation.current.canceled = true
      const deletion = target.id === captureSession().getPainting().id ? beginTransition() : undefined
      try {
        const performDelete = async () => {
          cancelGeneration(target.id)
          await deletePainting(target.id)
          deletion?.markDeleted(target.id)
        }
        if (deletion) await deletion.write(performDelete)
        else await performDelete()
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
      const shouldLeave = () => {
        const navigation = pendingNavigation.current
        return deletion?.isSameSession() && !(navigation && !navigation.canceled && navigation.isCurrent())
      }
      if (deletion && shouldLeave()) {
        const currentId = deletion.getPainting().id
        try {
          const next = await selectNextAfterDelete(target.id, currentId !== target.id ? currentId : undefined)
          if (shouldLeave()) setCurrentPainting(next)
        } catch (error) {
          presentPaintingGenerateError(error)
          if (shouldLeave()) setCurrentPainting(createDefaultPainting(draftDefaults))
        }
      }
      await refresh()
    },
    [
      beginTransition,
      captureSession,
      cancelGeneration,
      deletePainting,
      refresh,
      selectNextAfterDelete,
      draftDefaults,
      setCurrentPainting
    ]
  )

  return { add, remove, select, saveCurrent }
}
