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

import { createContext, type ReactNode, use } from 'react'

const ScrollOwnershipContext = createContext(false)

export const ScrollOwnershipProvider = ({ children }: { children: ReactNode }) => {
  return <ScrollOwnershipContext value={true}>{children}</ScrollOwnershipContext>
}

/** True when the message-list runtime owns scroll stability for this subtree. */
export function useIsScrollRuntimeManaged(): boolean {
  return use(ScrollOwnershipContext)
}
