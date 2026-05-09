import { useMutation, useQuery } from '@data/hooks/useDataApi'
import type { ConcreteApiPaths } from '@shared/data/api/apiTypes'
import type { EntityType } from '@shared/data/types/entityType'
import type { Tag } from '@shared/data/types/tag'
import { useCallback, useMemo } from 'react'

const DISABLED_ENTITY_TAGS_PATH = '/tags/entities/assistant/placeholder' as const

export interface UseEntityTagsOptions {
  enabled?: boolean
}

export interface EntityTagsResult {
  tags: Tag[]
  isLoading: boolean
  isRefreshing: boolean
  error?: Error
  refetch: () => Promise<unknown>
}

export interface SyncEntityTagsRefreshContext {
  entityType: EntityType
  entityId: string
  tagIds: string[]
}

export interface UseSyncEntityTagsOptions {
  refreshPaths?: ConcreteApiPaths[]
  getRefreshPaths?: (context: SyncEntityTagsRefreshContext) => ConcreteApiPaths[]
}

export function useEntityTags(
  entityType: EntityType,
  entityId: string | undefined,
  options: UseEntityTagsOptions = {}
): EntityTagsResult {
  const enabled = (options.enabled ?? true) && Boolean(entityId)

  const path = useMemo(() => {
    if (!entityId) return DISABLED_ENTITY_TAGS_PATH
    return `/tags/entities/${entityType}/${entityId}` as const
  }, [entityType, entityId])

  const { data, isLoading, isRefreshing, error, refetch } = useQuery(path, { enabled })
  const stableRefetch = useCallback(() => refetch(), [refetch])

  return {
    tags: enabled && Array.isArray(data) ? data : [],
    isLoading: enabled ? isLoading : false,
    isRefreshing: enabled ? isRefreshing : false,
    error: enabled ? error : undefined,
    refetch: stableRefetch
  }
}

export function useSyncEntityTags(options: UseSyncEntityTagsOptions = {}) {
  const { refreshPaths = [], getRefreshPaths } = options

  const {
    trigger: syncTrigger,
    isLoading,
    error
  } = useMutation('PUT', '/tags/entities/:entityType/:entityId', {
    refresh: ({ args }) => {
      const params = args?.params
      if (!params) return ['/tags', ...refreshPaths]

      const tagIds = args?.body?.tagIds ?? []
      const context: SyncEntityTagsRefreshContext = {
        entityType: params.entityType,
        entityId: params.entityId,
        tagIds
      }

      return [
        '/tags',
        `/tags/entities/${params.entityType}/${params.entityId}`,
        ...refreshPaths,
        ...(getRefreshPaths?.(context) ?? [])
      ]
    }
  })

  const syncEntityTags = useCallback(
    (entityType: EntityType, entityId: string, tagIds: string[]): Promise<void> =>
      syncTrigger({
        params: { entityType, entityId },
        body: { tagIds }
      }),
    [syncTrigger]
  )

  return { syncEntityTags, isLoading, error }
}
