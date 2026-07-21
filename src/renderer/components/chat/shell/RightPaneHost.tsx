import { usePersistCache } from '@data/hooks/useCache'
import { ErrorBoundary } from '@renderer/components/ErrorBoundary'
import { useResizeDrag } from '@renderer/hooks/useResizeDrag'
import { cn } from '@renderer/utils/style'
import { AnimatePresence, motion, useAnimationControls, useReducedMotion } from 'motion/react'
import type { CSSProperties, MouseEvent as ReactMouseEvent, ReactNode, RefObject } from 'react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  ARTIFACT_RIGHT_PANE_CACHE_KEY,
  ARTIFACT_RIGHT_PANE_CLOSE_DRAG_THRESHOLD,
  ARTIFACT_RIGHT_PANE_DEFAULT_WIDTH,
  ARTIFACT_RIGHT_PANE_MAX_WIDTH,
  ARTIFACT_RIGHT_PANE_MIN_WIDTH,
  CHAT_SHELL_PANE_WIDTH,
  CHAT_SHELL_TRANSITION
} from './paneLayout'
import { buildDockedPaneWidthExpression, getPaneSpaceCap, resolveDockedPaneWidth } from './paneWidthPolicy'
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

interface RightPaneFrameProps {
  children?: ReactNode
  width?: string | number
  className?: string
  style?: CSSProperties
}

interface ResizableRightPaneProps extends RightPaneFrameProps {
  resizable?: boolean
  minWidth?: number
  defaultWidth?: number
  maxWidth?: number
  cacheKey?: RightPaneResizeCacheKey
}

export interface RightPaneHostProps extends RightPaneFrameProps {
  open: boolean
}

export interface PersistentRightPaneHostProps extends ResizableRightPaneProps {
  open: boolean
  maximized?: boolean
  onLayoutAnimationComplete?: (mode: RightPaneLayoutMode) => void
  /** Reports the full-width phase (maximizing/maximized/minimizing/closing-maximized) upward. */
  onFullWidthPhaseChange?: (active: boolean) => void
  onResizingChange?: (active: boolean) => void
  /** Invoked when a resize drag travels past the close threshold (drag-to-close). */
  onDragClose?: () => void
}

