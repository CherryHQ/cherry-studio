/**
 * RAF-driven smooth scroll for the chat virtualizer.
 *
 * Native `behavior: 'smooth'` on `scrollTo` is unsuitable for follow-the-
 * stream UX: the browser owns the animation curve, can't be cancelled
 * mid-flight, and races with size growth — every new token would queue
 * another smooth-scroll on top of the in-flight one.
 *
 * This hook drives the scroll target frame-by-frame and cancels cleanly
 * when the user wheels upward. Behavior modeled on message-list's `vi`
 * (wakaru-unpacked/06-cell-graph-and-actions.js:1279-1418): each frame
 * resamples the target (so streaming growth keeps the destination
 * current) and applies an easing curve over a fixed frame budget.
 */

import { type RefObject, useCallback, useEffect, useMemo, useRef } from 'react'

export interface SmoothScrollOptions {
  /** Total frames for the animation. Default 50 (~830 ms at 60 fps). */
  frames?: number
  /**
   * Easing function mapping t (0..1) to progress (0..1).
   * Default: 1 - 2^(-10 t) — message-list's "ease-out exp" curve.
   */
  easing?: (t: number) => number
}

export interface SmoothScrollController {
  /**
   * Start an animation toward `getTargetOffset()`. The target is resampled
   * each frame so the animation follows a moving destination (e.g. when
   * content keeps growing during a stream).
   */
  scrollTo(getTargetOffset: () => number, options?: SmoothScrollOptions): void
  /** Cancel any in-flight animation. */
  cancel(): void
  /** Whether an animation is currently in flight. */
  isAnimating(): boolean
}

const DEFAULT_FRAMES = 50
const DEFAULT_EASING = (t: number): number => 1 - 2 ** (-10 * t)

type RafLike = (cb: FrameRequestCallback) => number
type CafLike = (handle: number) => void

interface UseSmoothScrollAnimationOptions {
  /**
   * Overrides for testing — defaults to global requestAnimationFrame /
   * cancelAnimationFrame. Production code should not pass these.
   */
  raf?: RafLike
  caf?: CafLike
}

/**
 * Smooth-scroll controller bound to `scrollerRef`. Caller is responsible
 * for triggering cancel on user wheel-up (subscribe to wheel events on
 * the same element and call `cancel()` when direction reverses).
 */
export function useSmoothScrollAnimation(
  scrollerRef: RefObject<HTMLElement | null>,
  { raf, caf }: UseSmoothScrollAnimationOptions = {}
): SmoothScrollController {
  const rafIdRef = useRef<number | null>(null)
  const animatingRef = useRef(false)

  const requestFrame = useMemo<RafLike>(() => raf ?? ((cb) => requestAnimationFrame(cb)), [raf])
  const cancelFrame = useMemo<CafLike>(() => caf ?? ((id) => cancelAnimationFrame(id)), [caf])

  const cancel = useCallback(() => {
    if (rafIdRef.current != null) {
      cancelFrame(rafIdRef.current)
      rafIdRef.current = null
    }
    animatingRef.current = false
  }, [cancelFrame])

  const scrollTo = useCallback(
    (getTargetOffset: () => number, options: SmoothScrollOptions = {}) => {
      const el = scrollerRef.current
      if (!el) return

      // Cancel any previous animation; we always animate toward the latest
      // requested target rather than queueing them.
      if (rafIdRef.current != null) cancelFrame(rafIdRef.current)

      const frames = Math.max(1, options.frames ?? DEFAULT_FRAMES)
      const easing = options.easing ?? DEFAULT_EASING
      const startOffset = el.scrollTop
      let frame = 0

      animatingRef.current = true

      const step = (): void => {
        const node = scrollerRef.current
        if (!node) {
          animatingRef.current = false
          rafIdRef.current = null
          return
        }

        frame += 1
        const progress = Math.min(1, easing(frame / frames))
        const target = getTargetOffset()
        const next = startOffset + (target - startOffset) * progress

        node.scrollTop = next

        if (frame >= frames) {
          // Final frame snaps to the live target so a moving destination
          // (streaming growth) is fully caught up.
          node.scrollTop = getTargetOffset()
          animatingRef.current = false
          rafIdRef.current = null
          return
        }

        rafIdRef.current = requestFrame(step)
      }

      rafIdRef.current = requestFrame(step)
    },
    [cancelFrame, requestFrame, scrollerRef]
  )

  const isAnimating = useCallback(() => animatingRef.current, [])

  useEffect(() => {
    return () => cancel()
  }, [cancel])

  return useMemo(() => ({ scrollTo, cancel, isAnimating }), [cancel, isAnimating, scrollTo])
}
