/**
 * Scroll-ownership context — lets collapsible blocks coordinate with the
 * message-list runtime over who writes the scroller's `scrollTop`.
 *
 * The virtual-list runtime (`chatVirtualizerRuntime`) is the single authority
 * over `scrollTop` while it streams (top-pin), follows the bottom, or animates a
 * scroll. A collapsible block's own `useScrollAnchor` also writes `scrollTop` on
 * expand/collapse to keep the toggled block visually fixed. When both write in
 * the same frame — to different targets — the scrollbar jitters.
 *
 * The runtime publishes `isScrollOwned()` here; `useScrollAnchor` reads it and
 * yields (skips its restore) while the runtime is in charge. Outside the list
 * (no provider) the predicate is `false`, so blocks keep their standalone anchor
 * behavior.
 *
 * The runtime also exposes `releaseScrollOwnership()`: an EXPAND is a user intent
 * to read the freshly revealed content, so the block asks the runtime to
 * relinquish bottom-follow / smooth-scroll ownership and then holds its own
 * position instead of letting the live stream scroll it away.
 */

import { createContext, type ReactNode, use, useMemo } from 'react'

/** True while the message-list runtime is the authoritative `scrollTop` writer. */
export type IsScrollOwned = () => boolean

export interface ScrollOwnership {
  isScrollOwned: IsScrollOwned
  /**
   * Ask the runtime to relinquish bottom-follow / smooth-scroll ownership so a
   * block the user just expanded can hold its position instead of being scrolled
   * away by the live stream. A NO-OP while a top-pin is active (that case already
   * keeps the view stable), so callers must re-check `isScrollOwned()` after.
   */
  releaseScrollOwnership: () => void
}

const NOOP = () => {}
const NEVER_OWNED: IsScrollOwned = () => false
/** Stable value for blocks rendered outside the virtual list (no provider). */
const STANDALONE: ScrollOwnership = { isScrollOwned: NEVER_OWNED, releaseScrollOwnership: NOOP }

const ScrollOwnershipContext = createContext<ScrollOwnership | null>(null)

export const ScrollOwnershipProvider = ({
  isScrollOwned,
  releaseScrollOwnership = NOOP,
  children
}: {
  isScrollOwned: IsScrollOwned
  releaseScrollOwnership?: () => void
  children: ReactNode
}) => {
  // Both inputs are ref-backed stable callbacks from the runtime, so the value
  // identity survives unrelated rerenders — the block tree doesn't churn.
  const value = useMemo<ScrollOwnership>(
    () => ({ isScrollOwned, releaseScrollOwnership }),
    [isScrollOwned, releaseScrollOwnership]
  )
  return <ScrollOwnershipContext value={value}>{children}</ScrollOwnershipContext>
}

/**
 * Scroll-ownership handle telling a collapsible block whether the message-list
 * runtime currently owns `scrollTop` and letting it reclaim ownership on expand.
 * Falls back to a stable standalone value (never owned, release is a no-op) when
 * no provider is mounted, preserving standalone anchor behavior.
 */
export function useScrollOwnership(): ScrollOwnership {
  return use(ScrollOwnershipContext) ?? STANDALONE
}
