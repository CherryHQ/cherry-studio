/**
 * Scroll anchor: pin a list item to the viewport top.
 *
 * Implementation: append a spacer item to the virtualizer's data array.
 * virtua measures the spacer like any other item and includes it in the
 * offset table, so:
 *   - `scrollSize` extends naturally; we don't fight CSS padding
 *   - `scrollToIndex(anchorIdx, 'start')` works out of the box; virtua
 *     resolves the offset from its measured position (no manual DOM
 *     querying, no `getItemOffset` arithmetic, no estimated-vs-real race)
 *   - Selection-survival `keepMounted` indices stay valid (the spacer is
 *     always the last item; data indices are unaffected)
 *
 * The spacer height is maintained so the invariant `anchorOffset +
 * viewportHeight <= scrollSize` holds. While pinned, the spacer is
 * monotonic: it grows only when the natural scroll range is not enough to
 * keep the user message at the top. It is not shrunk per streaming chunk,
 * because changing scrollHeight under the viewport can visibly jitter.
 *
 * Release triggers:
 *   - User scrolls more than `RELEASE_TOLERANCE_PX` away from the anchor
 *   - Natural content has grown enough that the anchor is satisfied and
 *     the spacer can be removed without clamping the current scrollTop
 *   - External caller invokes `release()`
 */

import { type RefObject, useCallback, useMemo, useRef, useState } from 'react'
import type { VListHandle } from 'virtua'

import type { SmoothScrollController } from './useSmoothScrollAnimation'

const RELEASE_TOLERANCE_PX = 16
// Anchor offsets at or below this count as "already at the top" — typically
// the virtualizer's top padding. When the anchored item is here, scrollTop=0
// already places it at the viewport top, so the spacer is redundant.
const ANCHOR_NEAR_TOP_PX = 24

export interface ScrollAnchorInputs {
  scrollerRef: RefObject<HTMLElement | null>
  vlistHandleRef: RefObject<VListHandle | null>
  smoothScroll: SmoothScrollController
  canRelease(): boolean
}

export interface ScrollAnchor {
  /** Height of the spacer item to append to the virtualizer's data array. 0 = no spacer. */
  spacerHeight: number
  /** True when an anchor is currently pinned. */
  isPinned(): boolean
  /**
   * Pin the data item at `dataIndex` to the viewport top. `dataIndex` is
   * the index in the ORIGINAL items array (not the wrapped one — the
   * spacer is always at the end, so wrapped index equals data index for
   * data items).
   *
   * Must be invoked AFTER the wrapped items containing the spacer are
   * rendered (otherwise virtua's scrollSize hasn't extended yet).
   */
  pinTo(dataIndex: number): void
  /** Release the pin (does not reset spacer height; lets content fill it). */
  release(): void
  /** Caller invokes on every observed content size change (ResizeObserver). */
  onContentSizeChange(): void
  /** Caller invokes on every scroll event with current scrollTop. */
  onUserScroll(offset: number): void
}

