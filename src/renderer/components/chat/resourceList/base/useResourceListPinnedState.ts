import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

export type UseResourceListPinnedStateOptions = {
  disabled?: boolean
  onTogglePin: (id: string) => Promise<void>
  pinnedIds: readonly string[]
}

export type UseResourceListPinnedStateResult = {
  pinnedIds: readonly string[]
  isPinned: (id: string) => boolean
  togglePinned: (id: string) => Promise<void>
  togglingIds: ReadonlySet<string>
}

export function useResourceListPinnedState({
  disabled = false,
  onTogglePin,
  pinnedIds: sourcePinnedIds
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
