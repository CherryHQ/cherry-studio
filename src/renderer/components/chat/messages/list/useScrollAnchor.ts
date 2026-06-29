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
 * viewportHeight <= scrollSize` holds. On pin it is over-allocated to at
 * least a full viewport so the message reliably reaches the top even before
 * virtua has measured the freshly inserted items (its offset table is
 * briefly an estimate, which would otherwise leave too little scroll range
 * and strand the message near the bottom). Once the content settles it is
 * tightened to exactly the room needed, so the scrollbar comes to rest at
 * the bottom. After the first post-pin measurement tightens the bootstrap
 * spacer, it is not shrunk while content is actively growing (a streaming
 * chunk), because changing scrollHeight under the viewport can visibly jitter.
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
// While pinned, snap scrollTop back to the anchor when a programmatic scroll has
// drifted it by more than this. Kept above subpixel/rounding noise so an
// already-aligned pin never churns.
const REASSERT_TOLERANCE_PX = 2
// How far into the virtualizer's own items (i.e. excluding `startMargin`) the
// anchored item can sit and still count as "already at the top". When the item
// is this close to the virtualizer's start, scrollTop ≈ startMargin already
// places it at the viewport top, so the spacer is redundant. The threshold is
// applied as `startMargin + ANCHOR_NEAR_TOP_PX` (see `onContentSizeChange`)
// because the anchor offset includes `startMargin`; a bare constant would never
// fire under a tall top inset (e.g. a floating immersive navbar).
const ANCHOR_NEAR_TOP_PX = 24

export interface ScrollAnchorInputs {
  scrollerRef: RefObject<HTMLElement | null>
  contentRef?: RefObject<HTMLElement | null>
  vlistHandleRef: RefObject<VListHandle | null>
  smoothScroll: SmoothScrollController
  /** Real content rendered before the virtualizer (matches virtua's `startMargin`). */
  startMargin?: number
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
  /**
   * Caller invokes on every scroll event with current scrollTop. `isUserInitiated`
   * is REQUIRED (no default) so every call site must declare provenance: pass
   * `false` for programmatic scrolls (virtua remeasure jumps, content
   * `scrollIntoView`) so they can't release the pin — only a real wheel / drag /
   * touch should. A forgotten flag would silently re-introduce the mid-stream
   * pin-drop bug, so it must be explicit rather than fail-open.
   */
  onUserScroll(offset: number, isUserInitiated: boolean): void
}

export function useScrollAnchor({
  scrollerRef,
  contentRef,
  vlistHandleRef,
  smoothScroll,
  startMargin = 0
}: ScrollAnchorInputs): ScrollAnchor {
  // dataIndex of the pinned item, or null if not pinned.
  const anchorIndexRef = useRef<number | null>(null)
  // Last known offset of the anchored item — used to detect user scroll-away.
  const anchorOffsetRef = useRef<number>(0)
  // Natural (non-spacer) scroll size at the previous pinned size check. Lets us
  // tell a measurement settle (safe to tighten the spacer) from a streaming
  // chunk (hold it, to avoid jitter).
  const lastPinnedNaturalRef = useRef(0)
  const shouldTightenInitialSpacerRef = useRef(false)
  const [spacerHeight, setSpacerHeight] = useState(0)
  // The spacer is appended after data items, so wrappedIdx for a data
  // item is identical to its data index. The orchestrator passes us the
  // wrapped scrollToIndex via vlistHandleRef.

  // virtua's `scrollToIndex(i, 'start')` scrolls to `startMargin + getItemOffset(i)`
  // (startMargin = the real content rendered before the virtualizer, e.g. the top
  // padding spacer). The pinned scrollTop — and therefore the spacer math and the
  // scroll-away test — must include it; `getItemOffset` alone omits it, which would
  // leave the spacer `startMargin` px short and let the browser clamp scrollTop
  // (the message drifts down by the top padding once the spacer tightens).
  const getAnchorScrollOffset = useCallback(
    (dataIndex: number): number | null => {
      const handle = vlistHandleRef.current
      if (!handle) return null
      return Math.max(0, startMargin) + handle.getItemOffset(dataIndex)
    },
    [startMargin, vlistHandleRef]
  )

  const getNaturalScrollableSize = useCallback((): number => {
    const el = scrollerRef.current
    const handle = vlistHandleRef.current
    if (!el || !handle) return 0
    // `virtua`'s handle.scrollSize only covers its measured item table.
    // The content wrapper includes top/bottom padding and the rendered spacer,
    // without the scroller's `scrollHeight >= clientHeight` floor that makes
    // tall viewports look like tall content.
    const contentScrollHeight = contentRef?.current?.scrollHeight ?? 0
    const scrollHeight = contentScrollHeight > 0 ? contentScrollHeight : el.scrollHeight
    return Math.max(0, scrollHeight - spacerHeight)
  }, [contentRef, scrollerRef, spacerHeight, vlistHandleRef])

  const computeNeededSpacer = useCallback((): number => {
    const el = scrollerRef.current
    const dataIdx = anchorIndexRef.current
    if (!el || dataIdx == null) return 0
    const anchorOffset = getAnchorScrollOffset(dataIdx)
    if (anchorOffset == null) return 0
    const viewport = el.clientHeight
    const natural = getNaturalScrollableSize()
    return Math.max(0, anchorOffset + viewport - natural)
  }, [getAnchorScrollOffset, getNaturalScrollableSize, scrollerRef])

  const pinTo = useCallback(
    (dataIndex: number) => {
      const el = scrollerRef.current
      const handle = vlistHandleRef.current
      if (!el || !handle) return
      anchorIndexRef.current = dataIndex
      anchorOffsetRef.current = getAnchorScrollOffset(dataIndex) ?? 0
      // The freshly inserted message may not be measured by virtua yet, so
      // `getItemOffset` (hence `needed`) can read low and leave too little
      // scroll range to lift it to the top — stranding it near the bottom.
      // Over-allocate the spacer to at least a full viewport so the range is
      // always sufficient; the ResizeObserver pass below tightens it down to
      // `needed` once the content settles, so the scrollbar still ends at the
      // bottom.
      const needed = computeNeededSpacer()
      setSpacerHeight(Math.max(el.clientHeight, needed))
      lastPinnedNaturalRef.current = getNaturalScrollableSize()
      shouldTightenInitialSpacerRef.current = true
      // Scroll the message to the top after the spacer-applying render commits.
      // The spacer is appended last, so the message's wrapped index is still
      // `dataIndex`; virtua resolves the real offset once measured and
      // re-positions next frame. Keep it instant — a browser smooth scroll emits
      // intermediate scroll events that look like the user leaving the anchor and
      // would release the pin.
      requestAnimationFrame(() => {
        const h = vlistHandleRef.current
        if (!h) return
        h.scrollToIndex(dataIndex, { align: 'start' })
        anchorOffsetRef.current = getAnchorScrollOffset(dataIndex) ?? anchorOffsetRef.current
      })
    },
    [computeNeededSpacer, getAnchorScrollOffset, getNaturalScrollableSize, scrollerRef, vlistHandleRef]
  )

  const release = useCallback(() => {
    anchorIndexRef.current = null
    shouldTightenInitialSpacerRef.current = false
    // Don't reset spacerHeight here — content will grow into it (size-change
    // handler decays it). Snapping to 0 would jump scrollTop downward.
  }, [])

  const onContentSizeChange = useCallback(() => {
    const el = scrollerRef.current
    const handle = vlistHandleRef.current
    if (!el || !handle) return

    if (anchorIndexRef.current != null) {
      // Refresh known anchor offset from virtua's measured table.
      anchorOffsetRef.current = getAnchorScrollOffset(anchorIndexRef.current) ?? anchorOffsetRef.current
      // If the anchored item is already at (or essentially at) the top of
      // the natural scroll range, no spacer is needed — scrollTop ≈ startMargin
      // already places it at the viewport top. Without this, a short assistant
      // reply leaves a viewport-minus-natural spacer in place forever, creating
      // a scrollable phantom area below the (already-fully-visible) content. The
      // threshold scales with `startMargin` so it still fires under a tall top
      // inset (the anchor offset includes `startMargin`).
      if (anchorOffsetRef.current <= Math.max(0, startMargin) + ANCHOR_NEAR_TOP_PX) {
        if (spacerHeight !== 0) setSpacerHeight(0)
        anchorIndexRef.current = null
        shouldTightenInitialSpacerRef.current = false
        return
      }
      const naturalNow = getNaturalScrollableSize()
      const contentGrew = naturalNow > lastPinnedNaturalRef.current
      lastPinnedNaturalRef.current = naturalNow
      const needed = computeNeededSpacer()
      if (needed === 0) {
        // The reply outgrew the space below the pinned message (content fills at
        // least a viewport). Release the pin so the caller can hand the turn over
        // to bottom-follow — this happens DURING streaming, not only after, so a
        // long reply sticks to the bottom instead of staying frozen at the top.
        if (spacerHeight !== 0) setSpacerHeight(0)
        anchorIndexRef.current = null
        shouldTightenInitialSpacerRef.current = false
      } else if (needed > spacerHeight) {
        setSpacerHeight(needed)
        shouldTightenInitialSpacerRef.current = false
      } else if (needed < spacerHeight && (!contentGrew || shouldTightenInitialSpacerRef.current)) {
        // Content is stable (a measurement settle, not a streaming chunk): the
        // pin's viewport over-allocation can be tightened to exactly the room
        // needed so the scrollbar rests at the bottom. The first observed pass
        // after pinning may include virtua measurement growth, so tighten that
        // initial full-viewport bootstrap once even if the natural size grew.
        setSpacerHeight(needed)
        shouldTightenInitialSpacerRef.current = false
      } else {
        shouldTightenInitialSpacerRef.current = false
      }
      // Re-assert the pinned position. virtua / content can nudge scrollTop
      // forward during streaming (a remeasure jump, a child `scrollIntoView`),
      // which neither the spacer math nor the input-gated release corrects — left
      // alone it drifts the user message (and the history above it) off the top.
      // Snap it back to the anchor each resize; a no-op when already aligned, and
      // the resulting scroll event is flagged non-user so it can't release.
      if (anchorIndexRef.current != null && !smoothScroll.isAnimating()) {
        const target = anchorOffsetRef.current
        if (Math.abs(el.scrollTop - target) > REASSERT_TOLERANCE_PX) {
          el.scrollTop = target
        }
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
  }, [
    computeNeededSpacer,
    getAnchorScrollOffset,
    getNaturalScrollableSize,
    scrollerRef,
    smoothScroll,
    spacerHeight,
    startMargin,
    vlistHandleRef
  ])

  const onUserScroll = useCallback(
    (offset: number, isUserInitiated: boolean) => {
      const dataIdx = anchorIndexRef.current
      if (dataIdx == null) return
      // smoothScroll's own writes also fire scroll events; ignore them.
      if (smoothScroll.isAnimating()) return
      // virtua emits scroll events not only on user input but also when it
      // jump-compensates for items measured above the viewport — e.g. a buffered
      // history message resolving from its size estimate to its real (usually
      // shorter) height. That compensation lowers scrollTop AND the anchored
      // item's offset by the same delta, so the message stays visually put on a
      // tall viewport whose large overscan keeps many such items mounted. Refresh
      // the anchor offset from virtua's measured table before the scroll-away
      // test so that delta cancels; only a genuine user scroll moves scrollTop
      // away from the item's current offset and releases the pin.
      const liveAnchorOffset = getAnchorScrollOffset(dataIdx)
      if (liveAnchorOffset != null) anchorOffsetRef.current = liveAnchorOffset
      const deviated = Math.abs(offset - anchorOffsetRef.current) > RELEASE_TOLERANCE_PX
      // Only a genuine user scroll (wheel / drag / touch, flagged by the
      // orchestrator) releases the pin. Programmatic scrolls — a virtua remeasure
      // jump, a content `scrollIntoView`, our own re-assert below — also fire
      // scroll events; treating those as "user scrolled away" is exactly what let
      // the pin drop mid-stream and the view run off to follow the bottom.
      const willRelease = deviated && isUserInitiated
      if (willRelease) {
        anchorIndexRef.current = null
      }
    },
    [getAnchorScrollOffset, smoothScroll]
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
