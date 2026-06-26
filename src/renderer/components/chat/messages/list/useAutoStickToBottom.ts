/**
 * Auto-stick-to-bottom: on every content size change, if the user was at
 * the bottom and content grew, stick to the new bottom. Visible growth follows
 * the bottom with a per-frame speed limit so line-wrap renders do not produce
 * one sudden scroll jump. Yields to a higher-priority scroll owner (the
 * scroll anchor) via the injected `isLocked()` predicate — the orchestrator
 * owns precedence; this hook doesn't know about anchors.
 */

import { type RefObject, useCallback, useMemo, useRef } from 'react'

import { getDistanceToBottom, getRealBottom } from './scrollGeometry'
import type { SmoothScrollController } from './useSmoothScrollAnimation'

const BOTTOM_FOLLOW_MIN_STEP_PX = 4
const BOTTOM_FOLLOW_DAMPING = 0.32
// Beyond this many viewports behind the live edge, a per-frame-capped crawl
// takes long enough that the bottom appears to "rubber-band" away from the
// newest content. A one-shot jump that large (a big code block or table that
// renders all at once) is snapped straight to the live bottom instead; ordinary
// streaming growth stays well under this and keeps its smooth crawl.
const BOTTOM_FOLLOW_SNAP_DISTANCE_VIEWPORTS = 3

function getBottomFollowMaxStep(element: HTMLElement): number {
  return Math.max(48, Math.min(96, element.clientHeight * 0.12))
}

export interface AutoStickInputs {
  scrollerRef: RefObject<HTMLElement | null>
  getBottomInset?(): number
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
  getBottomInset,
  smoothScroll,
  isAtBottom,
  isLocked,
  markStuck
}: AutoStickInputs): AutoStickToBottom {
  const lastScrollSizeRef = useRef(0)

  const targetBottom = useCallback(() => {
    const el = scrollerRef.current
    if (!el) return 0
    return getRealBottom(el, getBottomInset?.() ?? 0)
  }, [getBottomInset, scrollerRef])

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
    // Too far behind for a graceful crawl — snap to the live bottom so the user
    // never watches the newest content drift away while the animation catches up.
    if (getDistanceToBottom(el, getBottomInset?.() ?? 0) > el.clientHeight * BOTTOM_FOLLOW_SNAP_DISTANCE_VIEWPORTS) {
      el.scrollTop = targetBottom()
      markStuck()
      return
    }
    smoothScroll.followTo(targetBottom, {
      maxStep: getBottomFollowMaxStep(el),
      minStep: BOTTOM_FOLLOW_MIN_STEP_PX,
      damping: BOTTOM_FOLLOW_DAMPING
    })
    markStuck()
  }, [getBottomInset, isAtBottom, isLocked, markStuck, scrollerRef, smoothScroll, targetBottom])

  return useMemo(() => ({ onContentSizeChange }), [onContentSizeChange])
}
