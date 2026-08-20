import type { RefObject } from 'react'
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'

type UseScrollEndReachedOptions = {
  /** Current row count. A change re-arms the edge trigger so the next near-end pass can fire again. */
  itemCount: number
  /** Distance in px from the bottom at which the scroller counts as "near end". */
  thresholdPx: number
  /** Invoked once per near-end entry — drives cursor-paged loading. Omit to disable. */
  onEndReached?: () => void
}

/**
 * Edge-triggered near-bottom detection for cursor-paged scrollers.
 *
 * Fires `onEndReached` once when the scroller enters the near-end zone, then
 * stays silent until the scroller leaves the zone or `itemCount` changes
 * (a loaded page re-arms the trigger). An internal ResizeObserver on the
 * scroller and its content re-checks on layout changes, so a viewport taller
 * than the first page keeps auto-filling without scroll events.
 *
 * Returns `checkEndReached` for the scroller's scroll handler; it defaults to
 * reading `scrollElementRef` but accepts the event's element directly.
 */
export function useScrollEndReached(
  scrollElementRef: RefObject<HTMLElement | null>,
  { itemCount, thresholdPx, onEndReached }: UseScrollEndReachedOptions
): (element?: HTMLElement | null) => void {
  const onEndReachedRef = useRef(onEndReached)
  const wasNearEndRef = useRef(false)
  const observedStateRef = useRef<{ enabled: boolean; itemCount: number } | null>(null)
  const enabled = onEndReached !== undefined

  useLayoutEffect(() => {
    onEndReachedRef.current = onEndReached
  }, [onEndReached])

  const checkEndReached = useCallback(
    (element = scrollElementRef.current) => {
      const callback = onEndReachedRef.current
      if (!element || !callback) return
      if (element.clientHeight <= 0 || element.scrollHeight <= 0) return
      const isNearEnd = element.scrollTop + element.clientHeight >= element.scrollHeight - thresholdPx
      if (!isNearEnd) {
        wasNearEndRef.current = false
        return
      }
      if (wasNearEndRef.current) return

      wasNearEndRef.current = true
      callback()
    },
    [scrollElementRef, thresholdPx]
  )

  useEffect(() => {
    const observedState = observedStateRef.current
    if (!observedState || observedState.enabled !== enabled || observedState.itemCount !== itemCount) {
      wasNearEndRef.current = false
    }
    observedStateRef.current = { enabled, itemCount }
    checkEndReached()

    const element = scrollElementRef.current
    if (!element || !enabled || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => checkEndReached(element))
    observer.observe(element)
    if (element.firstElementChild) observer.observe(element.firstElementChild)
    return () => observer.disconnect()
  }, [checkEndReached, enabled, itemCount, scrollElementRef])

  return checkEndReached
}
