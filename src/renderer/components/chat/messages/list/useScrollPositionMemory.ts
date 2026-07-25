/**
 * Per-topic / per-session scroll position memory for the message list.
 *
 * Switching topics (regular chat keys `ChatMain` by `topic.id`) and switching
 * agent sessions (the list keys by the session-derived topic id) both REMOUNT
 * the virtualizer. Without memory, every remount lands on the first message.
 *
 * Design (kept declarative): the heavy lifting is two pure functions —
 *   - `computeScrollAnchor` derives WHAT to persist from the scroll state;
 *   - `resolveRestoreTarget` derives WHERE to restore as a single virtua
 *     `scrollToIndex` target (item + alignment + offset).
 * The hook is just the glue that runs them at the right lifecycle moment.
 * Restoring always goes through `scrollToIndex` (never raw `scrollTop`) so
 * virtua's lazy measurement converges on both the saved anchor and the bottom
 * — a one-shot `scrollTop = scrollHeight - clientHeight` cannot reach the true
 * bottom of an unmeasured list, which is what left fresh topics short.
 *
 * Saves are suppressed from mount until the initial restore has settled, so
 * mount-time/layout scroll events can't overwrite the value we are about to
 * restore from (that overwrite is exactly what made the list jump to the top).
 */

import { cacheService } from '@data/CacheService'
import type { ChatScrollAnchor } from '@shared/data/cache/cacheValueTypes'
import { type RefObject, useCallback, useEffect, useRef } from 'react'
import type { VListHandle } from 'virtua'

export type { ChatScrollAnchor }

/**
 * A single `scrollToIndex` target. `align: 'start'` restores a saved anchor;
 * `align: 'end'` follows the newest message (the bottom / unsaved case).
 */
export interface RestoreTarget {
  index: number
  align: 'start' | 'end'
  offset: number
}

interface ComputeScrollAnchorArgs {
  /** Whether the list is currently pinned to the bottom. */
  atBottom: boolean
  /** Current scrollTop of the scroller. */
  scrollOffset: number
  /** Wrapped index of the top-most visible item (`handle.findItemIndex`). */
  topIndex: number
  /** Group key for a data index, or `null` for the spacer / out-of-range. */
  getKeyAtIndex: (index: number) => string | null
  /** Measured offset of an item from the start (`handle.getItemOffset`). */
  getOffsetAtIndex: (index: number) => number
}

/**
 * Derive the anchor to persist from the current scroll state. Returns `null`
 * (= "follow the latest message") when at the bottom or when the top-most
 * visible item is not a real message (e.g. the anchor spacer).
 */
export function computeScrollAnchor({
  atBottom,
  scrollOffset,
  topIndex,
  getKeyAtIndex,
  getOffsetAtIndex
}: ComputeScrollAnchorArgs): ChatScrollAnchor | null {
  if (atBottom) return null
  const key = getKeyAtIndex(topIndex)
  if (!key) return null
  const offset = Math.max(0, scrollOffset - getOffsetAtIndex(topIndex))
  return { key, offset }
}

/**
 * Resolve the saved value into a single `scrollToIndex` target. Falls back to
 * the newest message (end-aligned, offset by the bottom padding so the last
 * message clears the composer) when nothing is saved or the saved message no
 * longer exists.
 */
export function resolveRestoreTarget(
  saved: ChatScrollAnchor | null | undefined,
  findIndexByKey: (key: string) => number,
  lastIndex: number,
  bottomOffset: number
): RestoreTarget {
  if (saved) {
    const index = findIndexByKey(saved.key)
    if (index >= 0) return { index, align: 'start', offset: saved.offset }
  }
  return { index: lastIndex, align: 'end', offset: bottomOffset }
}

