import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

type ResourceListPinnableItem = {
  id: string
  pinned?: boolean
}

type UseResourceListPinnedItemsOptions<T extends ResourceListPinnableItem> = {
  disabled?: boolean
  items: readonly T[]
  onTogglePin: (item: T) => Promise<void>
  resetKey?: string
}

type PendingPin<T> = {
  item: T
  pinned: boolean
  inFlight: boolean
  sourceIndex: number
}

/**
 * Retains a moving row at its stable source position until the authoritative
 * pinned/unpinned streams catch up.
 */
export function useResourceListPinnedItems<T extends ResourceListPinnableItem>({
  disabled = false,
  items: sourceItems,
  onTogglePin,
  resetKey
}: UseResourceListPinnedItemsOptions<T>) {
  const [pendingPinsById, setPendingPinsById] = useState<Record<string, PendingPin<T>>>({})
  const sourceItemsById = useMemo(() => new Map(sourceItems.map((item) => [item.id, item])), [sourceItems])
  const sourceItemsByIdRef = useRef(sourceItemsById)
  const pendingPinsByIdRef = useRef(pendingPinsById)

  sourceItemsByIdRef.current = sourceItemsById
  pendingPinsByIdRef.current = pendingPinsById

  const updatePendingPins = useCallback(
    (update: (current: Record<string, PendingPin<T>>) => Record<string, PendingPin<T>>) => {
      const next = update(pendingPinsByIdRef.current)
      pendingPinsByIdRef.current = next
      setPendingPinsById(next)
    },
    []
  )

  useEffect(() => {
    updatePendingPins(() => ({}))
  }, [resetKey, updatePendingPins])

  useEffect(() => {
    updatePendingPins((current) => {
      const settledIds = Object.entries(current)
        .filter(([id, pending]) => !pending.inFlight && sourceItemsById.get(id)?.pinned === pending.pinned)
        .map(([id]) => id)
      if (settledIds.length === 0) return current

      const next = { ...current }
      settledIds.forEach((id) => delete next[id])
      return next
    })
  }, [sourceItemsById, updatePendingPins])

  const items = useMemo(() => {
    const pendingPins = Object.values(pendingPinsById)
    const sourceItems = [...sourceItemsById.values()]
    if (pendingPins.length === 0) return sourceItems

    const pendingIds = new Set(pendingPins.map((pending) => pending.item.id))
    const stableItems = sourceItems.filter((item) => !pendingIds.has(item.id))
    for (const pending of pendingPins.sort((left, right) => left.sourceIndex - right.sourceIndex)) {
      stableItems.splice(Math.min(pending.sourceIndex, stableItems.length), 0, pending.item)
    }
    return stableItems
  }, [pendingPinsById, sourceItemsById])

  const togglePinned = useCallback(
    async (item: T) => {
      if (disabled || pendingPinsByIdRef.current[item.id]) return

      const sourceItem = sourceItemsByIdRef.current.get(item.id) ?? item
      const sourceIndex = [...sourceItemsByIdRef.current.keys()].indexOf(item.id)
      updatePendingPins((current) => ({
        ...current,
        [item.id]: {
          item: sourceItem,
          pinned: !sourceItem.pinned,
          inFlight: true,
          sourceIndex: sourceIndex < 0 ? sourceItemsByIdRef.current.size : sourceIndex
        }
      }))

      try {
        await onTogglePin(sourceItem)
      } catch (error) {
        updatePendingPins((current) => {
          const next = { ...current }
          delete next[item.id]
          return next
        })
        throw error
      }

      updatePendingPins((current) => {
        const pending = current[item.id]
        if (!pending) return current

        const next = { ...current }
        if (sourceItemsByIdRef.current.get(item.id)?.pinned === pending.pinned) {
          delete next[item.id]
        } else {
          next[item.id] = { ...pending, inFlight: false }
        }
        return next
      })
    },
    [disabled, onTogglePin, updatePendingPins]
  )

  return { items, togglePinned }
}
