import { usePersistCache } from '@data/hooks/useCache'
import { ErrorBoundary } from '@renderer/components/ErrorBoundary'
import { useResizeDrag } from '@renderer/hooks/useResizeDrag'
import { cn } from '@renderer/utils/style'
import { AnimatePresence, motion, useAnimationControls, useReducedMotion } from 'motion/react'
import type { CSSProperties, MouseEvent as ReactMouseEvent, ReactNode } from 'react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  ARTIFACT_RIGHT_PANE_CACHE_KEY,
  ARTIFACT_RIGHT_PANE_DEFAULT_WIDTH,
  ARTIFACT_RIGHT_PANE_MAX_WIDTH,
  ARTIFACT_RIGHT_PANE_MIN_WIDTH,
  CHAT_SHELL_PANE_WIDTH,
  CHAT_SHELL_TRANSITION
} from './paneLayout'
import {
  getInitialPersistentRightPaneState,
  getRightPaneDockedClip,
  isClosedRightPanePhase,
  isFullWidthRightPanePhase,
  type PersistentRightPaneVisualState,
  planPersistentRightPaneTransition,
  RIGHT_PANE_CLIP_COLLAPSED,
  RIGHT_PANE_CLIP_REVEALED,
  type RightPaneLayoutMode
} from './rightPaneTransition'
import { getVerticalSplitterProps } from './splitterA11y'

export type { RightPaneLayoutMode } from './rightPaneTransition'

type RightPaneResizeCacheKey = typeof ARTIFACT_RIGHT_PANE_CACHE_KEY

export interface RightPaneHostProps {
  children?: ReactNode
  open?: boolean
  /** Keeps the child subtree mounted while the pane is closed or maximized. */
  keepMounted?: boolean
  maximized?: boolean
  maximizedBottomInset?: number
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
  onLayoutAnimationComplete?: (mode: RightPaneLayoutMode) => void
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

  // Drag-local width shown while actively dragging; null when not dragging,
  // in which case paneWidth falls back to the persisted storedWidth.
  const [liveWidth, setLiveWidth] = useState<number | null>(null)

  // Latest clamped width computed from the most recent mousemove — a plain
  // ref write, so recording it costs nothing per pixel of movement.
  const pendingWidthRef = useRef<number | null>(null)

  // Whether an rAF flush is already scheduled. This is a dedicated flag set
  // BEFORE calling requestAnimationFrame and cleared INSIDE its callback —
  // deliberately not derived from requestAnimationFrame's return value.
  // Tests install a synchronous rAF mock that invokes the callback before
  // requestAnimationFrame() itself returns; under that mock, gating on the
  // return value would leave the flag permanently "scheduled" after the
  // first call, since the callback's reset happens before the assignment
  // that would otherwise set it. This ref sidesteps that ordering entirely.
  const rafScheduledRef = useRef(false)
  // Only used to cancelAnimationFrame on early teardown (unmount/blur/etc.).
  const rafIdRef = useRef<number | null>(null)

  const paneWidth = clampRightPaneWidth(liveWidth ?? storedWidth ?? defaultWidth, minWidth, maxWidth)

  const cancelPendingRaf = useCallback(() => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current)
      rafIdRef.current = null
    }
    rafScheduledRef.current = false
  }, [])

  const handleMouseMove = useCallback(
    (moveEvent: MouseEvent) => {
      pendingWidthRef.current = clampRightPaneWidth(paneRightRef.current - moveEvent.clientX, minWidth, maxWidth)

      if (rafScheduledRef.current) return
      rafScheduledRef.current = true
      rafIdRef.current = requestAnimationFrame(() => {
        rafScheduledRef.current = false
        rafIdRef.current = null
        setLiveWidth(pendingWidthRef.current)
      })
    },
    [maxWidth, minWidth]
  )

  const handleResizeEnd = useCallback(() => {
    cancelPendingRaf()
    if (pendingWidthRef.current !== null) {
      setStoredWidth(pendingWidthRef.current)
      pendingWidthRef.current = null
    }
    setLiveWidth(null)
  }, [cancelPendingRaf, setStoredWidth])

  const { isResizing, startResizing: startResizeDrag } = useResizeDrag({
    onMove: handleMouseMove,
    onEnd: handleResizeEnd
  })

  // Belt-and-braces: cancel any in-flight rAF if the component unmounts
  // mid-drag, so a stray frame never calls setLiveWidth after unmount.
  useEffect(() => cancelPendingRaf, [cancelPendingRaf])

  const startResizing = useCallback(
    (event: ReactMouseEvent) => {
      paneRightRef.current = paneRef.current?.getBoundingClientRect().right ?? event.clientX + paneWidth
      startResizeDrag(event)
    },
    [paneWidth, startResizeDrag]
  )

  // Keyboard/a11y path (arrow keys via splitterA11y): discrete single calls,
  // committed immediately — no rAF batching needed or wanted here.
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

