import type { UniqueModelId } from '@shared/data/types/model'
import type { Model } from '@shared/data/types/model'
import { useCallback, useEffect, useState } from 'react'

import type { ModelSyncPreviewResponse } from './modelSyncPreviewTypes'

export type ModelPullApplyPayload = {
  toAdd: Model[]
  toRemove: UniqueModelId[]
}

/**
 * Pull-preview selection for model list sync: added rows + missing rows slated for deletion.
 */
export function useModelListSyncSelections(preview: ModelSyncPreviewResponse | null) {
  const [selectedAddedIds, setSelectedAddedIds] = useState<Set<UniqueModelId>>(new Set())
  const [selectedMissingIds, setSelectedMissingIds] = useState<Set<UniqueModelId>>(new Set())

  useEffect(() => {
    if (!preview) {
      setSelectedAddedIds(new Set())
      setSelectedMissingIds(new Set())
      return
    }
    setSelectedAddedIds(new Set(preview.added.map((m) => m.id)))
    setSelectedMissingIds(new Set(preview.missing.map((item) => item.model.id)))
  }, [preview])

  const toggleAddedSelection = useCallback((uniqueModelId: UniqueModelId) => {
    setSelectedAddedIds((current) => {
      const next = new Set(current)
      if (next.has(uniqueModelId)) {
        next.delete(uniqueModelId)
      } else {
        next.add(uniqueModelId)
      }
      return next
    })
  }, [])

  const toggleMissingSelection = useCallback((uniqueModelId: UniqueModelId) => {
    setSelectedMissingIds((current) => {
      const next = new Set(current)
      if (next.has(uniqueModelId)) {
        next.delete(uniqueModelId)
      } else {
        next.add(uniqueModelId)
      }
      return next
    })
  }, [])

  const toggleAllAdded = useCallback(() => {
    if (!preview) {
      return
    }
    setSelectedAddedIds((current) => {
      if (current.size === preview.added.length) {
        return new Set()
      }
      return new Set(preview.added.map((model) => model.id))
    })
  }, [preview])

  const toggleAllMissing = useCallback(() => {
    if (!preview) {
      return
    }
    setSelectedMissingIds((current) => {
      if (current.size === preview.missing.length) {
        return new Set()
      }
      return new Set(preview.missing.map((item) => item.model.id))
    })
  }, [preview])

  const totalSelected = selectedAddedIds.size + selectedMissingIds.size

  const allAddedSelected = !!preview && preview.added.length > 0 && selectedAddedIds.size === preview.added.length
  const allMissingSelected =
    !!preview && preview.missing.length > 0 && selectedMissingIds.size === preview.missing.length

  const getApplyPayload = useCallback((): ModelPullApplyPayload | null => {
    if (!preview) {
      return null
    }
    const toAdd = preview.added.filter((model) => selectedAddedIds.has(model.id))
    const toRemove = preview.missing
      .filter((item) => selectedMissingIds.has(item.model.id))
      .map((item) => item.model.id)
    return { toAdd, toRemove }
  }, [preview, selectedAddedIds, selectedMissingIds])

  return {
    selectedAddedIds,
    selectedMissingIds,
    toggleAddedSelection,
    toggleMissingSelection,
    toggleAllAdded,
    toggleAllMissing,
    totalSelected,
    allAddedSelected,
    allMissingSelected,
    getApplyPayload
  }
}
