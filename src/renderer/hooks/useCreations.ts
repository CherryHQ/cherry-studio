import { useMutation, useQuery } from '@data/hooks/useDataApi'
import { useReorder } from '@renderer/data/hooks/useReorder'
import type { CreateCreationDto, ListCreationsQueryParams, UpdateCreationDto } from '@shared/data/api/schemas/creations'
import type { Creation, CreationKind } from '@shared/data/types/creation'
import { isUndefined, omitBy } from 'lodash'
import { useCallback } from 'react'

/**
 * Unified hook for generation receipts (image + video) backed by the `/creations`
 * DataApi. `kind` scopes the list + is stamped onto created rows, so the Creation
 * page's Image / Video tabs each call `useCreations('image' | 'video')`.
 */
export function useCreations(kind: CreationKind, query?: Omit<ListCreationsQueryParams, 'kind'>) {
  const merged = { kind, ...(query ? omitBy(query, isUndefined) : {}) } as ListCreationsQueryParams
  const { data, isLoading, refetch } = useQuery('/creations', { query: merged })
  const { trigger: createTrigger } = useMutation('POST', '/creations', { refresh: ['/creations'] })
  const { trigger: updateTrigger } = useMutation('PATCH', '/creations/:id', { refresh: ['/creations'] })
  const { trigger: deleteTrigger } = useMutation('DELETE', '/creations/:id', { refresh: ['/creations'] })
  const { applyReorderedList } = useReorder('/creations')

  const createCreation = useCallback(
    (creation: Omit<CreateCreationDto, 'kind'>) => {
      return createTrigger({ body: { ...creation, kind } })
    },
    [createTrigger, kind]
  )

  const updateCreation = useCallback(
    (id: string, updates: UpdateCreationDto) => {
      return updateTrigger({ params: { id }, body: updates })
    },
    [updateTrigger]
  )

  const deleteCreation = useCallback(
    (id: string) => {
      return deleteTrigger({ params: { id } })
    },
    [deleteTrigger]
  )

  const reorderCreations = useCallback(
    (creations: Creation[]) => {
      return applyReorderedList(creations as unknown as Array<Record<string, unknown>>)
    },
    [applyReorderedList]
  )

  return {
    records: data?.items ?? [],
    total: data?.total ?? 0,
    isLoading,
    refresh: refetch,
    createCreation,
    updateCreation,
    deleteCreation,
    reorderCreations
  }
}