export function RightPaneHost({ keepMounted = false, ...props }: RightPaneHostProps) {
  if (keepMounted) return <PersistentRightPaneHost {...props} />
  return <TransientRightPaneHost {...props} />
}

function RightPaneContents({
  children,
  paneWidth,
  minWidth,
  maxWidth,
  resizeHandleVisible,
  startResizing,
  setPaneWidth
}: {
  children?: ReactNode
  paneWidth: number
  minWidth: number
  maxWidth: number
  resizeHandleVisible: boolean
  startResizing: (event: ReactMouseEvent) => void
  setPaneWidth: (nextWidth: number) => void
}) {
  const { t } = useTranslation()

  return (
    <>
      {/* Mouse events over an iframe (e.g. the HTML preview tab) never reach this
          document's mousemove/mouseup listeners. Disable pointer events on pane
          content while dragging so the document-level resize listeners keep working. */}
      <div className="h-full min-h-0 group-data-[resizing=true]/right-pane:pointer-events-none">
        <ErrorBoundary>{children}</ErrorBoundary>
      </div>
      {resizeHandleVisible && (
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
          className="group/right-pane-resize-handle absolute top-0 bottom-0 left-0 z-30 w-2 cursor-col-resize focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
          <div className="absolute top-0 left-0 h-full w-0.5 bg-primary/20 opacity-0 transition-opacity group-hover/right-pane-resize-handle:opacity-100 group-data-[resizing=true]/right-pane:bg-primary/35 group-data-[resizing=true]/right-pane:opacity-100" />
        </div>
      )}
    </>
  )
}

