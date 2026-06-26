import {
  buildResourceListItemDropAnchor,
  compareResourceOrderKey,
  type ResourceListReorderPayload,
  type ResourceListStatus
} from '@renderer/components/chat/resources'
import { useCallback, useEffect, useMemo, useState } from 'react'

import type { ResourceEntityRailItem } from './ResourceEntityRail'

export type ResourceEntityRailReorderAnchor = ReturnType<typeof buildResourceListItemDropAnchor>

type UseResourceEntityRailParams<TEntity extends ResourceEntityRailItem, TResource> = {
  /** Every entity (already mapped to a rail item). The hook filters to those with resources and orders them. */
  entities: readonly TEntity[]
  /** Every resource for the current scope; an entity is only visible while it owns at least one. */
  resources: readonly TResource[]
  getResourceParentId: (resource: TResource) => string | null | undefined
  activeEntityId?: string | null
  isLoading: boolean
  isError: boolean
  /** Orders an entity's own resources so `handleSelect` can enter the first one (time/pin precedence). */
  sortResourcesForEntity: (resources: TResource[]) => readonly TResource[]
  onPickResource: (resource: TResource) => void
  onStartDraft: (entityId: string) => void | Promise<void>
  reorder: (entityId: string, anchor: ResourceEntityRailReorderAnchor) => Promise<void>
  refetchEntities: () => Promise<unknown>
  onReorderError: (error: unknown) => void
}

type UseResourceEntityRailResult<TEntity> = {
  items: TEntity[]
  listStatus: ResourceListStatus
  selectedId: string | null
  handleSelect: (item: TEntity) => void
  handleReorder: (payload: ResourceListReorderPayload) => Promise<void>
}

/**
 * Shared behavior for the right-mode entity rail (assistants / agents): only entities that own
 * resources are shown, ordered by `orderKey` with optimistic drag reordering, clicking enters the
 * first resource (or a blank draft), and reordering persists the real `orderKey`. Data fetching,
 * pins, deletion, and context menus stay in the per-variant component.
 */
export function useResourceEntityRail<TEntity extends ResourceEntityRailItem, TResource>({
  entities,
  resources,
  getResourceParentId,
  activeEntityId,
  isLoading,
  isError,
  sortResourcesForEntity,
  onPickResource,
  onStartDraft,
  reorder,
  refetchEntities,
  onReorderError
}: UseResourceEntityRailParams<TEntity, TResource>): UseResourceEntityRailResult<TEntity> {
  const [optimisticOrderIds, setOptimisticOrderIds] = useState<readonly string[] | null>(null)

  const entityIdsWithResources = useMemo(
    () => new Set(resources.map(getResourceParentId).filter((id): id is string => !!id)),
    [getResourceParentId, resources]
  )
  const orderSignature = useMemo(
    () => entities.map((entity) => `${entity.id}:${entity.orderKey ?? ''}`).join('|'),
    [entities]
  )

  useEffect(() => {
    setOptimisticOrderIds(null)
  }, [orderSignature])

  const items = useMemo<TEntity[]>(() => {
    const filtered = entities.filter((entity) => entityIdsWithResources.has(entity.id))
    const ordered = [...filtered].sort((a, b) => compareResourceOrderKey(a.orderKey, b.orderKey))
    if (!optimisticOrderIds) return ordered

    const byId = new Map(ordered.map((entity) => [entity.id, entity]))
    const optimistic = optimisticOrderIds.flatMap((id) => {
      const entity = byId.get(id)
      return entity ? [entity] : []
    })
    const optimisticIds = new Set(optimisticOrderIds)
    return [...optimistic, ...ordered.filter((entity) => !optimisticIds.has(entity.id))]
  }, [entities, entityIdsWithResources, optimisticOrderIds])

  const listStatus: ResourceListStatus = isError ? 'error' : isLoading && items.length === 0 ? 'loading' : 'idle'
  const selectedId = activeEntityId && entityIdsWithResources.has(activeEntityId) ? activeEntityId : null

  const handleSelect = useCallback(
    (item: TEntity) => {
      // A visible rail entity always owns at least one loaded resource (rail visibility derives from
      // `resources`), so enter its first/most-recent resource — no need to wait for the full load.
      // Only the (effectively unreachable) no-resource case falls back to a blank draft.
      const entityResources = resources.filter((resource) => getResourceParentId(resource) === item.id)
      const first = sortResourcesForEntity(entityResources)[0]
      if (first) {
        onPickResource(first)
        return
      }
      void onStartDraft(item.id)
    },
    [getResourceParentId, onPickResource, onStartDraft, resources, sortResourcesForEntity]
  )

  const handleReorder = useCallback(
    async (payload: ResourceListReorderPayload) => {
      if (payload.type !== 'item') return

      const activeId = payload.activeId
      const nextIds = items.map((item) => item.id)
      const activeIndex = nextIds.indexOf(activeId)
      const overIndex = nextIds.indexOf(payload.overId)
      if (activeIndex < 0 || overIndex < 0) return

      nextIds.splice(activeIndex, 1)
      const adjustedOverIndex = nextIds.indexOf(payload.overId)
      nextIds.splice(payload.position === 'before' ? adjustedOverIndex : adjustedOverIndex + 1, 0, activeId)
      setOptimisticOrderIds(nextIds)

      try {
        await reorder(activeId, buildResourceListItemDropAnchor(payload))
        await refetchEntities()
      } catch (error) {
        setOptimisticOrderIds(null)
        onReorderError(error)
        await refetchEntities().catch(() => undefined)
      }
    },
    [items, onReorderError, refetchEntities, reorder]
  )

  return { items, listStatus, selectedId, handleSelect, handleReorder }
}
