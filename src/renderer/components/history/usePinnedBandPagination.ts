import { useCallback, useEffect, useMemo, useRef } from 'react'

/** One cursor-paged stream feeding a band, adapted from `useTopics` / `useSessions`. */
export interface PinnedBandSource<T> {
  items: readonly T[]
  error: Error | undefined
  hasNext: boolean
  isLoading: boolean
  /** In-flight load-more / background revalidation for this stream. */
  isLoadingMore: boolean
  loadNext: () => void
  /** Restart the stream from page one. */
  reload: () => Promise<unknown>
}

export interface PinnedBandPaginationResult<T> {
  /** Pinned band first; unpinned band appended only once the pinned band is complete. */
  items: T[]
  /** Every pin page is known from this key's current or last successful completed snapshot. */
  isPinnedBandComplete: boolean
  error: Error | undefined
  isLoading: boolean
  isLoadingMore: boolean
  hasNext: boolean
  /** Cascade: finish the pinned band before paging the unpinned one. */
  loadNext: () => void
  /** Restart both streams from page one. */
  reload: () => Promise<unknown>
}

/**
 * Two-band history pagination: a pinned stream rendered first, an unpinned
 * stream revealed only once every pin page is known, so a pin can never
 * appear below unpinned rows. Both streams still start fetching together —
 * the common no-pin path is not serialized.
 *
 * Callers own outer gating (error/loading guards, runtime-status branches)
 * around `loadNext`.
 */
export function usePinnedBandPagination<T extends { id: string; pinned?: boolean }>(
  pinned: PinnedBandSource<T>,
  unpinned: PinnedBandSource<T>,
  /** Changes whenever owner/search scope changes, invalidating prior completion continuity. */
  options: { continuityKey: string }
): PinnedBandPaginationResult<T> {
  const pinnedCompletionRef = useRef({ continuityKey: options.continuityKey, completed: false })

  // Defensive narrowing: the streams are server-filtered, but a stale page can
  // briefly carry rows whose pin state flipped locally.
  const pinnedItems = useMemo(
    () => [...new Map(pinned.items.filter((item) => item.pinned === true).map((item) => [item.id, item])).values()],
    [pinned.items]
  )
  const pinnedIds = useMemo(() => new Set(pinnedItems.map((item) => item.id)), [pinnedItems])
  const unpinnedItems = useMemo(
    () => [
      ...new Map(
        unpinned.items.filter((item) => item.pinned !== true && !pinnedIds.has(item.id)).map((item) => [item.id, item])
      ).values()
    ],
    [pinnedIds, unpinned.items]
  )

  const isPinnedBandCompleteNow = !pinned.isLoading && !pinned.error && !pinned.hasNext
  const hasCompletedCurrentKey =
    pinnedCompletionRef.current.continuityKey === options.continuityKey && pinnedCompletionRef.current.completed
  useEffect(() => {
    if (pinnedCompletionRef.current.continuityKey !== options.continuityKey) {
      pinnedCompletionRef.current = {
        continuityKey: options.continuityKey,
        completed: isPinnedBandCompleteNow
      }
      return
    }
    if (isPinnedBandCompleteNow) {
      pinnedCompletionRef.current.completed = true
    } else if (!pinned.isLoading && !pinned.error && pinned.hasNext) {
      // A successful incomplete first page proves that a same-scope cursor reset
      // started a new pin snapshot; completion from the prior snapshot is stale.
      pinnedCompletionRef.current.completed = false
    }
  }, [isPinnedBandCompleteNow, options.continuityKey, pinned.error, pinned.hasNext, pinned.isLoading])
  // A failed background pin refresh must not hide already-visible ordinary rows. Loading/reset states
  // still hide them, and a changed owner/search key starts with no continuity proof.
  const isPinnedBandComplete = isPinnedBandCompleteNow || (!!pinned.error && hasCompletedCurrentKey)

  const items = useMemo(
    () => (isPinnedBandComplete ? [...pinnedItems, ...unpinnedItems] : [...pinnedItems]),
    [isPinnedBandComplete, pinnedItems, unpinnedItems]
  )

  const { hasNext: hasNextPinned, loadNext: loadNextPinned } = pinned
  const { hasNext: hasNextUnpinned, loadNext: loadNextUnpinned } = unpinned
  const loadNext = useCallback(() => {
    if (hasNextPinned) {
      loadNextPinned()
    } else if (isPinnedBandComplete && hasNextUnpinned) {
      loadNextUnpinned()
    }
  }, [hasNextPinned, hasNextUnpinned, isPinnedBandComplete, loadNextPinned, loadNextUnpinned])

  const { reload: reloadPinned } = pinned
  const { reload: reloadUnpinned } = unpinned
  const reload = useCallback(() => Promise.all([reloadPinned(), reloadUnpinned()]), [reloadPinned, reloadUnpinned])

  return {
    items,
    isPinnedBandComplete,
    error: pinned.error ?? (isPinnedBandComplete ? unpinned.error : undefined),
    isLoading: pinned.isLoading || (isPinnedBandComplete && unpinned.isLoading),
    isLoadingMore: pinned.isLoadingMore || (isPinnedBandComplete && unpinned.isLoadingMore),
    hasNext: hasNextPinned || (isPinnedBandComplete && hasNextUnpinned),
    loadNext,
    reload
  }
}
