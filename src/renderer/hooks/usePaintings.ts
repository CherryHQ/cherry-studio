import { useCreations } from '@renderer/hooks/useCreations'
import type { CreatePaintingDto, ListPaintingsQueryParams, UpdatePaintingDto } from '@shared/data/api/schemas/paintings'
import type { Painting } from '@shared/data/types/painting'
import { useCallback } from 'react'

/**
 * TRANSITION SHIM — paintings are `creation` rows with `kind: 'image'`. This wraps
 * the unified `useCreations('image', …)` so the legacy paintings page keeps its API.
 * Removed when the page becomes the unified Creation page (Phase 5).
 */
export function usePaintings(query?: ListPaintingsQueryParams) {
  const { records, total, isLoading, refresh, createCreation, updateCreation, deleteCreation, reorderCreations } =
    useCreations('image', query)

  const createPainting = useCallback((painting: CreatePaintingDto) => createCreation(painting), [createCreation])
  const updatePainting = useCallback(
    (id: string, updates: UpdatePaintingDto) => updateCreation(id, updates),
    [updateCreation]
  )
  const deletePainting = useCallback((id: string) => deleteCreation(id), [deleteCreation])
  const reorderPaintings = useCallback((paintings: Painting[]) => reorderCreations(paintings), [reorderCreations])

  return {
    records,
    total,
    isLoading,
    refresh,
    createPainting,
    updatePainting,
    deletePainting,
    reorderPaintings
  }
}
