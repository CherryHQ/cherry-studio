import { useCallback, useMemo } from 'react'

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
  /** Every pin page is known — the unpinned band may be exposed below. */
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
export function usePinnedBandPagination<T extends { pinned?: boolean }>(
  pinned: PinnedBandSource<T>,
  unpinned: PinnedBandSource<T>
): PinnedBandPaginationResult<T> {
  // Defensive narrowing: the streams are server-filtered, but a stale page can
  // briefly carry rows whose pin state flipped locally.
  const pinnedItems = useMemo(() => pinned.items.filter((item) => item.pinned === true), [pinned.items])
  const unpinnedItems = useMemo(() => unpinned.items.filter((item) => item.pinned !== true), [unpinned.items])

  const isPinnedBandComplete = !pinned.isLoading && !pinned.error && !pinned.hasNext

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
