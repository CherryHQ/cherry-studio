import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

type ResourceListPinnableItem = {
  id: string
  pinned?: boolean
}

type UseResourceListPinnedItemsOptions<T extends ResourceListPinnableItem> = {
  disabled?: boolean
  items: readonly T[]
  onTogglePin: (item: T) => Promise<T>
  resetKey?: string
}

type PendingPin<T> = {
  appendWhenPinned: boolean
  item: T
  pinned: boolean
  inFlight: boolean
  sourceIndex: number
}

/**
 * Projects pin state immediately while retaining rows through split-stream gaps.
 * New pins use PinService's append position; consumers sort unpins by their ordinary rules.
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

    const retainedItems = [...sourceItems]
    const retainedIds = new Set(retainedItems.map((item) => item.id))
    for (const pending of pendingPins.sort((left, right) => left.sourceIndex - right.sourceIndex)) {
      if (retainedIds.has(pending.item.id)) continue
      retainedItems.splice(Math.min(pending.sourceIndex, retainedItems.length), 0, pending.item)
      retainedIds.add(pending.item.id)
    }

    const projectedItems = retainedItems.map((item) => {
      const pinned = pendingPinsById[item.id]?.pinned ?? item.pinned
      return pinned === item.pinned ? item : { ...item, pinned }
    })
    const newlyPinnedIds = new Set(
      pendingPins.filter((pending) => pending.appendWhenPinned && pending.pinned).map((pending) => pending.item.id)
    )
    if (newlyPinnedIds.size === 0) return projectedItems

    const newlyPinnedItems = projectedItems.filter((item) => newlyPinnedIds.has(item.id))
    const stationaryItems = projectedItems.filter((item) => !newlyPinnedIds.has(item.id))
    let insertIndex = 0
    stationaryItems.forEach((item, index) => {
      if (item.pinned) insertIndex = index + 1
    })

    return [...stationaryItems.slice(0, insertIndex), ...newlyPinnedItems, ...stationaryItems.slice(insertIndex)]
  }, [pendingPinsById, sourceItemsById])

  const pendingPinnedById = useMemo(
    () => new Map(Object.entries(pendingPinsById).map(([id, pending]) => [id, pending.pinned])),
    [pendingPinsById]
  )

  const togglePinned = useCallback(
    async (item: T) => {
      const existingPending = pendingPinsByIdRef.current[item.id]
      let committedItem: T

      if (existingPending) {
        const pinned = !existingPending.pinned
        updatePendingPins((current) => {
          const pending = current[item.id]
          if (!pending) return current

          return {
            ...current,
            [item.id]: {
              ...pending,
              appendWhenPinned: pending.appendWhenPinned || pinned,
              inFlight: true,
              pinned
            }
          }
        })
        if (existingPending.inFlight) return
        committedItem = existingPending.item
      } else {
        if (disabled) return

        const sourceItem = sourceItemsByIdRef.current.get(item.id) ?? item
        const sourceIndex = [...sourceItemsByIdRef.current.keys()].indexOf(item.id)
        updatePendingPins((current) => ({
          ...current,
          [item.id]: {
            appendWhenPinned: sourceItem.pinned !== true,
            item: sourceItem,
            pinned: !sourceItem.pinned,
            inFlight: true,
            sourceIndex: sourceIndex < 0 ? sourceItemsByIdRef.current.size : sourceIndex
          }
        }))
        committedItem = sourceItem
      }

      try {
        while (true) {
          const pending = pendingPinsByIdRef.current[item.id]
          if (!pending || pending.pinned === (committedItem.pinned === true)) break

          committedItem = await onTogglePin(committedItem)
          updatePendingPins((current) => {
            const currentPending = current[item.id]
            return currentPending ? { ...current, [item.id]: { ...currentPending, item: committedItem } } : current
          })
        }
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

  return { items, pendingPinnedById, togglePinned }
}
