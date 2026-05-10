import { usePaintings } from '@renderer/hooks/usePaintings'
import FileManager from '@renderer/services/FileManager'
import type { PaintingMode } from '@shared/data/types/painting'
import { useCallback, useRef } from 'react'

import { paintingDataToCreateDto } from '../model/mappers/paintingDataToCreateDto'
import { recordToPaintingData } from '../model/mappers/recordToPaintingData'
import { presentPaintingGenerateError } from '../model/paintingGenerateError'
import type { PaintingData } from '../model/types/paintingData'
import type { ModelOption } from '../model/types/paintingModel'
import type { PaintingProviderDefinition } from '../providers/shared/provider'
import { resolvePaintingTabForMode } from '../utils/paintingProviderMode'

interface UsePaintingListInput {
  painting: PaintingData
  setCurrentPainting: (painting: PaintingData) => void
  currentProviderDefinition: PaintingProviderDefinition
  modelOptions: ModelOption[]
  cancelGeneration: (paintingId: string) => void
}

/**
 * Owns the painting list-item write-side lifecycle: add / remove.
 *
 * - `add()` seeds a fresh draft using the current provider definition (and the
 *   latest model options if any), then persists it via DataApi.
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
  currentProviderDefinition,
  modelOptions,
  cancelGeneration
}: UsePaintingListInput) {
  const { createPainting, deletePainting, refresh } = usePaintings()
  const modelOptionsRef = useRef<ModelOption[]>([])
  modelOptionsRef.current = modelOptions

  const add = useCallback(async () => {
    const nextTab =
      resolvePaintingTabForMode(currentProviderDefinition, painting.mode) ?? currentProviderDefinition.mode.defaultTab
    const nextPainting = currentProviderDefinition.mode.createPaintingData({
      tab: nextTab,
      modelOptions: modelOptionsRef.current.length > 0 ? modelOptionsRef.current : undefined
    })
    setCurrentPainting(nextPainting)

    try {
      const createdRecord = await createPainting(
        paintingDataToCreateDto(nextPainting as PaintingData & { providerId: string; mode: PaintingMode })
      )
      setCurrentPainting(await recordToPaintingData(createdRecord))
      await refresh()
    } catch (error) {
      presentPaintingGenerateError(error)
    }
  }, [createPainting, currentProviderDefinition, painting.mode, refresh, setCurrentPainting])

  const selectNextAfterDelete = useCallback(
    async (deletedId: string) => {
      const response = (await refresh()) as { items?: Parameters<typeof recordToPaintingData>[0][] } | undefined
      const nextRecord = response?.items?.find((item) => item.id !== deletedId)
      if (nextRecord) {
        setCurrentPainting(await recordToPaintingData(nextRecord))
        return
      }
      await add()
    },
    [add, refresh, setCurrentPainting]
  )

  const remove = useCallback(
    async (target: PaintingData) => {
      cancelGeneration(target.id)
      await deletePainting(target.id)
      await FileManager.deleteFiles([...(target.files ?? []), ...(target.inputFiles ?? [])])
      if (target.id === painting.id) {
        await selectNextAfterDelete(target.id)
      } else {
        await refresh()
      }
    },
    [cancelGeneration, deletePainting, painting.id, refresh, selectNextAfterDelete]
  )

  return { add, remove }
}
