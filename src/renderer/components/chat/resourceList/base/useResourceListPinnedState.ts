import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

export type UseResourceListPinnedStateOptions = {
  disabled?: boolean
  onTogglePin: (id: string) => Promise<void>
  pinnedIds: readonly string[]
  resetKey?: string
}

export type UseResourceListPinnedStateResult = {
  pinnedIds: readonly string[]
  isPinned: (id: string) => boolean
  togglePinned: (id: string) => Promise<void>
  togglingIds: ReadonlySet<string>
}

export type ResourceListPinnableItem = {
  id: string
  pinned?: boolean
}

export type UseResourceListPinnedItemsOptions<T extends ResourceListPinnableItem> = {
  disabled?: boolean
  items: readonly T[]
  onTogglePin: (item: T) => Promise<void>
  resetKey?: string
}

export type UseResourceListPinnedItemsResult<T extends ResourceListPinnableItem> = {
  items: T[]
  togglePinned: (item: T) => Promise<void>
  togglingIds: ReadonlySet<string>
}

export function useResourceListPinnedState({
  disabled = false,
  onTogglePin,
  pinnedIds: sourcePinnedIds,
  resetKey
}: UseResourceListPinnedStateOptions): UseResourceListPinnedStateResult {
  const [optimisticPinnedById, setOptimisticPinnedById] = useState<Record<string, boolean>>({})
  const [togglingIds, setTogglingIds] = useState<ReadonlySet<string>>(() => new Set())
  const sourcePinnedIdSet = useMemo(() => new Set(sourcePinnedIds), [sourcePinnedIds])
  const optimisticPinnedByIdRef = useRef(optimisticPinnedById)
  const sourcePinnedIdSetRef = useRef(sourcePinnedIdSet)
  const togglingIdsRef = useRef(togglingIds)

  optimisticPinnedByIdRef.current = optimisticPinnedById
  sourcePinnedIdSetRef.current = sourcePinnedIdSet
  togglingIdsRef.current = togglingIds

  useEffect(() => {
    setOptimisticPinnedById((prev) => {
      let changed = false
      const next = { ...prev }

      for (const [id, pinned] of Object.entries(prev)) {
        if (sourcePinnedIdSet.has(id) === pinned) {
          delete next[id]
          changed = true
        }
      }

      return changed ? next : prev
    })
  }, [sourcePinnedIdSet])

  useEffect(() => {
    setOptimisticPinnedById({})
  }, [resetKey])

  const pinnedIds = useMemo(() => {
    const ids = sourcePinnedIds.filter((id) => optimisticPinnedById[id] !== false)
    for (const [id, pinned] of Object.entries(optimisticPinnedById)) {
      if (pinned && !sourcePinnedIdSet.has(id)) {
        ids.push(id)
      }
    }
    return ids
  }, [optimisticPinnedById, sourcePinnedIdSet, sourcePinnedIds])

  const isPinned = useCallback(
    (id: string) => optimisticPinnedById[id] ?? sourcePinnedIdSet.has(id),
    [optimisticPinnedById, sourcePinnedIdSet]
  )

  const togglePinned = useCallback(
    async (id: string) => {
      if (disabled || togglingIdsRef.current.has(id)) return

      const nextPinned = !(optimisticPinnedByIdRef.current[id] ?? sourcePinnedIdSetRef.current.has(id))
      setOptimisticPinnedById((prev) => ({ ...prev, [id]: nextPinned }))
      togglingIdsRef.current = new Set(togglingIdsRef.current).add(id)
      setTogglingIds(togglingIdsRef.current)

      try {
        await onTogglePin(id)
      } catch (error) {
        setOptimisticPinnedById((prev) => {
          const next = { ...prev }
          delete next[id]
          return next
        })
        throw error
      } finally {
        const next = new Set(togglingIdsRef.current)
        next.delete(id)
        togglingIdsRef.current = next
        setTogglingIds(next)
      }
    },
    [disabled, onTogglePin]
  )

  return {
    pinnedIds,
    isPinned,
    togglePinned,
    togglingIds
  }
}

/**
 * Applies {@link useResourceListPinnedState} to full list rows and retains the
 * toggled row until the authoritative pinned/unpinned window catches up.
 */
export function useResourceListPinnedItems<T extends ResourceListPinnableItem>({
  disabled = false,
  items: sourceItems,
  onTogglePin,
  resetKey
}: UseResourceListPinnedItemsOptions<T>): UseResourceListPinnedItemsResult<T> {
  const [pendingItemsById, setPendingItemsById] = useState<Record<string, T>>({})
  const sourceItemsById = useMemo(() => new Map(sourceItems.map((item) => [item.id, item])), [sourceItems])
  const sourcePinnedIds = useMemo(() => sourceItems.filter((item) => item.pinned).map((item) => item.id), [sourceItems])
  const sourceItemsByIdRef = useRef(sourceItemsById)
  const pendingItemsByIdRef = useRef(pendingItemsById)

  sourceItemsByIdRef.current = sourceItemsById
  pendingItemsByIdRef.current = pendingItemsById

  const toggleSourcePin = useCallback(
    async (id: string) => {
      const item = sourceItemsByIdRef.current.get(id) ?? pendingItemsByIdRef.current[id]
      if (item) await onTogglePin(item)
    },
    [onTogglePin]
  )
  const {
    isPinned,
    togglePinned: togglePinnedId,
    togglingIds
  } = useResourceListPinnedState({
    disabled,
    onTogglePin: toggleSourcePin,
    pinnedIds: sourcePinnedIds,
    resetKey
  })

  useEffect(() => {
    pendingItemsByIdRef.current = {}
    setPendingItemsById({})
  }, [resetKey])

  useEffect(() => {
    setPendingItemsById((current) => {
      let changed = false
      const next = { ...current }

      for (const id of Object.keys(current)) {
        const sourceItem = sourceItemsById.get(id)
        if (!togglingIds.has(id) && sourceItem?.pinned === isPinned(id)) {
          delete next[id]
          changed = true
        }
      }

      return changed ? next : current
    })
  }, [isPinned, sourceItemsById, togglingIds])

  const items = useMemo(() => {
    const byId = new Map(sourceItemsById)
    for (const [id, item] of Object.entries(pendingItemsById)) {
      if (!byId.has(id)) byId.set(id, item)
    }

    return [...byId.values()].map((item) => {
      const pinned = isPinned(item.id)
      return pinned === item.pinned ? item : { ...item, pinned }
    })
  }, [isPinned, pendingItemsById, sourceItemsById])

  const togglePinned = useCallback(
    async (item: T) => {
      if (disabled || togglingIds.has(item.id) || pendingItemsByIdRef.current[item.id]) return

      const nextPendingItems = { ...pendingItemsByIdRef.current, [item.id]: item }
      pendingItemsByIdRef.current = nextPendingItems
      setPendingItemsById(nextPendingItems)

      try {
        await togglePinnedId(item.id)
      } catch (error) {
        const next = { ...pendingItemsByIdRef.current }
        delete next[item.id]
        pendingItemsByIdRef.current = next
        setPendingItemsById(next)
        throw error
      }
    },
    [disabled, togglePinnedId, togglingIds]
  )

  return { items, togglePinned, togglingIds }
}
