/**
 * Scroll-ownership context — marks the subtree whose scroll stability is owned
 * by the message-list runtime.
 *
 * Inside the virtual list, `chatVirtualizerRuntime` is the single `scrollTop`
 * writer: while it drives (top-pin, bottom-follow, smooth scroll) it keeps the
 * view coherent itself, and once the user takes over (any pointer/keyboard
 * interaction inside the scroller) it freezes the viewport centrally against
 * every layout change. Either way a block must never write `scrollTop` — a
 * second writer in the same frame is what used to jitter the scrollbar.
 *
 * A block's `useScrollAnchor` therefore only checks for the provider's
 * presence: inside it, state updates apply directly; outside the list (no
 * provider) the standalone anchor behavior is preserved.
 */

import { createContext, type ReactNode, use, useMemo } from 'react'

interface ScrollOwnership {
  requestFollowRecovery: () => void
}

const ScrollOwnershipContext = createContext<ScrollOwnership | null>(null)
const NOOP = () => {}

export const ScrollOwnershipProvider = ({
  children,
  requestFollowRecovery = NOOP
}: {
  children: ReactNode
  requestFollowRecovery?: () => void
}) => {
  const value = useMemo(() => ({ requestFollowRecovery }), [requestFollowRecovery])
  return <ScrollOwnershipContext value={value}>{children}</ScrollOwnershipContext>
}

/** True when the message-list runtime owns scroll stability for this subtree. */
export function useIsScrollRuntimeManaged(): boolean {
  return use(ScrollOwnershipContext) !== null
}

/** Ask the list runtime to resume following after a local disclosure settles at the real bottom. */
export function useRequestScrollFollowRecovery(): () => void {
  return use(ScrollOwnershipContext)?.requestFollowRecovery ?? NOOP
}
