import { useCallback, useMemo, useRef } from 'react'

export type FollowingReason = 'restored-bottom' | 'scroll-to-bottom' | 'user-reached-bottom'

export type ReadingReason = 'disclosure' | 'initializing' | 'navigation' | 'restored-anchor' | 'user-scrolled-up'

export type ViewportFollowState =
  | { readonly mode: 'following'; readonly reason: FollowingReason }
  | { readonly mode: 'reading'; readonly reason: ReadingReason }

export interface ViewportFollowController {
  getState(): ViewportFollowState
  isFollowing(): boolean
  enterFollowing(reason: FollowingReason): void
  enterReading(reason: ReadingReason): void
}

/**
 * The single product-level source of truth for message-list scroll behavior.
 *
 * Geometry, streaming lifecycle, virtualizer compensation and local sends do
 * not transition this state. Only explicit reading intent or an explicit
 * return to the live edge may change it.
 */
export function useViewportFollowState(): ViewportFollowController {
  // Start detached until scroll-position restoration chooses a saved reading
  // anchor or the live bottom. This prevents mount-time measurements from
  // racing the restore decision.
  const stateRef = useRef<ViewportFollowState>({ mode: 'reading', reason: 'initializing' })

  const getState = useCallback(() => stateRef.current, [])
  const isFollowing = useCallback(() => stateRef.current.mode === 'following', [])
  const enterFollowing = useCallback((reason: FollowingReason) => {
    stateRef.current = { mode: 'following', reason }
  }, [])
  const enterReading = useCallback((reason: ReadingReason) => {
    stateRef.current = { mode: 'reading', reason }
  }, [])

  return useMemo(
    () => ({ enterFollowing, enterReading, getState, isFollowing }),
    [enterFollowing, enterReading, getState, isFollowing]
  )
}
