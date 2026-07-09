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
 */

import { createContext, type ReactNode, use } from 'react'

/** True while the message-list runtime is the authoritative `scrollTop` writer. */
export type IsScrollOwned = () => boolean

const ScrollOwnershipContext = createContext<IsScrollOwned | null>(null)

export const ScrollOwnershipProvider = ({
  isScrollOwned,
  children
}: {
  isScrollOwned: IsScrollOwned
  children: ReactNode
}) => <ScrollOwnershipContext value={isScrollOwned}>{children}</ScrollOwnershipContext>

const NEVER_OWNED: IsScrollOwned = () => false

/**
 * Predicate telling whether the message-list runtime currently owns `scrollTop`.
 * Falls back to a stable `() => false` when no provider is mounted (a block
 * rendered outside the virtual list), preserving standalone anchor behavior.
 */
export function useIsScrollOwned(): IsScrollOwned {
  return use(ScrollOwnershipContext) ?? NEVER_OWNED
}