export interface ScrollPositionMemoryInputs {
  /** Topic id the list is showing (agent sessions use their derived topic id). */
  topicId: string | undefined
  /** Number of (data) items currently in the list. */
  itemCount: number
  /** Padding reserved below the last message (so the bottom clears the composer). */
  bottomPadding: number
  scrollerRef: RefObject<HTMLElement | null>
  vlistHandleRef: RefObject<VListHandle | null>
  /** Group key for a data index, or `null` for the spacer / out-of-range. */
  getDataKeyAtIndex: (index: number) => string | null
  /** Data index for a group key, or `-1` when absent. */
  findDataIndexByKey: (key: string) => number
  isAtBottom: () => boolean
  /** Mark the at-bottom tracker as stuck after restoring to the bottom. */
  notifyProgrammaticStick: () => void
  /** When true, restoring may position the list but must not re-enable bottom-follow. */
  suppressBottomFollow?: () => boolean
  /** Release any active scroll anchor pin before restoring. */
  releaseAnchor: () => void
  /** Whether a smooth-scroll animation is in flight (don't save mid-animation). */
  isAnimating: () => boolean
}

export interface ScrollPositionMemory {
  /**
   * Persist the current scroll position for the active topic.
   *
   * The cache is read at the next mount (after this list unmounts on a topic
   * switch), so it just needs to stay near-current — hence a leading-edge
   * throttle while scrolling rather than a debounce, whose pending write would
   * be lost on unmount. Pass `immediate` (from `onScrollEnd`) to bypass the
   * throttle and capture the exact resting position.
   */
  save: (immediate?: boolean) => void
}

const cacheKeyFor = (topicId: string) => `chat.scroll_anchor.${topicId}` as const
const SAVE_THROTTLE_MS = 200

export function useScrollPositionMemory(inputs: ScrollPositionMemoryInputs): ScrollPositionMemory {
  // Keep the latest inputs addressable from the stable callbacks/effect.
  const inputsRef = useRef(inputs)
  inputsRef.current = inputs

  // Suppress saving until the initial restore for this mount has settled.
  const suppressSaveRef = useRef(true)
  const didRestoreRef = useRef(false)
  const lastSaveAtRef = useRef(0)

  const save = useCallback((immediate = false) => {
    const i = inputsRef.current
    if (suppressSaveRef.current || !i.topicId) return
    const el = i.scrollerRef.current
    const handle = i.vlistHandleRef.current
    if (!el || !handle || i.isAnimating()) return
    const now = Date.now()
    if (!immediate && now - lastSaveAtRef.current < SAVE_THROTTLE_MS) return
    lastSaveAtRef.current = now
    const anchor = computeScrollAnchor({
      atBottom: i.isAtBottom(),
      scrollOffset: el.scrollTop,
      topIndex: handle.findItemIndex(el.scrollTop),
      getKeyAtIndex: i.getDataKeyAtIndex,
      getOffsetAtIndex: (index) => handle.getItemOffset(index)
    })
    cacheService.set(cacheKeyFor(i.topicId), anchor)
  }, [])

  // Restore once, as soon as the (remounted) list has items.
  const ready = inputs.itemCount > 0
  useEffect(() => {
    if (didRestoreRef.current || !ready) return
    didRestoreRef.current = true

    const i = inputsRef.current
    const saved = i.topicId ? cacheService.get(cacheKeyFor(i.topicId)) : null
    const target = resolveRestoreTarget(saved, i.findDataIndexByKey, i.itemCount - 1, i.bottomPadding)

    let settleRaf = 0
    const raf = requestAnimationFrame(() => {
      const el = i.scrollerRef.current
      const handle = i.vlistHandleRef.current
      if (handle) {
        i.releaseAnchor()
        handle.scrollToIndex(target.index, { align: target.align, offset: target.offset })
        // Following the newest message engages auto-stick so streaming keeps up.
        if (target.align === 'end' && !i.suppressBottomFollow?.()) i.notifyProgrammaticStick()
      } else if (el && target.align === 'end') {
        el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight)
        if (!i.suppressBottomFollow?.()) i.notifyProgrammaticStick()
      }
      // Let the programmatic scroll flush (virtua's scrollToIndex measures then
      // re-positions) before re-enabling saves.
      settleRaf = requestAnimationFrame(() => {
        suppressSaveRef.current = false
      })
    })

    return () => {
      cancelAnimationFrame(raf)
      if (settleRaf) cancelAnimationFrame(settleRaf)
    }
  }, [ready])

  return { save }
}
