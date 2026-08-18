import { useCallback, useRef } from 'react'

interface ResourceRemovalRequest<T> {
  item: T
  displayedItems: readonly T[]
  commit: () => Promise<boolean | void>
}

interface UseResourceRemovalCoordinatorOptions<T> {
  getActiveId: () => string | null | undefined
  getGroupId: (item: T) => string
  getItemId: (item: T) => string
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

/**
 * Shared Topic/Session removal state machine.
 *
 * The coordinator captures the active row's presentation before deletion,
 * selects an already-loaded neighbour optimistically, and clears the selection
 * when the removed row had no loaded neighbour in its owner group. A
 * monotonically increasing operation id plus the live active id prevent a
 * failed delete from overwriting a newer selection.
 */
export function useResourceRemovalCoordinator<T>({
  getActiveId,
  getGroupId,
  getItemId,
  optimisticallyRemove,
  restoreOptimisticRemoval,
  selectItem,
  clearSelection
}: UseResourceRemovalCoordinatorOptions<T>) {
  const operationIdRef = useRef(0)

  const remove = useCallback(
    async ({ item, displayedItems, commit }: ResourceRemovalRequest<T>) => {
      const itemId = getItemId(item)
      const groupId = getGroupId(item)
      const groupItems = displayedItems.filter((candidate) => getGroupId(candidate) === groupId)
      const displayedIndex = groupItems.findIndex((candidate) => getItemId(candidate) === itemId)
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
      return true
    },
    [clearSelection, getActiveId, getGroupId, getItemId, optimisticallyRemove, restoreOptimisticRemoval, selectItem]
  )

  return { remove }
}
