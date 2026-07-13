import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  buildResourceListItemDropAnchor,
  compareResourceOrderKey,
  type ResourceListReorderPayload,
  type ResourceListStatus
} from './base'
import type { ResourceEntityRailItem } from './ResourceEntityRail'

export type ResourceEntityRailReorderAnchor = ReturnType<typeof buildResourceListItemDropAnchor>

type UseResourceEntityRailParams<TEntity extends ResourceEntityRailItem, TResource> = {
  /** Every entity (already mapped to a rail item). The hook filters to those with resources and orders them. */
  entities: readonly TEntity[]
  /** Factual server counts used to keep only entities that own at least one resource. */
  resourceCountByEntityId: ReadonlyMap<string, number>
  activeEntityId?: string | null
  isLoading: boolean
  isError: boolean
  onPickResource: (resource: TResource) => void
  /** Load the entity's first resource before navigating. */
  loadFirstResource: (entityId: string) => Promise<TResource | null>
  onCreateResource: (entityId: string) => void | Promise<unknown>
  reorder: (entityId: string, anchor: ResourceEntityRailReorderAnchor) => Promise<void>
  refetchEntities: () => Promise<unknown>
  onReorderError: (error: unknown) => void
}

type UseResourceEntityRailResult<TEntity> = {
  items: TEntity[]
  listStatus: ResourceListStatus
  selectedId: string | null
  handleSelect: (item: TEntity) => Promise<void>
  handleReorder: (payload: ResourceListReorderPayload) => Promise<void>
}

/**
 * Shared behavior for the classic-layout entity rail (assistants / agents): only entities that own
 * resources are shown, ordered by `orderKey` with optimistic drag reordering, clicking enters the
 * first resource (or creates a blank resource), and reordering persists the real `orderKey`. Data fetching,
 * pins, deletion, and context menus stay in the per-variant component.
 */
export function useResourceEntityRail<TEntity extends ResourceEntityRailItem, TResource>({
  entities,
  resourceCountByEntityId,
  activeEntityId,
  isLoading,
  isError,
  onPickResource,
  loadFirstResource,
  onCreateResource,
  reorder,
  refetchEntities,
  onReorderError
}: UseResourceEntityRailParams<TEntity, TResource>): UseResourceEntityRailResult<TEntity> {
  const [optimisticOrderIds, setOptimisticOrderIds] = useState<readonly string[] | null>(null)
  const selectRequestGenerationRef = useRef(0)

  useEffect(
    () => () => {
      selectRequestGenerationRef.current += 1
    },
    []
  )

  const entityIdsWithResources = useMemo(
    () => new Set([...resourceCountByEntityId].flatMap(([entityId, count]) => (count > 0 ? [entityId] : []))),
    [resourceCountByEntityId]
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
    let base = ordered
    if (optimisticOrderIds) {
      const byId = new Map(ordered.map((entity) => [entity.id, entity]))
      const optimistic = optimisticOrderIds.flatMap((id) => {
        const entity = byId.get(id)
        return entity ? [entity] : []
      })
      const optimisticIds = new Set(optimisticOrderIds)
      base = [...optimistic, ...ordered.filter((entity) => !optimisticIds.has(entity.id))]
    }

    // Float pinned entities into the rail's "pinned" group at the top, preserving their relative order.
    const pinned = base.filter((entity) => entity.pinned)
    if (pinned.length === 0) return base
    return [...pinned, ...base.filter((entity) => !entity.pinned)]
  }, [entities, entityIdsWithResources, optimisticOrderIds])

  const listStatus: ResourceListStatus = isError ? 'error' : isLoading && items.length === 0 ? 'loading' : 'idle'
  const selectedId = activeEntityId && entityIdsWithResources.has(activeEntityId) ? activeEntityId : null

  const handleSelect = useCallback(
    async (item: TEntity) => {
      const requestGeneration = ++selectRequestGenerationRef.current
      try {
        const first = await loadFirstResource(item.id)
        if (requestGeneration !== selectRequestGenerationRef.current) return
        if (first) {
          onPickResource(first)
          return
        }
        await onCreateResource(item.id)
      } catch (error) {
        // Superseded requests are intentionally ignored: their result no longer represents
        // the entity the user most recently selected. The current request still rejects so
        // the UI boundary can report it through the standard logger/toast path.
        if (requestGeneration === selectRequestGenerationRef.current) throw error
      }
    },
    [loadFirstResource, onCreateResource, onPickResource]
  )

  const handleReorder = useCallback(
    async (payload: ResourceListReorderPayload) => {
      if (payload.type !== 'item') return

      const activeId = payload.activeId
      const nextIds = items.map((item) => item.id)
      const activeIndex = nextIds.indexOf(activeId)
      const overIndex = nextIds.indexOf(payload.overId)
      if (activeIndex < 0 || overIndex < 0) return
      if (items[activeIndex]?.reorderable === false || items[overIndex]?.reorderable === false) return

      nextIds.splice(activeIndex, 1)
      const adjustedOverIndex = nextIds.indexOf(payload.overId)
      nextIds.splice(payload.position === 'before' ? adjustedOverIndex : adjustedOverIndex + 1, 0, activeId)
      setOptimisticOrderIds(nextIds)

      try {
        await reorder(activeId, buildResourceListItemDropAnchor(payload))
      } catch (error) {
        setOptimisticOrderIds(null)
        onReorderError(error)
        // Best-effort resync after the rollback; a transient refetch failure leaves the
        // already-restored order in place, so swallowing it is intentional.
        await refetchEntities().catch(() => undefined)
        return
      }

      // Post-success refresh to pick up the server order; the optimistic order already matches,
      // so a transient refetch failure is benign and intentionally swallowed.
      await refetchEntities().catch(() => undefined)
    },
    [items, onReorderError, refetchEntities, reorder]
  )

  return { items, listStatus, selectedId, handleSelect, handleReorder }
}
