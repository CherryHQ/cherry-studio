import type { MouseEvent as ReactMouseEvent, RefObject } from 'react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { useResizeDrag } from '@renderer/hooks/useResizeDrag'
import { useWindowScopedPersistCache } from '@renderer/hooks/useWindowScopedPersistCache'

import {
  CHAT_NARROW_DEFAULT_WIDTH,
  CHAT_NARROW_MAX_WIDTH,
  CHAT_NARROW_MIN_WIDTH,
  CHAT_NARROW_SIDE_PADDING_TOTAL,
  CHAT_NARROW_WIDTH_CACHE_KEY,
  CHAT_NARROW_WIDTH_CSS_VAR,
  CHAT_NARROW_WIDTH_WINDOW_CACHE_KEY
} from './paneLayout'

export type ChatNarrowResizeSide = 'left' | 'right'

export const CHAT_NARROW_SNAP_THRESHOLD = 8

export function clampChatNarrowWidth(width: number, maxAvailableWidth?: number): number {
  if (!Number.isFinite(width)) return CHAT_NARROW_DEFAULT_WIDTH
  const upperBound =
    maxAvailableWidth !== undefined
      ? Math.min(CHAT_NARROW_MAX_WIDTH, Math.max(CHAT_NARROW_MIN_WIDTH, Math.floor(maxAvailableWidth)))
      : CHAT_NARROW_MAX_WIDTH
  return Math.min(upperBound, Math.max(CHAT_NARROW_MIN_WIDTH, Math.round(width)))
}

export function computeSymmetricNarrowWidth({
  side,
  startWidth,
  startClientX,
  currentClientX,
  maxAvailableWidth,
  snapToDefaultThreshold
}: {
  side: ChatNarrowResizeSide
  startWidth: number
  startClientX: number
  currentClientX: number
  maxAvailableWidth?: number
  snapToDefaultThreshold?: number
}): number {
  const delta = currentClientX - startClientX
  const rawWidth = side === 'right' ? startWidth + delta * 2 : startWidth - delta * 2
  const clamped = clampChatNarrowWidth(rawWidth, maxAvailableWidth)
  const upperBound =
    maxAvailableWidth !== undefined
      ? Math.min(CHAT_NARROW_MAX_WIDTH, Math.max(CHAT_NARROW_MIN_WIDTH, Math.floor(maxAvailableWidth)))
      : CHAT_NARROW_MAX_WIDTH
  if (
    snapToDefaultThreshold &&
    CHAT_NARROW_DEFAULT_WIDTH <= upperBound &&
    Math.abs(clamped - CHAT_NARROW_DEFAULT_WIDTH) <= snapToDefaultThreshold
  ) {
    return CHAT_NARROW_DEFAULT_WIDTH
  }
  return clamped
}

function getMaxAvailableWidth(stageRef: RefObject<HTMLDivElement | null>): number | undefined {
  const stageWidth = stageRef.current?.getBoundingClientRect().width ?? 0
  if (stageWidth <= 0) return undefined
  return Math.max(CHAT_NARROW_MIN_WIDTH, Math.floor(stageWidth - CHAT_NARROW_SIDE_PADDING_TOTAL))
}

interface UseChatNarrowWidthResizeOptions {
  onLiveWidthChange?: (width: number) => void
}

export function useChatNarrowWidthResize(
  stageRef: RefObject<HTMLDivElement | null>,
  options?: UseChatNarrowWidthResizeOptions
) {
  const [storedWidth, setStoredWidth] = useWindowScopedPersistCache(
    CHAT_NARROW_WIDTH_CACHE_KEY,
    CHAT_NARROW_WIDTH_WINDOW_CACHE_KEY
  )
  const narrowWidth = clampChatNarrowWidth(storedWidth ?? CHAT_NARROW_DEFAULT_WIDTH)
  const [activeSide, setActiveSide] = useState<ChatNarrowResizeSide | null>(null)
  const liveWidthRef = useRef<number | null>(null)
  const onLiveWidthChangeRef = useRef(options?.onLiveWidthChange)
  const dragStateRef = useRef<{
    side: ChatNarrowResizeSide
    startWidth: number
    startClientX: number
    maxAvailableWidth?: number
  }>({
    side: 'right',
    startWidth: CHAT_NARROW_DEFAULT_WIDTH,
    startClientX: 0
  })

  useEffect(() => {
    onLiveWidthChangeRef.current = options?.onLiveWidthChange
  }, [options?.onLiveWidthChange])

  useLayoutEffect(() => {
    document.documentElement.style.setProperty(CHAT_NARROW_WIDTH_CSS_VAR, `${narrowWidth}px`)
  }, [narrowWidth])

  useEffect(() => {
    return () => {
      delete document.documentElement.dataset.chatNarrowResizing
    }
  }, [])

  const handleMouseMove = useCallback((moveEvent: MouseEvent) => {
    const nextWidth = computeSymmetricNarrowWidth({
      ...dragStateRef.current,
      currentClientX: moveEvent.clientX,
      snapToDefaultThreshold: CHAT_NARROW_SNAP_THRESHOLD
    })
    liveWidthRef.current = nextWidth
    document.documentElement.style.setProperty(CHAT_NARROW_WIDTH_CSS_VAR, `${nextWidth}px`)
    onLiveWidthChangeRef.current?.(nextWidth)
  }, [])

  const handleDragEnd = useCallback(() => {
    setActiveSide(null)
    delete document.documentElement.dataset.chatNarrowResizing
    const finalWidth = liveWidthRef.current
    liveWidthRef.current = null
    if (finalWidth !== null) {
      setStoredWidth(finalWidth)
    }
  }, [setStoredWidth])

  const { isResizing, startResizing: startResizeDrag } = useResizeDrag({
    onMove: handleMouseMove,
    onEnd: handleDragEnd
  })

  const startResizing = useCallback(
    (side: ChatNarrowResizeSide, event: ReactMouseEvent) => {
      const maxAvailableWidth = getMaxAvailableWidth(stageRef)
      // Start from the rendered width cap rather than a wider persisted value so dragging inward has no dead zone.
      const effectiveStartWidth = clampChatNarrowWidth(
        maxAvailableWidth !== undefined ? Math.min(narrowWidth, maxAvailableWidth) : narrowWidth,
        maxAvailableWidth
      )
      dragStateRef.current = {
        side,
        startWidth: effectiveStartWidth,
        startClientX: event.clientX,
        maxAvailableWidth
      }
      liveWidthRef.current = effectiveStartWidth
      setActiveSide(side)
      onLiveWidthChangeRef.current?.(effectiveStartWidth)
      document.documentElement.dataset.chatNarrowResizing = 'true'
      startResizeDrag(event)
    },
    [narrowWidth, stageRef, startResizeDrag]
  )

  const setNarrowWidth = useCallback(
    (nextWidth: number) => {
      setStoredWidth(clampChatNarrowWidth(nextWidth, getMaxAvailableWidth(stageRef)))
    },
    [setStoredWidth, stageRef]
  )

  const resetNarrowWidth = useCallback(() => {
    setStoredWidth(CHAT_NARROW_DEFAULT_WIDTH)
  }, [setStoredWidth])

  return {
    isResizing,
    activeSide,
    narrowWidth,
    startResizing,
    setNarrowWidth,
    resetNarrowWidth
  }
}
