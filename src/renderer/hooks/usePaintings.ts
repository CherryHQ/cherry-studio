import { useMutation, useQuery } from '@data/hooks/useDataApi'
import { useReorder } from '@renderer/data/hooks/useReorder'
import type { CreatePaintingDto, ListPaintingsQueryParams, UpdatePaintingDto } from '@shared/data/api/schemas/paintings'
import type { Painting } from '@shared/data/types/painting'
import { isUndefined, omitBy } from 'lodash'
import { useCallback } from 'react'

export function usePaintings(query?: ListPaintingsQueryParams) {
  const filtered = query ? (omitBy(query, isUndefined) as ListPaintingsQueryParams) : undefined
  const hasQuery = filtered && Object.keys(filtered).length > 0
  const { data, isLoading, refetch } = useQuery('/paintings', hasQuery ? { query: filtered } : undefined)
  const { trigger: createTrigger } = useMutation('POST', '/paintings', { refresh: ['/paintings'] })
  const { trigger: updateTrigger } = useMutation('PATCH', '/paintings/:id', { refresh: ['/paintings'] })
  const { trigger: deleteTrigger } = useMutation('DELETE', '/paintings/:id', { refresh: ['/paintings'] })
  const { applyReorderedList } = useReorder('/paintings')

  const createPainting = useCallback(
    (painting: CreatePaintingDto) => {
      return createTrigger({ body: painting })
    },
    [createTrigger]
  )

  const updatePainting = useCallback(
    (id: string, updates: UpdatePaintingDto) => {
      return updateTrigger({ params: { id }, body: updates })
    },
    [updateTrigger]
  )

  const deletePainting = useCallback(
    (id: string) => {
      return deleteTrigger({ params: { id } })
    },
    [deleteTrigger]
  )

  const reorderPaintings = useCallback(
    (paintings: Painting[]) => {
      return applyReorderedList(paintings as unknown as Array<Record<string, unknown>>)
    },
    [applyReorderedList]
  )

  return {
    records: data?.items ?? [],
    total: data?.total ?? 0,
    isLoading,
    refresh: refetch,
    createPainting,
    updatePainting,
    deletePainting,
    reorderPaintings
  }
}
