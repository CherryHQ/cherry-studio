import { usePersistCache } from '@data/hooks/useCache'
import { ErrorBoundary } from '@renderer/components/ErrorBoundary'
import { useResizeDrag } from '@renderer/hooks/useResizeDrag'
import { cn } from '@renderer/utils'
import { AnimatePresence, motion } from 'motion/react'
import type { CSSProperties, MouseEvent as ReactMouseEvent, ReactNode } from 'react'
import { useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import {
  ARTIFACT_RIGHT_PANE_CACHE_KEY,
  ARTIFACT_RIGHT_PANE_DEFAULT_WIDTH,
  ARTIFACT_RIGHT_PANE_MAX_WIDTH,
  ARTIFACT_RIGHT_PANE_MIN_WIDTH,
  CHAT_SHELL_PANE_WIDTH,
  CHAT_SHELL_TRANSITION
} from './paneLayout'
import { getVerticalSplitterProps } from './splitterA11y'

type RightPaneResizeCacheKey = typeof ARTIFACT_RIGHT_PANE_CACHE_KEY

export interface RightPaneHostProps {
  children?: ReactNode
  open?: boolean
  width?: string | number
  className?: string
  style?: CSSProperties
  resizable?: boolean
  minWidth?: number
  defaultWidth?: number
  maxWidth?: number
  cacheKey?: RightPaneResizeCacheKey
  reservedCenterWidth?: number
  onReservedSpaceUnavailable?: () => void
  onOpenAnimationComplete?: () => void
  onCloseAnimationComplete?: () => void
}

function clampRightPaneWidth(width: number, minWidth: number, maxWidth: number): number {
  return Math.min(maxWidth, Math.max(minWidth, Math.round(width)))
}

function useRightPaneResize({
  cacheKey,
  defaultWidth,
  minWidth,
  maxWidth
}: {
  cacheKey: RightPaneResizeCacheKey
  defaultWidth: number
  minWidth: number
  maxWidth: number
}) {
  const [storedWidth, setStoredWidth] = usePersistCache(cacheKey)
  const paneRef = useRef<HTMLDivElement>(null)
  const paneRightRef = useRef(0)
  const paneWidth = clampRightPaneWidth(storedWidth ?? defaultWidth, minWidth, maxWidth)

  const handleMouseMove = useCallback(
    (moveEvent: MouseEvent) => {
      setStoredWidth(clampRightPaneWidth(paneRightRef.current - moveEvent.clientX, minWidth, maxWidth))
    },
    [maxWidth, minWidth, setStoredWidth]
  )

  const { isResizing, startResizing: startResizeDrag } = useResizeDrag({ onMove: handleMouseMove })

  const startResizing = useCallback(
    (event: ReactMouseEvent) => {
      paneRightRef.current = paneRef.current?.getBoundingClientRect().right ?? event.clientX + paneWidth
      startResizeDrag(event)
    },
    [paneWidth, startResizeDrag]
  )

  const setPaneWidth = useCallback(
    (nextWidth: number) => setStoredWidth(clampRightPaneWidth(nextWidth, minWidth, maxWidth)),
    [maxWidth, minWidth, setStoredWidth]
  )

  return {
    isResizing,
    paneRef,
    paneWidth,
    startResizing,
    setPaneWidth
  }
}

export function RightPaneHost({
  children,
  open,
  width = CHAT_SHELL_PANE_WIDTH,
  className,
  style,
  resizable = false,
  minWidth = ARTIFACT_RIGHT_PANE_MIN_WIDTH,
  defaultWidth,
  maxWidth = ARTIFACT_RIGHT_PANE_MAX_WIDTH,
  cacheKey = ARTIFACT_RIGHT_PANE_CACHE_KEY,
  reservedCenterWidth,
  onReservedSpaceUnavailable,
  onOpenAnimationComplete,
  onCloseAnimationComplete
}: RightPaneHostProps) {
  const { t } = useTranslation()
  const resolvedDefaultWidth = defaultWidth ?? (typeof width === 'number' ? width : ARTIFACT_RIGHT_PANE_DEFAULT_WIDTH)
  const { isResizing, paneRef, paneWidth, startResizing, setPaneWidth } = useRightPaneResize({
    cacheKey,
    defaultWidth: resolvedDefaultWidth,
    minWidth,
    maxWidth
  })
  const resolvedWidth = resizable ? paneWidth : width
  const constrainedStyle =
    reservedCenterWidth === undefined
      ? style
      : { ...style, maxWidth: `max(0px, calc(100% - ${reservedCenterWidth}px))` }
  const hasVisiblePane = Boolean(open && children)

  useEffect(() => {
    if (!hasVisiblePane || reservedCenterWidth === undefined || !onReservedSpaceUnavailable) return
    if (typeof ResizeObserver === 'undefined') return

    const container = paneRef.current?.parentElement
    if (!container) return

    // The pane minimum and reserved center width are independent constraints; the container must fit both.
    const minContainerWidth = minWidth + reservedCenterWidth
    const notifyIfUnavailable = (containerWidth: number) => {
      if (containerWidth > 0 && containerWidth < minContainerWidth) onReservedSpaceUnavailable()
    }

    notifyIfUnavailable(container.getBoundingClientRect().width)

    const observer = new ResizeObserver(([entry]) => {
      notifyIfUnavailable(entry.contentRect.width)
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [hasVisiblePane, minWidth, onReservedSpaceUnavailable, reservedCenterWidth])

  return (
    <AnimatePresence initial={false} onExitComplete={onCloseAnimationComplete}>
      {open && children && (
        <motion.div
          ref={paneRef}
          key="right-pane"
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: resolvedWidth, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={isResizing ? { duration: 0 } : CHAT_SHELL_TRANSITION}
          onAnimationComplete={() => {
            if (!isResizing) onOpenAnimationComplete?.()
          }}
          data-right-pane
          data-resizing={isResizing || undefined}
          className={cn(
            'group/right-pane h-full min-h-0 shrink-0 overflow-hidden',
            resizable && 'relative bg-card [border-left:0.5px_solid_var(--color-border)]',
            className
          )}
          style={constrainedStyle}>
          <ErrorBoundary>{children}</ErrorBoundary>
          {resizable && (
            <div
              data-right-pane-resize-handle
              onMouseDown={startResizing}
              {...getVerticalSplitterProps({
                width: paneWidth,
                min: minWidth,
                max: maxWidth,
                label: t('common.resize_panel'),
                onResize: setPaneWidth,
                invert: true
              })}
              className="group/right-pane-resize-handle absolute top-0 bottom-0 left-0 z-10 w-2 cursor-col-resize focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
              <div className="absolute top-0 left-0 h-full w-0.5 bg-primary/20 opacity-0 transition-opacity group-hover/right-pane-resize-handle:opacity-100 group-data-[resizing=true]/right-pane:bg-primary/35 group-data-[resizing=true]/right-pane:opacity-100" />
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
