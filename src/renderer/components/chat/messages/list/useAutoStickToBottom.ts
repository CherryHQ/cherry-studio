/**
 * Auto-stick-to-bottom: on every content size change, if the user was at
 * the bottom and content grew, scroll smoothly to the new bottom. Yields
 * to a higher-priority scroll owner (the scroll anchor) via the injected
 * `isLocked()` predicate — the orchestrator owns precedence; this hook
 * doesn't know about anchors.
 */

import { type RefObject, useCallback, useMemo, useRef } from 'react'

import type { SmoothScrollController } from './useSmoothScrollAnimation'

export interface AutoStickInputs {
  scrollerRef: RefObject<HTMLElement | null>
  smoothScroll: SmoothScrollController
  isAtBottom(): boolean
  /** When true, auto-stick yields — another owner (e.g. scroll anchor) controls scrollTop. */
  isLocked(): boolean
  /** Called after we initiate a programmatic stick so the at-bottom tracker can update. */
  markStuck(): void
}

export interface AutoStickToBottom {
  /** Caller invokes on every observed content size change. */
  onContentSizeChange(): void
}

export function useAutoStickToBottom({
  scrollerRef,
  smoothScroll,
  isAtBottom,
  isLocked,
  markStuck
}: AutoStickInputs): AutoStickToBottom {
  const lastScrollSizeRef = useRef(0)

  const targetBottom = useCallback(() => {
    const el = scrollerRef.current
    return el ? Math.max(0, el.scrollHeight - el.clientHeight) : 0
  }, [scrollerRef])

  const onContentSizeChange = useCallback(() => {
    const el = scrollerRef.current
    if (!el) return
    const prev = lastScrollSizeRef.current
    const curr = el.scrollHeight
    if (curr === prev) return
    lastScrollSizeRef.current = curr
    if (isLocked()) return
    if (!isAtBottom()) return
    if (curr <= prev) return
    // A live manual smooth-scroll (BackBottom button) re-samples its target
    // every frame and will catch up to the new bottom; jumping in with an
    // instant snap mid-animation would fight it.
    if (smoothScroll.isAnimating()) return
    // Instant snap rather than starting a ~830ms RAF animation per chunk —
    // the long animation window let scroll events fire after the spacer/anchor
    // bookkeeping had reset, intermittently latching user-scrolled-up.
    el.scrollTop = targetBottom()
    markStuck()
  }, [isAtBottom, isLocked, markStuck, scrollerRef, smoothScroll, targetBottom])

  return useMemo(() => ({ onContentSizeChange }), [onContentSizeChange])
}
