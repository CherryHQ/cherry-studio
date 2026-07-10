import { useCallback, useLayoutEffect, useRef, useState } from 'react'

const BOTTOM_TOLERANCE_PX = 12
const OVERFLOW_TOLERANCE_PX = 1

export interface ProcessRunAutoScroll {
  viewportRef: (element: HTMLDivElement | null) => void
  contentRef: (element: HTMLDivElement | null) => void
  /** Call immediately before an interaction that may change detail height. */
  pauseForInteraction: () => void
}

/**
 * Owns bottom-follow for a bounded process-detail viewport.
 *
 * This hook only writes the element passed to `viewportRef`; outer message-list
 * scrolling remains owned by the message-list runtime.
 */
export function useProcessRunAutoScroll(onFollowRestored?: () => void): ProcessRunAutoScroll {
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null)
  const [content, setContent] = useState<HTMLDivElement | null>(null)
  const viewportNodeRef = useRef<HTMLDivElement | null>(null)
  const frameRef = useRef<number | null>(null)
  const shouldFollowRef = useRef(true)
  const expectedScrollTopRef = useRef<number | null>(null)
  const lastObservedScrollTopRef = useRef(0)
  const onFollowRestoredRef = useRef(onFollowRestored)
  onFollowRestoredRef.current = onFollowRestored

  const setShouldFollow = useCallback((shouldFollow: boolean) => {
    const wasFollowing = shouldFollowRef.current
    shouldFollowRef.current = shouldFollow
    if (!wasFollowing && shouldFollow) onFollowRestoredRef.current?.()
  }, [])

  const viewportRef = useCallback((element: HTMLDivElement | null) => {
    viewportNodeRef.current = element
    setViewport(element)
  }, [])

  const contentRef = useCallback((element: HTMLDivElement | null) => {
    setContent(element)
  }, [])

  const cancelScheduledLayout = useCallback(() => {
    if (frameRef.current === null) return
    cancelAnimationFrame(frameRef.current)
    frameRef.current = null
  }, [])

  const scheduleLayout = useCallback(() => {
    if (frameRef.current !== null) return

    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null
      const element = viewportNodeRef.current
      if (!element) return

      const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight)
      const hasOverflow = maxScrollTop > OVERFLOW_TOLERANCE_PX

      // A disclosure that still fits cannot create a meaningful reading
      // position, so interaction-paused following can safely resume.
      if (!hasOverflow) {
        setShouldFollow(true)
      }

      if (!shouldFollowRef.current) return

      if (Math.abs(element.scrollTop - maxScrollTop) <= OVERFLOW_TOLERANCE_PX) {
        expectedScrollTopRef.current = null
        return
      }

      expectedScrollTopRef.current = maxScrollTop
      lastObservedScrollTopRef.current = maxScrollTop
      element.scrollTop = maxScrollTop
    })
  }, [setShouldFollow])

  const pauseForInteraction = useCallback(() => {
    setShouldFollow(false)
    expectedScrollTopRef.current = null
    // React commits a disclosure update before the next frame. Re-check there
    // so a detail that still has no overflow automatically resumes following.
    scheduleLayout()
  }, [scheduleLayout, setShouldFollow])

  useLayoutEffect(() => {
    if (!viewport || !content) return

    setShouldFollow(true)
    expectedScrollTopRef.current = null
    lastObservedScrollTopRef.current = viewport.scrollTop

    const handleScroll = () => {
      const currentScrollTop = viewport.scrollTop
      const expectedScrollTop = expectedScrollTopRef.current
      if (expectedScrollTop !== null && Math.abs(currentScrollTop - expectedScrollTop) <= OVERFLOW_TOLERANCE_PX) {
        expectedScrollTopRef.current = null
        lastObservedScrollTopRef.current = currentScrollTop
        return
      }

      expectedScrollTopRef.current = null
      const previousScrollTop = lastObservedScrollTopRef.current
      lastObservedScrollTopRef.current = currentScrollTop
      const distanceToBottom = Math.max(0, viewport.scrollHeight - viewport.clientHeight - currentScrollTop)

      // A layout shrink can lower scrollTop while leaving the viewport exactly
      // at its new bottom. Otherwise, any real upward motion is explicit user
      // intent, including movements within the usual bottom tolerance.
      if (distanceToBottom <= OVERFLOW_TOLERANCE_PX) {
        setShouldFollow(true)
        return
      }
      if (currentScrollTop < previousScrollTop - OVERFLOW_TOLERANCE_PX) {
        setShouldFollow(false)
        return
      }
      setShouldFollow(distanceToBottom <= BOTTOM_TOLERANCE_PX)
    }

    viewport.addEventListener('scroll', handleScroll, { passive: true })

    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            scheduleLayout()
          })
    observer?.observe(content)
    if (content !== viewport) observer?.observe(viewport)

    scheduleLayout()

    return () => {
      viewport.removeEventListener('scroll', handleScroll)
      observer?.disconnect()
      cancelScheduledLayout()
      expectedScrollTopRef.current = null
    }
  }, [cancelScheduledLayout, content, scheduleLayout, setShouldFollow, viewport])

  return { viewportRef, contentRef, pauseForInteraction }
}
