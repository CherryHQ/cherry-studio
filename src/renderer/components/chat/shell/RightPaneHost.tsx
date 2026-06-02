import { usePersistCache } from '@data/hooks/useCache'
import { ErrorBoundary } from '@renderer/components/ErrorBoundary'
import { useResizeDrag } from '@renderer/hooks/useResizeDrag'
import { cn } from '@renderer/utils'
import { AnimatePresence, motion } from 'motion/react'
import type { CSSProperties, MouseEvent as ReactMouseEvent, ReactNode } from 'react'
import { useCallback, useRef } from 'react'

import { CHAT_SHELL_PANE_WIDTH, CHAT_SHELL_TRANSITION } from './types'

export const ARTIFACT_RIGHT_PANE_MIN_WIDTH = 360
export const ARTIFACT_RIGHT_PANE_DEFAULT_WIDTH = 460
export const ARTIFACT_RIGHT_PANE_MAX_WIDTH = 720
export const ARTIFACT_RIGHT_PANE_CACHE_KEY = 'ui.chat.artifact_pane.width'

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

  return {
    isResizing,
    paneRef,
    paneWidth,
    startResizing
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
  onOpenAnimationComplete,
  onCloseAnimationComplete
}: RightPaneHostProps) {
  const resolvedDefaultWidth = defaultWidth ?? (typeof width === 'number' ? width : ARTIFACT_RIGHT_PANE_DEFAULT_WIDTH)
  const { isResizing, paneRef, paneWidth, startResizing } = useRightPaneResize({
    cacheKey,
    defaultWidth: resolvedDefaultWidth,
    minWidth,
    maxWidth
  })
  const resolvedWidth = resizable ? paneWidth : width

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
          style={style}>
          <ErrorBoundary>{children}</ErrorBoundary>
          {resizable && (
            <div
              data-right-pane-resize-handle
              onMouseDown={startResizing}
              className="group/right-pane-resize-handle absolute top-0 bottom-0 left-0 z-10 w-2 cursor-col-resize">
              <div className="absolute top-0 left-0 h-full w-0.5 bg-primary/20 opacity-0 transition-opacity group-hover/right-pane-resize-handle:opacity-100 group-data-[resizing=true]/right-pane:bg-primary/35 group-data-[resizing=true]/right-pane:opacity-100" />
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