function clampRightPaneWidth(width: number, minWidth: number, maxWidth: number): number {
  return Math.min(maxWidth, Math.max(minWidth, Math.round(width)))
}
/** Width of the pane's containing block (the main region), or null before first measure. */
function useMainRegionWidth(paneRef: RefObject<HTMLDivElement | null>): number | null {
  const [width, setWidth] = useState<number | null>(null)

  useLayoutEffect(() => {
    const pane = paneRef.current
    if (!pane || typeof ResizeObserver === 'undefined') return
    const region = pane.offsetParent
    if (!(region instanceof HTMLElement)) return

    const update = () => {
      const next = region.getBoundingClientRect().width
      setWidth(next > 0 ? next : null)
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(region)
    return () => observer.disconnect()
  }, [paneRef])

  return width
}

function useRightPaneResize({
  cacheKey,
  defaultWidth,
  minWidth,
  maxWidth,
  spaceCapRef,
  onDragClose
}: {
  cacheKey: RightPaneResizeCacheKey
  defaultWidth: number
  minWidth: number
  maxWidth: number
  /** Current space-imposed display cap; null before the main region is measured. */
  spaceCapRef?: RefObject<number | null>
  /** Dragging well past the minimum width closes the pane (mirrors the left list's drag-collapse). */
  onDragClose?: () => void
}) {
  const [storedWidth, setStoredWidth] = usePersistCache(cacheKey)
  const paneRef = useRef<HTMLDivElement>(null)
  const paneRightRef = useRef(0)
  const dragStartClientXRef = useRef(0)
  const pendingDragCloseRef = useRef(false)
  const onDragCloseRef = useRef(onDragClose)
  useEffect(() => {
    onDragCloseRef.current = onDragClose
  }, [onDragClose])

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
    (moveEvent: MouseEvent, stop: () => void) => {
      const geometricWidth = paneRightRef.current - moveEvent.clientX
      const dragDelta = moveEvent.clientX - dragStartClientXRef.current
      if (geometricWidth < minWidth && dragDelta >= ARTIFACT_RIGHT_PANE_CLOSE_DRAG_THRESHOLD) {
        pendingWidthRef.current = null
        pendingDragCloseRef.current = true
        stop()
        return
      }
      pendingWidthRef.current = clampRightPaneWidth(geometricWidth, minWidth, maxWidth)

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

  // Commit only when the operation changes the effective (space-clamped) display
  // width, and commit that effective width — a constrained drag/keystroke must
  // never silently rewrite the stored preference to an invisible value.
  const commitWidth = useCallback(
    (requested: number) => {
      const cap = spaceCapRef?.current ?? null
      if (cap === null) {
        setStoredWidth(clampRightPaneWidth(requested, minWidth, maxWidth))
        return
      }
      const currentStored = clampRightPaneWidth(storedWidth ?? defaultWidth, minWidth, maxWidth)
      const currentEffective = clampRightPaneWidth(Math.min(currentStored, cap), minWidth, maxWidth)
      const nextEffective = clampRightPaneWidth(Math.min(requested, cap), minWidth, maxWidth)
      if (nextEffective !== currentEffective) setStoredWidth(nextEffective)
    },
    [defaultWidth, maxWidth, minWidth, setStoredWidth, spaceCapRef, storedWidth]
  )

  const handleResizeEnd = useCallback(() => {
    cancelPendingRaf()
    if (pendingWidthRef.current !== null) {
      commitWidth(pendingWidthRef.current)
      pendingWidthRef.current = null
    }
    setLiveWidth(null)
  }, [cancelPendingRaf, commitWidth])

  const { isResizing, startResizing: startResizeDrag } = useResizeDrag({
    onMove: handleMouseMove,
    onEnd: handleResizeEnd
  })

  // Belt-and-braces: cancel any in-flight rAF if the component unmounts
  // mid-drag, so a stray frame never calls setLiveWidth after unmount.
  useEffect(() => cancelPendingRaf, [cancelPendingRaf])

  // Fire the drag-close after the drag state has fully settled (mirrors the
  // left list's pending-collapse effect) so the close doesn't race the drag
  // teardown's own state updates.
  useEffect(() => {
    if (isResizing || !pendingDragCloseRef.current) return
    pendingDragCloseRef.current = false
    onDragCloseRef.current?.()
  }, [isResizing])

  const startResizing = useCallback(
    (event: ReactMouseEvent) => {
      paneRightRef.current = paneRef.current?.getBoundingClientRect().right ?? event.clientX + paneWidth
      dragStartClientXRef.current = event.clientX
      startResizeDrag(event)
    },
    [paneWidth, startResizeDrag]
  )

  // Keyboard/a11y path (arrow keys via splitterA11y): discrete single calls,
  // committed immediately — no rAF batching needed or wanted here.
  const setPaneWidth = useCallback((nextWidth: number) => commitWidth(nextWidth), [commitWidth])

  return {
    isResizing,
    paneRef,
    paneWidth,
    startResizing,
    setPaneWidth
  }
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

export function RightPaneHost({ children, open, width = CHAT_SHELL_PANE_WIDTH, className, style }: RightPaneHostProps) {
  const hasVisiblePane = Boolean(open && children !== null && children !== undefined)

  return (
    <AnimatePresence initial={false}>
      {hasVisiblePane && (
        <motion.div
          key="right-pane"
          initial={{ width: 0, opacity: 0 }}
          animate={{ width, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={CHAT_SHELL_TRANSITION}
          data-right-pane
          className={cn('h-full min-h-0 shrink-0 overflow-hidden', className)}
          style={style}>
          <ErrorBoundary>{children}</ErrorBoundary>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export function PersistentRightPaneHost({
  children,
  open,
  maximized = false,
  width = CHAT_SHELL_PANE_WIDTH,
  className,
  style,
  resizable = false,
  minWidth = ARTIFACT_RIGHT_PANE_MIN_WIDTH,
  defaultWidth,
  maxWidth = ARTIFACT_RIGHT_PANE_MAX_WIDTH,
  cacheKey = ARTIFACT_RIGHT_PANE_CACHE_KEY,
  onLayoutAnimationComplete,
  onFullWidthPhaseChange,
  onResizingChange,
  onDragClose
}: PersistentRightPaneHostProps) {
  const reduceMotion = useReducedMotion()
  const animationControls = useAnimationControls()
  const resolvedDefaultWidth = defaultWidth ?? (typeof width === 'number' ? width : ARTIFACT_RIGHT_PANE_DEFAULT_WIDTH)
  const spaceCapRef = useRef<number | null>(null)
  const { isResizing, paneRef, paneWidth, startResizing, setPaneWidth } = useRightPaneResize({
    cacheKey,
    defaultWidth: resolvedDefaultWidth,
    minWidth,
    maxWidth,
    spaceCapRef,
    onDragClose
  })
  const mainRegionWidth = useMainRegionWidth(paneRef)
  useLayoutEffect(() => {
    spaceCapRef.current = mainRegionWidth === null ? null : getPaneSpaceCap(mainRegionWidth)
  }, [mainRegionWidth])
  const resolvedWidth = resizable ? paneWidth : width
  // One expression drives the pane, the spacer, and the clip; diverging them would
  // let the pane paint wider than the reserved space and overlap the center.
  const dockedWidthExpression = buildDockedPaneWidthExpression(resolvedWidth)
  const effectiveWidth =
    mainRegionWidth === null || typeof resolvedWidth !== 'number'
      ? paneWidth
      : Math.round(resolveDockedPaneWidth(mainRegionWidth, resolvedWidth))
  const dockedClip = getRightPaneDockedClip(dockedWidthExpression)
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
  const [initialAnimationState] = useState(() => ({
    clipPath: targetMode === 'closed' ? RIGHT_PANE_CLIP_COLLAPSED : RIGHT_PANE_CLIP_REVEALED,
    opacity: targetMode === 'closed' ? 0 : 1
  }))
  const onLayoutAnimationCompleteRef = useRef(onLayoutAnimationComplete)

  const setVisualState = useCallback((nextState: PersistentRightPaneVisualState) => {
    visualStateRef.current = nextState
    setVisualStateState(nextState)
  }, [])

  useLayoutEffect(() => {
    onLayoutAnimationCompleteRef.current = onLayoutAnimationComplete
  }, [onLayoutAnimationComplete])

  useLayoutEffect(() => {
    if (previousTargetModeRef.current === targetMode) return
    previousTargetModeRef.current = targetMode

    const token = ++transitionTokenRef.current
    if (scheduledAnimationFrameRef.current !== null) {
      cancelAnimationFrame(scheduledAnimationFrameRef.current)
      scheduledAnimationFrameRef.current = null
    }
    animationControls.stop()

    const plan = planPersistentRightPaneTransition(visualStateRef.current.phase, targetMode, {
      dockedClip,
      reduceMotion: Boolean(reduceMotion)
    })
    if (!plan) return

    const complete = () => {
      if (transitionTokenRef.current !== token) return
      setVisualState(plan.settledState)
      onLayoutAnimationCompleteRef.current?.(plan.completedMode)
    }
    const start = (
      definition: Parameters<typeof animationControls.start>[0],
      onComplete: () => void,
      deferUntilNextFrame = false
    ) => {
      const run = () => {
        scheduledAnimationFrameRef.current = null
        if (transitionTokenRef.current !== token) return
        void animationControls.start(definition).then(onComplete)
      }

      if (deferUntilNextFrame && !reduceMotion && typeof requestAnimationFrame !== 'undefined') {
        scheduledAnimationFrameRef.current = requestAnimationFrame(run)
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
      animationControls.stop()
    }
  }, [animationControls])

  const isDocked = phase === 'docked' && targetMode === 'docked'
  const fullWidthLayout = isFullWidthRightPanePhase(phase)
  const closed = isClosedRightPanePhase(phase)
  const interactionHidden = targetMode === 'closed'
  const spacerTransition = isResizing || fullWidthLayout ? { duration: 0 } : CHAT_SHELL_TRANSITION

  const onFullWidthPhaseChangeRef = useRef(onFullWidthPhaseChange)
  const onResizingChangeRef = useRef(onResizingChange)
  useLayoutEffect(() => {
    onFullWidthPhaseChangeRef.current = onFullWidthPhaseChange
    onResizingChangeRef.current = onResizingChange
  }, [onFullWidthPhaseChange, onResizingChange])
  useLayoutEffect(() => {
    onFullWidthPhaseChangeRef.current?.(fullWidthLayout)
  }, [fullWidthLayout])
  useLayoutEffect(() => {
    onResizingChangeRef.current?.(isResizing)
  }, [isResizing])

  return (
    <>
      <motion.div
        aria-hidden="true"
        data-right-pane-spacer
        animate={{ width: reservesDockedSpace ? resolvedWidth : 0 }}
        transition={spacerTransition}
        className="h-full min-h-0 shrink-0"
        style={{ maxWidth: dockedWidthExpression }}
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
          maxWidth: fullWidthLayout ? undefined : dockedWidthExpression,
          visibility: closed ? 'hidden' : undefined
        }}>
        <div
          data-shell-maximized-overlay-content={fullWidthLayout ? '' : undefined}
          className={cn(
            'relative h-full min-h-0 overflow-hidden',
            !interactionHidden && 'pointer-events-auto',
            fullWidthLayout && 'bg-background',
            resizable && !fullWidthLayout && '[border-left:0.5px_solid_var(--color-border)]'
          )}>
          <RightPaneContents
            paneWidth={effectiveWidth}
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