function TransientRightPaneHost({
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
  const hasVisiblePane = Boolean(open && children !== null && children !== undefined)

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
  }, [hasVisiblePane, minWidth, onReservedSpaceUnavailable, paneRef, reservedCenterWidth])

  return (
    <AnimatePresence initial={false} onExitComplete={onCloseAnimationComplete}>
      {hasVisiblePane && (
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
            resizable && 'relative [border-left:0.5px_solid_var(--color-border)]',
            className
          )}
          style={constrainedStyle}>
          <RightPaneContents
            paneWidth={paneWidth}
            minWidth={minWidth}
            maxWidth={maxWidth}
            resizeHandleVisible={resizable}
            startResizing={startResizing}
            setPaneWidth={setPaneWidth}>
            {children}
          </RightPaneContents>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function PersistentRightPaneHost({
  children,
  open,
  maximized = false,
  maximizedBottomInset = 0,
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
  onCloseAnimationComplete,
  onLayoutAnimationComplete
}: RightPaneHostProps) {
  const reduceMotion = useReducedMotion()
  const animationControls = useAnimationControls()
  const resolvedDefaultWidth = defaultWidth ?? (typeof width === 'number' ? width : ARTIFACT_RIGHT_PANE_DEFAULT_WIDTH)
  const { isResizing, paneRef, paneWidth, startResizing, setPaneWidth } = useRightPaneResize({
    cacheKey,
    defaultWidth: resolvedDefaultWidth,
    minWidth,
    maxWidth
  })
  const resolvedWidth = resizable ? paneWidth : width
  const dockedClip = getRightPaneDockedClip(resolvedWidth)
  const hasChildren = children !== null && children !== undefined
  const targetMode: RightPaneLayoutMode = !open || !hasChildren ? 'closed' : maximized ? 'maximized' : 'docked'
  const [visualState, setVisualStateState] = useState<PersistentRightPaneVisualState>(() =>
    getInitialPersistentRightPaneState(targetMode)
  )
  const visualStateRef = useRef(visualState)
  const { phase, reservesDockedSpace } = visualState
  const previousTargetModeRef = useRef(targetMode)
  const transitionTokenRef = useRef(0)
  const scheduledAnimationFrameRef = useRef<number | null>(null)
  const animationFrameScheduledRef = useRef(false)
  const [initialAnimationState] = useState(() => ({
    clipPath: targetMode === 'closed' ? RIGHT_PANE_CLIP_COLLAPSED : RIGHT_PANE_CLIP_REVEALED,
    opacity: targetMode === 'closed' ? 0 : 1
  }))
  const callbacksRef = useRef({
    onCloseAnimationComplete,
    onLayoutAnimationComplete,
    onOpenAnimationComplete
  })

  const setVisualState = useCallback((nextState: PersistentRightPaneVisualState) => {
    visualStateRef.current = nextState
    setVisualStateState(nextState)
  }, [])

  useLayoutEffect(() => {
    callbacksRef.current = { onCloseAnimationComplete, onLayoutAnimationComplete, onOpenAnimationComplete }
  }, [onCloseAnimationComplete, onLayoutAnimationComplete, onOpenAnimationComplete])

  useLayoutEffect(() => {
    if (previousTargetModeRef.current === targetMode) return
    previousTargetModeRef.current = targetMode

    const token = ++transitionTokenRef.current
    if (scheduledAnimationFrameRef.current !== null) {
      cancelAnimationFrame(scheduledAnimationFrameRef.current)
      scheduledAnimationFrameRef.current = null
    }
    animationFrameScheduledRef.current = false
    animationControls.stop()

    const plan = planPersistentRightPaneTransition(visualStateRef.current.phase, targetMode, {
      dockedClip,
      reduceMotion: Boolean(reduceMotion)
    })
    if (!plan) return

    const complete = () => {
      if (transitionTokenRef.current !== token) return
      setVisualState(plan.settledState)
      callbacksRef.current.onLayoutAnimationComplete?.(plan.completedMode)
      if (plan.completedMode === 'closed') callbacksRef.current.onCloseAnimationComplete?.()
      if (plan.completedMode === 'docked') callbacksRef.current.onOpenAnimationComplete?.()
    }
    const start = (
      definition: Parameters<typeof animationControls.start>[0],
      onComplete: () => void,
      deferUntilNextFrame = false
    ) => {
      const run = () => {
        animationFrameScheduledRef.current = false
        scheduledAnimationFrameRef.current = null
        if (transitionTokenRef.current !== token) return
        void animationControls.start(definition).then(onComplete)
      }

      if (deferUntilNextFrame && !reduceMotion && typeof requestAnimationFrame !== 'undefined') {
        animationFrameScheduledRef.current = true
        const animationFrame = requestAnimationFrame(run)
        if (animationFrameScheduledRef.current) scheduledAnimationFrameRef.current = animationFrame
      } else {
        run()
      }
    }

    if (targetMode === 'closed') {
      const activeElement = typeof document === 'undefined' ? null : document.activeElement
      if (
        activeElement &&
        typeof HTMLElement !== 'undefined' &&
        activeElement instanceof HTMLElement &&
        paneRef.current?.contains(activeElement)
      ) {
        activeElement.blur()
      }
    }

    if (plan.setBeforeStart) animationControls.set(plan.setBeforeStart)
    setVisualState(plan.runningState)
    start(plan.animateTo, complete, plan.deferUntilNextFrame)
  }, [animationControls, dockedClip, paneRef, reduceMotion, setVisualState, targetMode])

  // Runs after the docked width commits (pre-paint), when the docked-strip calc()
  // clip already equals a zero inset — visually a no-op that restores the plain
  // resting value so later transitions animate from a canonical clip. The target
  // guard keeps it out of commits where a new transition just staged its own clip.
  useLayoutEffect(() => {
    if (phase === 'docked' && targetMode === 'docked') {
      animationControls.set({ clipPath: RIGHT_PANE_CLIP_REVEALED, opacity: 1 })
    }
  }, [animationControls, phase, targetMode])

  useEffect(() => {
    return () => {
      transitionTokenRef.current += 1
      if (scheduledAnimationFrameRef.current !== null) {
        cancelAnimationFrame(scheduledAnimationFrameRef.current)
        scheduledAnimationFrameRef.current = null
      }
      animationFrameScheduledRef.current = false
      animationControls.stop()
    }
  }, [animationControls])

  const isDocked = phase === 'docked' && targetMode === 'docked'
  useEffect(() => {
    if (!isDocked || reservedCenterWidth === undefined || !onReservedSpaceUnavailable) return
    if (typeof ResizeObserver === 'undefined') return

    const container = paneRef.current?.parentElement
    if (!container) return

    const minContainerWidth = minWidth + reservedCenterWidth
    const notifyIfUnavailable = (containerWidth: number) => {
      if (containerWidth > 0 && containerWidth < minContainerWidth) onReservedSpaceUnavailable()
    }

    notifyIfUnavailable(container.getBoundingClientRect().width)
    const observer = new ResizeObserver(([entry]) => notifyIfUnavailable(entry.contentRect.width))
    observer.observe(container)
    return () => observer.disconnect()
  }, [isDocked, minWidth, onReservedSpaceUnavailable, paneRef, reservedCenterWidth])

  const fullWidthLayout = isFullWidthRightPanePhase(phase)
  const closed = isClosedRightPanePhase(phase)
  const closing = phase === 'closing-docked' || phase === 'closing-maximized'
  const interactionHidden = closed || closing
  const dockedMaxWidth =
    reservedCenterWidth === undefined ? undefined : `max(0px, calc(100% - ${reservedCenterWidth}px))`
  const spacerTransition = isResizing || fullWidthLayout ? { duration: 0 } : CHAT_SHELL_TRANSITION
  const surfaceHeight =
    fullWidthLayout && maximizedBottomInset > 0 ? `max(0px, calc(100% - ${maximizedBottomInset}px))` : undefined

  return (
    <>
      <motion.div
        aria-hidden="true"
        data-right-pane-spacer
        animate={{ width: reservesDockedSpace ? resolvedWidth : 0 }}
        transition={spacerTransition}
        className="h-full min-h-0 shrink-0"
        style={{ maxWidth: dockedMaxWidth }}
      />
      <motion.div
        ref={paneRef}
        initial={initialAnimationState}
        animate={animationControls}
        inert={interactionHidden}
        aria-hidden={interactionHidden || undefined}
        data-right-pane
        data-right-pane-mode={targetMode}
        data-right-pane-phase={phase}
        data-resizing={isResizing || undefined}
        data-shell-maximized-overlay={fullWidthLayout ? '' : undefined}
        className={cn(
          'group/right-pane pointer-events-none absolute top-0 right-0 bottom-0 z-40 h-full min-h-0 overflow-hidden',
          className
        )}
        style={{
          ...style,
          width: fullWidthLayout ? '100%' : resolvedWidth,
          maxWidth: fullWidthLayout ? undefined : dockedMaxWidth,
          visibility: closed ? 'hidden' : undefined
        }}>
        <div
          data-shell-maximized-overlay-content={fullWidthLayout ? '' : undefined}
          className={cn(
            'relative h-full min-h-0 overflow-hidden',
            !interactionHidden && 'pointer-events-auto',
            fullWidthLayout && 'bg-background',
            resizable && !fullWidthLayout && '[border-left:0.5px_solid_var(--color-border)]'
          )}
          style={surfaceHeight ? { height: surfaceHeight } : undefined}>
          <RightPaneContents
            paneWidth={paneWidth}
            minWidth={minWidth}
            maxWidth={maxWidth}
            resizeHandleVisible={resizable && isDocked}
            startResizing={startResizing}
            setPaneWidth={setPaneWidth}>
            {children}
          </RightPaneContents>
        </div>
      </motion.div>
    </>
  )
}