export function useScrollAnchor({
  scrollerRef,
  vlistHandleRef,
  smoothScroll,
  canRelease
}: ScrollAnchorInputs): ScrollAnchor {
  // dataIndex of the pinned item, or null if not pinned.
  const anchorIndexRef = useRef<number | null>(null)
  // Last known offset of the anchored item — used to detect user scroll-away.
  const anchorOffsetRef = useRef<number>(0)
  const [spacerHeight, setSpacerHeight] = useState(0)
  // The spacer is appended after data items, so wrappedIdx for a data
  // item is identical to its data index. The orchestrator passes us the
  // wrapped scrollToIndex via vlistHandleRef.

  const getNaturalScrollableSize = useCallback((): number => {
    const el = scrollerRef.current
    const handle = vlistHandleRef.current
    if (!el || !handle) return 0
    // `virtua`'s handle.scrollSize only covers its measured item table.
    // The real scroller also includes CSS padding from the composer inset,
    // so use DOM scrollHeight when deciding how much spacer is still needed.
    return Math.max(0, el.scrollHeight - spacerHeight)
  }, [scrollerRef, spacerHeight, vlistHandleRef])

  const computeNeededSpacer = useCallback((): number => {
    const el = scrollerRef.current
    const handle = vlistHandleRef.current
    const dataIdx = anchorIndexRef.current
    if (!el || !handle || dataIdx == null) return 0
    const anchorOffset = handle.getItemOffset(dataIdx)
    const viewport = el.clientHeight
    const natural = getNaturalScrollableSize()
    return Math.max(0, anchorOffset + viewport - natural)
  }, [getNaturalScrollableSize, scrollerRef, vlistHandleRef])

  const pinTo = useCallback(
    (dataIndex: number) => {
      const el = scrollerRef.current
      const handle = vlistHandleRef.current
      if (!el || !handle) return
      anchorIndexRef.current = dataIndex
      anchorOffsetRef.current = handle.getItemOffset(dataIndex)
      // The user message has just been rendered; virtua may not have measured
      // it yet, but its index into the WRAPPED items is still dataIndex
      // (spacer goes at the end). Use scrollToIndex — virtua handles the
      // measurement race internally and re-positions on next frame if needed.
      //
      // Size the spacer to exactly the room still needed to bring the anchored
      // message to the top — no more. That makes scrollSize == anchorOffset +
      // viewport, so the user message sits at the top AND the scrollbar rests
      // at the bottom: the blank below is exactly one viewport minus the user
      // message and the reply placeholder, which is where the answer streams
      // in. A previous `Math.max(viewport, needed)` floor over-reserved a whole
      // extra viewport, leaving a too-tall blank with the scrollbar stuck
      // mid-track until the reply grew (or the pin released).
      const needed = computeNeededSpacer()
      setSpacerHeight(needed)
      // Schedule the scroll for after the spacer-applying render commits.
      // RAF is enough because virtua's scrollToIndex resolves the item offset
      // after the spacer-applying render has committed. Keep this instant:
      // browser smooth-scroll emits intermediate scroll events that look like
      // the user leaving the anchor and can release the pin.
      requestAnimationFrame(() => {
        const h = vlistHandleRef.current
        if (!h) return
        h.scrollToIndex(dataIndex, { align: 'start' })
        anchorOffsetRef.current = h.getItemOffset(dataIndex)
      })
    },
    [computeNeededSpacer, scrollerRef, vlistHandleRef]
  )

  const release = useCallback(() => {
    anchorIndexRef.current = null
    // Don't reset spacerHeight here — content will grow into it (size-change
    // handler decays it). Snapping to 0 would jump scrollTop downward.
  }, [])

  const onContentSizeChange = useCallback(() => {
    const el = scrollerRef.current
    const handle = vlistHandleRef.current
    if (!el || !handle) return

    if (anchorIndexRef.current != null) {
      // Refresh known anchor offset from virtua's measured table.
      anchorOffsetRef.current = handle.getItemOffset(anchorIndexRef.current)
      // If the anchored item is already at (or essentially at) the top of
      // the natural scroll range, no spacer is needed — scrollTop=0 already
      // places it at the viewport top. Without this, a short assistant reply
      // leaves a viewport-minus-natural spacer in place forever, creating
      // a scrollable phantom area below the (already-fully-visible) content.
      if (anchorOffsetRef.current <= ANCHOR_NEAR_TOP_PX) {
        if (spacerHeight !== 0) setSpacerHeight(0)
        anchorIndexRef.current = null
        return
      }
      const needed = computeNeededSpacer()
      if (needed === 0 && canRelease()) {
        if (spacerHeight !== 0) setSpacerHeight(0)
        anchorIndexRef.current = null
      } else if (needed > spacerHeight) {
        setSpacerHeight(needed)
      }
      return
    }

    // Not pinned: decay leftover spacer as natural content grows into it.
    if (spacerHeight > 0) {
      // Heuristic decay: shrink the spacer by however much the natural
      // (non-spacer) scroll size grew. Read scrollSize once.
      // Since we don't have prev natural recorded here, do simple decay:
      // recompute "needed if we were still pinned" using the last known
      // anchor offset; if smaller, shrink toward 0.
      const naturalAvailable = getNaturalScrollableSize()
      const wouldBeNeeded = Math.max(0, anchorOffsetRef.current + el.clientHeight - naturalAvailable)
      if (wouldBeNeeded < spacerHeight) {
        setSpacerHeight(wouldBeNeeded)
      }
    }
  }, [canRelease, computeNeededSpacer, getNaturalScrollableSize, scrollerRef, spacerHeight, vlistHandleRef])

  const onUserScroll = useCallback(
    (offset: number) => {
      if (anchorIndexRef.current == null) return
      // smoothScroll's own writes also fire scroll events; ignore them.
      if (smoothScroll.isAnimating()) return
      if (Math.abs(offset - anchorOffsetRef.current) > RELEASE_TOLERANCE_PX) {
        anchorIndexRef.current = null
      }
    },
    [smoothScroll]
  )

  const isPinned = useCallback(() => anchorIndexRef.current != null, [])

  return useMemo(
    () => ({
      spacerHeight,
      isPinned,
      pinTo,
      release,
      onContentSizeChange,
      onUserScroll
    }),
    [isPinned, onContentSizeChange, onUserScroll, pinTo, release, spacerHeight]
  )
}
