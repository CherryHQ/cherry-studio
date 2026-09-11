import { useCallback, useMemo } from 'react'

import { useMutation, useQuery } from '@data/hooks/useDataApi'
import type { OrderRequest } from '@shared/data/api/schemas/_endpointHelpers'
import type { UpdateGroupDto } from '@shared/data/api/schemas/groups'
import type { ConcreteApiPaths } from '@shared/data/api/types'
import type { EntityType } from '@shared/data/types/entityType'
import type { Group } from '@shared/data/types/group'

export function useGroups(entityType: EntityType, options: { enabled?: boolean } = {}) {
  const { data, isLoading, error, refetch } = useQuery('/groups', {
    ...(options.enabled !== undefined && { enabled: options.enabled }),
    query: { entityType }
  })
  const groups = useMemo(() => data ?? [], [data])

  return { groups, isLoading, error, refetch }
}

export function useGroupReorder() {
  const { trigger } = useMutation('PATCH', '/groups/:id/order', { refresh: ['/groups'] })
  const reorderGroup = useCallback(
    (id: string, body: OrderRequest): Promise<void> => trigger({ params: { id }, body }),
    [trigger]
  )

  return { reorderGroup }
}

export interface UseGroupMutationsOptions {
  /** Related resources whose cached groupId may change through ON DELETE SET NULL. */
  refreshOnDelete?: ConcreteApiPaths[]
}

export function useGroupMutations(entityType: EntityType, options: UseGroupMutationsOptions = {}) {
  const {
    trigger: createTrigger,
    isLoading: isCreating,
    error: createError
  } = useMutation('POST', '/groups', {
    refresh: ['/groups']
  })
  const {
    trigger: updateTrigger,
    isLoading: isUpdating,
    error: updateError
  } = useMutation('PATCH', '/groups/:id', {
    refresh: ['/groups']
  })
  const {
    trigger: deleteTrigger,
    isLoading: isDeleting,
    error: deleteError
  } = useMutation('DELETE', '/groups/:id', {
    refresh: ['/groups', ...(options.refreshOnDelete ?? [])]
  })

  const createGroup = useCallback(
    (name: string): Promise<Group> =>
      createTrigger({
        body: { entityType, name: name.trim() }
      }),
    [createTrigger, entityType]
  )
  const updateGroup = useCallback(
    (id: string, updates: UpdateGroupDto): Promise<Group> =>
      updateTrigger({
        params: { id },
        body: updates.name === undefined ? updates : { ...updates, name: updates.name.trim() }
      }),
    [updateTrigger]
  )
  const deleteGroup = useCallback(
    (id: string): Promise<void> => deleteTrigger({ params: { id } }).then(() => undefined),
    [deleteTrigger]
  )

  return {
    createGroup,
    updateGroup,
    deleteGroup,
    isCreating,
    isUpdating,
    isDeleting,
    createError,
    updateError,
    deleteError
  }
}
