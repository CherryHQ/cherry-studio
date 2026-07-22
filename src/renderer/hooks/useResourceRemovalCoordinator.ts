import { useCallback, useRef } from 'react'

interface ResourceRemovalSnapshot<T> {
  itemId: string
  groupId: string
  displayedItems: readonly T[]
  groupOrder: readonly string[]
}

interface ResourceRemovalRequest<T> {
  item: T
  displayedItems: readonly T[]
  groupOrder: readonly string[]
  commit: () => Promise<boolean | void>
}

interface UseResourceRemovalCoordinatorOptions<T> {
  getActiveId: () => string | null | undefined
  getGroupId: (item: T) => string
  getItemId: (item: T) => string
  /**
   * Authoritative post-delete owner check for grouped owner presentations.
   * `undefined` means the owner still has unloaded records, so the current
   * loaded projection cannot select a replacement. An item or `null` handles
   * an emptied owner explicitly.
   */
  resolveOwnerFallback?: (item: T) => Promise<T | null | undefined>
  /** Hide the row immediately while its delete request is in flight. */
  optimisticallyRemove?: (item: T) => void
  /** Restore a hidden row when the delete request rejects or returns false. */
  restoreOptimisticRemoval?: (item: T) => void
  selectItem: (item: T) => void
  clearSelection: () => void
}

function pickLoadedNeighbour<T>(items: readonly T[], removedIndex: number): T | undefined {
  if (items.length === 0) return undefined
  return items[removedIndex] ?? items[Math.min(removedIndex - 1, items.length - 1)]
}

function pickSiblingGroupNeighbour<T>(
  snapshot: ResourceRemovalSnapshot<T>,
  getGroupId: (item: T) => string,
  getItemId: (item: T) => string
): T | undefined {
  const currentGroupIndex = snapshot.groupOrder.indexOf(snapshot.groupId)
  if (currentGroupIndex < 0) return undefined

  for (const groupId of snapshot.groupOrder.slice(currentGroupIndex + 1)) {
    const candidate = snapshot.displayedItems.find(
      (item) => snapshot.itemId !== getItemId(item) && getGroupId(item) === groupId
    )
    if (candidate) return candidate
  }

  for (const groupId of snapshot.groupOrder.slice(0, currentGroupIndex).reverse()) {
    const candidates = snapshot.displayedItems.filter(
      (item) => snapshot.itemId !== getItemId(item) && getGroupId(item) === groupId
    )
    const candidate = candidates.at(-1)
    if (candidate) return candidate
  }

  return undefined
}

/**
 * Shared Topic/Session removal state machine.
 *
 * The coordinator snapshots the active row's presentation before deletion,
 * selects an already-loaded neighbour optimistically, then uses an optional
 * authoritative owner lookup when the loaded owner projection becomes empty.
 * A monotonically increasing operation id plus the live active id prevent a
 * stale owner lookup from re-activating a removed record.
 */
export function useResourceRemovalCoordinator<T>({
  getActiveId,
  getGroupId,
  getItemId,
  resolveOwnerFallback,
  optimisticallyRemove,
  restoreOptimisticRemoval,
  selectItem,
  clearSelection
}: UseResourceRemovalCoordinatorOptions<T>) {
  const operationIdRef = useRef(0)

  const remove = useCallback(
    async ({ item, displayedItems, groupOrder, commit }: ResourceRemovalRequest<T>) => {
      const itemId = getItemId(item)
      const groupId = getGroupId(item)
      const groupItems = displayedItems.filter((candidate) => getGroupId(candidate) === groupId)
      const displayedIndex = groupItems.findIndex((candidate) => getItemId(candidate) === itemId)
      const snapshot: ResourceRemovalSnapshot<T> = {
        itemId,
        groupId,
        displayedItems,
        groupOrder
      }
      const operationId = ++operationIdRef.current
      const wasActive = getActiveId() === itemId
      const immediateNeighbour = wasActive
        ? pickLoadedNeighbour(
            groupItems.filter((candidate) => getItemId(candidate) !== itemId),
            Math.max(displayedIndex, 0)
          )
        : undefined

      optimisticallyRemove?.(item)
      if (wasActive) {
        if (immediateNeighbour) selectItem(immediateNeighbour)
        else clearSelection()
      }
      const optimisticActiveId = getActiveId()

      let committed: boolean | void
      try {
        committed = await commit()
      } catch (error) {
        restoreOptimisticRemoval?.(item)
        if (wasActive && operationIdRef.current === operationId && getActiveId() === optimisticActiveId) {
          selectItem(item)
        }
        throw error
      }
      if (committed === false) {
        restoreOptimisticRemoval?.(item)
        if (wasActive && operationIdRef.current === operationId && getActiveId() === optimisticActiveId) {
          selectItem(item)
        }
        return false
      }
      if (!wasActive) return true

      const isCurrent = () => operationIdRef.current === operationId && getActiveId() === optimisticActiveId
      if (!isCurrent() || immediateNeighbour) return true

      if (resolveOwnerFallback) {
        const fallback = await resolveOwnerFallback(item)
        if (!isCurrent()) return true
        if (fallback !== undefined) {
          if (fallback) selectItem(fallback)
          else clearSelection()
          return true
        }
        return true
      }

      const sibling = pickSiblingGroupNeighbour(snapshot, getGroupId, getItemId)
      if (sibling) selectItem(sibling)
      else clearSelection()
      return true
    },
    [
      clearSelection,
      getActiveId,
      getGroupId,
      getItemId,
      optimisticallyRemove,
      resolveOwnerFallback,
      restoreOptimisticRemoval,
      selectItem
    ]
  )

  return { remove }
}
