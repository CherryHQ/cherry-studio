import { useCallback, useRef } from 'react'

export type ResourceRemovalBand = 'pinned' | 'ordinary'

export interface ResourceRemovalSnapshot<T, TContext = undefined> {
  item: T
  itemId: string
  groupId: string
  band: ResourceRemovalBand
  displayedIndex: number
  loadedWindowSize: number
  groupItems: readonly T[]
  displayedItems: readonly T[]
  groupOrder: readonly string[]
  context: TContext
}

export interface ResourceRemovalRefill<T> {
  items: readonly T[]
  /**
   * Index that now occupies the removed row's displayed position. Callers that
   * rebuild an anchored window can override the snapshot index with the
   * equivalent position in the replacement window.
   */
  selectionIndex?: number
}

interface ResourceRemovalRequest<T, TContext> {
  item: T
  displayedItems: readonly T[]
  groupOrder: readonly string[]
  context: TContext
  commit: () => Promise<boolean | void>
}

interface UseResourceRemovalCoordinatorOptions<T, TContext> {
  getActiveId: () => string | null | undefined
  getBand: (item: T) => ResourceRemovalBand
  getGroupId: (item: T) => string
  getItemId: (item: T) => string
  refillGroup: (snapshot: ResourceRemovalSnapshot<T, TContext>) => Promise<ResourceRemovalRefill<T>>
  /**
   * Authoritative post-delete owner check for grouped owner presentations.
   * `undefined` keeps normal visible-neighbour selection because the owner
   * still has records; an item or `null` handles an emptied owner explicitly.
   */
  resolveOwnerFallback?: (snapshot: ResourceRemovalSnapshot<T, TContext>) => Promise<T | null | undefined>
  /** Hide the row immediately while its delete request is in flight. */
  optimisticallyRemove?: (item: T) => void
  /** Restore a hidden row when the delete request rejects or returns false. */
  restoreOptimisticRemoval?: (item: T) => void
  selectItem: (item: T) => void
  clearSelection: () => void
}

function pickRefilledNeighbour<T>(items: readonly T[], removedIndex: number, selectionIndex?: number): T | undefined {
  if (items.length === 0) return undefined
  const nextIndex = selectionIndex ?? removedIndex
  return items[nextIndex] ?? items[Math.min(nextIndex - 1, items.length - 1)]
}

function pickSiblingGroupNeighbour<T>(
  snapshot: ResourceRemovalSnapshot<T, unknown>,
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
 * rebuilds only that group to its previous loaded extent, then selects the row
 * that shifted into the removed position (or the previous row at the tail).
 * A monotonically increasing operation id plus the live active id prevent a
 * stale refill or owner lookup from re-activating a removed record.
 */
export function useResourceRemovalCoordinator<T, TContext = undefined>({
  getActiveId,
  getBand,
  getGroupId,
  getItemId,
  refillGroup,
  resolveOwnerFallback,
  optimisticallyRemove,
  restoreOptimisticRemoval,
  selectItem,
  clearSelection
}: UseResourceRemovalCoordinatorOptions<T, TContext>) {
  const operationIdRef = useRef(0)

  const remove = useCallback(
    async ({ item, displayedItems, groupOrder, context, commit }: ResourceRemovalRequest<T, TContext>) => {
      const itemId = getItemId(item)
      const groupId = getGroupId(item)
      const groupItems = displayedItems.filter((candidate) => getGroupId(candidate) === groupId)
      const displayedIndex = groupItems.findIndex((candidate) => getItemId(candidate) === itemId)
      const snapshot: ResourceRemovalSnapshot<T, TContext> = {
        item,
        itemId,
        groupId,
        band: getBand(item),
        displayedIndex: Math.max(displayedIndex, 0),
        loadedWindowSize: Math.max(groupItems.length, 1),
        groupItems,
        displayedItems,
        groupOrder,
        context
      }
      const operationId = ++operationIdRef.current
      const wasActive = getActiveId() === itemId
      const immediateNeighbour = wasActive
        ? pickRefilledNeighbour(
            groupItems.filter((candidate) => getItemId(candidate) !== itemId),
            snapshot.displayedIndex
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
      const replacement = await refillGroup(snapshot)
      if (!isCurrent()) return true

      if (resolveOwnerFallback) {
        const fallback = await resolveOwnerFallback(snapshot)
        if (!isCurrent()) return true
        if (fallback !== undefined) {
          if (fallback) selectItem(fallback)
          else clearSelection()
          return true
        }
      }

      const neighbour = pickRefilledNeighbour(replacement.items, snapshot.displayedIndex, replacement.selectionIndex)
      if (neighbour) {
        selectItem(neighbour)
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
      getBand,
      getGroupId,
      getItemId,
      optimisticallyRemove,
      refillGroup,
      resolveOwnerFallback,
      restoreOptimisticRemoval,
      selectItem
    ]
  )

  return { remove }
}
