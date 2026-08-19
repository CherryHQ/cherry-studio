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
  resolveFallback?: (item: T) => Promise<T | null | undefined>
}

function pickLoadedNeighbour<T>(items: readonly T[], removedIndex: number): T | undefined {
  if (items.length === 0) return undefined
  return items[removedIndex] ?? items[Math.min(removedIndex - 1, items.length - 1)]
}

/**
 * Shared Topic/Session removal state machine.
 *
 * The coordinator captures the active row's presentation before deletion,
 * selects an already-loaded neighbour optimistically, then falls back to the
 * most recently active remaining row. A
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
  clearSelection,
  resolveFallback
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
      const replacement = immediateNeighbour ?? (wasActive ? await resolveFallback?.(item) : undefined)
      const shouldSwitchSelection =
        wasActive && operationIdRef.current === operationId && getActiveId() === itemId && Boolean(replacement)

      optimisticallyRemove?.(item)
      if (shouldSwitchSelection && replacement) selectItem(replacement)
      const optimisticActiveId = getActiveId()

      let committed: boolean | void
      try {
        committed = await commit()
      } catch (error) {
        restoreOptimisticRemoval?.(item)
        if (shouldSwitchSelection && operationIdRef.current === operationId && getActiveId() === optimisticActiveId) {
          selectItem(item)
        }
        throw error
      }
      if (committed === false) {
        restoreOptimisticRemoval?.(item)
        if (shouldSwitchSelection && operationIdRef.current === operationId && getActiveId() === optimisticActiveId) {
          selectItem(item)
        }
        return false
      }
      if (wasActive && !replacement && operationIdRef.current === operationId && getActiveId() === itemId) {
        clearSelection()
      }
      return true
    },
    [
      clearSelection,
      getActiveId,
      getGroupId,
      getItemId,
      optimisticallyRemove,
      resolveFallback,
      restoreOptimisticRemoval,
      selectItem
    ]
  )

  return { remove }
}
