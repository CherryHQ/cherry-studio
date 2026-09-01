import { AnimatePresence, motion, useAnimationControls, useReducedMotion } from 'motion/react'
import type { CSSProperties, MouseEvent as ReactMouseEvent, ReactNode, RefObject } from 'react'
import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { usePersistCache } from '@data/hooks/useCache'
import { ErrorBoundary } from '@renderer/components/ErrorBoundary'
import { useResizeDrag } from '@renderer/hooks/useResizeDrag'
import { cn } from '@renderer/utils/style'

import type { RESOURCE_LIST_RIGHT_PANE_CACHE_KEY } from './paneLayout'
import {
  ARTIFACT_RIGHT_PANE_CACHE_KEY,
  ARTIFACT_RIGHT_PANE_CLOSE_DRAG_OVERSHOOT,
  ARTIFACT_RIGHT_PANE_DEFAULT_WIDTH,
  ARTIFACT_RIGHT_PANE_MAX_WIDTH,
  ARTIFACT_RIGHT_PANE_MIN_WIDTH,
  CHAT_SHELL_PANE_WIDTH,
  CHAT_SHELL_TRANSITION
} from './paneLayout'
import { buildDockedPaneWidthExpression, getPaneSpaceCap, resolveDockedPaneWidth } from './paneWidthPolicy'
import {
  getInitialPersistentRightPaneState,
  getRightPanePhaseTransition,
  getSettledRightPaneMode,
  isClosedRightPanePhase,
  isFullWidthRightPanePhase,
  type PersistentRightPaneVisualState,
  planPersistentRightPaneReconnect,
  planPersistentRightPaneTransition,
  RIGHT_PANE_CLIP_COLLAPSED,
  RIGHT_PANE_CLIP_REVEALED,
  RIGHT_PANE_WIDTH_FULL,
  type RightPaneLayoutMode
} from './rightPaneTransition'
import { getVerticalSplitterProps } from './splitterA11y'

export type { RightPaneLayoutMode } from './rightPaneTransition'

type RightPaneResizeCacheKey = typeof ARTIFACT_RIGHT_PANE_CACHE_KEY | typeof RESOURCE_LIST_RIGHT_PANE_CACHE_KEY

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

/** Matches the gap the message list keeps between its content and the composer. */
const COMPOSER_CLEARANCE_GAP_PX = 16

// Measured here rather than published by the composer so the value lands on the pane's own
// subtree: a shared root variable would invalidate style for the message list on every resize.
function useElevatedComposerInset(paneRef: RefObject<HTMLDivElement | null>, active: boolean): number | null {
  const [inset, setInset] = useState<number | null>(null)

  useLayoutEffect(() => {
    if (!active) {
      setInset(null)
      return
    }
    const pane = paneRef.current
    const region = pane?.offsetParent
    const shellRoot = pane?.closest('[data-chat-app-shell-root]')
    if (!pane || !shellRoot || !(region instanceof HTMLElement)) return

    let observer: ResizeObserver | null = null
    let observedSurface: HTMLElement | null = null
    // A composer that has yet to mount produces no resize, so watch the shell for its arrival
    // instead. Only while the surface is absent — a subtree childList watch is not free.
    let arrivalObserver: MutationObserver | null = null

    const watchForArrival = () => {
      if (arrivalObserver || typeof MutationObserver === 'undefined') return
      arrivalObserver = new MutationObserver(() => update())
      arrivalObserver.observe(shellRoot, { childList: true, subtree: true })
    }

    const update = () => {
      // Switching sessions remounts the composer while a maximized pane survives, so resolve the
      // surface every pass: a detached node measures as a zero rect and would inflate the inset.
      const surface = shellRoot.querySelector<HTMLElement>('[data-composer-dock-surface]')
      if (surface) {
        arrivalObserver?.disconnect()
        arrivalObserver = null
      } else {
        watchForArrival()
      }
      if (observer && surface !== observedSurface) {
        if (observedSurface) observer.unobserve(observedSurface)
        if (surface) observer.observe(surface)
        observedSurface = surface
      }
      const covered = surface ? region.getBoundingClientRect().bottom - surface.getBoundingClientRect().top : 0
      const next = covered > 0 ? Math.round(covered) + COMPOSER_CLEARANCE_GAP_PX : null
      setInset((current) => (current === next ? current : next))
    }
    update()
    if (typeof ResizeObserver === 'undefined') return () => arrivalObserver?.disconnect()

    observer = new ResizeObserver(update)
    observer.observe(region)
    observedSurface = shellRoot.querySelector<HTMLElement>('[data-composer-dock-surface]')
    if (observedSurface) observer.observe(observedSurface)
    return () => {
      observer?.disconnect()
      arrivalObserver?.disconnect()
    }
  }, [active, paneRef])

  return inset
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
      // Close once the handle overshoots the minimum-width line, regardless of
      // where the drag started — a delta-based threshold made narrow windows
      // (pane already at its minimum) require dragging across most of the pane.
      if (geometricWidth < minWidth - ARTIFACT_RIGHT_PANE_CLOSE_DRAG_OVERSHOOT) {
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
          className="group/right-pane-resize-handle absolute top-0 bottom-0 left-0 z-30 w-2 cursor-col-resize focus-visible:bg-primary/40 focus-visible:outline-none">
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
          data-ui="part:conversation-navigation"
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
    spaceCapRef.current = mainRegionWidth === null ? null : getPaneSpaceCap(mainRegionWidth, minWidth)
  }, [mainRegionWidth, minWidth])
  const resolvedWidth = resizable ? paneWidth : width
  // One expression drives both the pane and its spacer; diverging them would let the
  // pane paint wider than the reserved space and overlap the center.
  const dockedWidthExpression = buildDockedPaneWidthExpression(resolvedWidth, minWidth)
  const effectiveWidth =
    mainRegionWidth === null || typeof resolvedWidth !== 'number'
      ? paneWidth
      : Math.round(resolveDockedPaneWidth(mainRegionWidth, resolvedWidth, minWidth))
  const splitterMinWidth =
    mainRegionWidth === null ? minWidth : Math.round(resolveDockedPaneWidth(mainRegionWidth, minWidth, minWidth))
  const splitterMaxWidth =
    mainRegionWidth === null ? maxWidth : Math.round(resolveDockedPaneWidth(mainRegionWidth, maxWidth, minWidth))
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
  const effectsConnectedRef = useRef(false)
  const [initialAnimationState] = useState(() => ({
    clipPath: targetMode === 'closed' ? RIGHT_PANE_CLIP_COLLAPSED : RIGHT_PANE_CLIP_REVEALED,
    opacity: targetMode === 'closed' ? 0 : 1,
    width: targetMode === 'maximized' ? RIGHT_PANE_WIDTH_FULL : dockedWidthExpression
  }))
  const onLayoutAnimationCompleteRef = useRef(onLayoutAnimationComplete)

  const setVisualState = useCallback((nextState: PersistentRightPaneVisualState) => {
    visualStateRef.current = nextState
    setVisualStateState(nextState)
  }, [])

  const invalidateActiveTransition = useCallback(() => {
    transitionTokenRef.current += 1
    if (scheduledAnimationFrameRef.current !== null) {
      cancelAnimationFrame(scheduledAnimationFrameRef.current)
      scheduledAnimationFrameRef.current = null
    }
    animationControls.stop()
  }, [animationControls])

  useLayoutEffect(() => {
    onLayoutAnimationCompleteRef.current = onLayoutAnimationComplete
  }, [onLayoutAnimationComplete])

  const reconcileAfterEffectsReconnect = useEffectEvent(() => {
    const plan = planPersistentRightPaneReconnect(visualStateRef.current.phase, targetMode, dockedWidthExpression)
    previousTargetModeRef.current = targetMode
    if (!plan.completedMode) return

    setVisualState(plan.settledState)
    onLayoutAnimationCompleteRef.current?.(plan.completedMode)
  })

  // Activity preserves state while disconnecting effects. Invalidate any running
  // transition on disconnect; when effects reconnect, converge an interrupted or
  // hidden-time target change to the latest target without replaying the animation.
  useLayoutEffect(() => {
    if (effectsConnectedRef.current) {
      reconcileAfterEffectsReconnect()
    } else {
      effectsConnectedRef.current = true
    }

    return invalidateActiveTransition
    // `reconcileAfterEffectsReconnect` is an Effect Event that reads the latest
    // target and visual state without turning normal renders into reconnects.
    // oxlint-disable-next-line react/exhaustive-deps
  }, [invalidateActiveTransition])

  useLayoutEffect(() => {
    if (previousTargetModeRef.current === targetMode) return
    previousTargetModeRef.current = targetMode

    invalidateActiveTransition()
    const token = transitionTokenRef.current

    const plan = planPersistentRightPaneTransition(visualStateRef.current.phase, targetMode, {
      dockedWidth: dockedWidthExpression,
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
  }, [
    animationControls,
    dockedWidthExpression,
    invalidateActiveTransition,
    paneRef,
    reduceMotion,
    setVisualState,
    targetMode
  ])

  // Every settled mode re-declares its canonical pre-paint Motion state, restoring
  // external visual state whenever Activity reconnects effects.
  useLayoutEffect(() => {
    const plan = planPersistentRightPaneReconnect(phase, targetMode, dockedWidthExpression)
    if (plan.completedMode) return

    animationControls.set(plan.motionState)
  }, [animationControls, dockedWidthExpression, phase, targetMode])

  const isDocked = phase === 'docked' && targetMode === 'docked'
  const fullWidthLayout = isFullWidthRightPanePhase(phase)
  const composerInset = useElevatedComposerInset(paneRef, fullWidthLayout)
  const closed = isClosedRightPanePhase(phase)
  const interactionHidden = targetMode === 'closed'
  // Motion interpolates the width it is given, while `maxWidth` clamps the width that is used:
  // animating a raw width the clamp then caps leaves the spacer parked until the two cross.
  const spacerWidth = mainRegionWidth === null || typeof resolvedWidth !== 'number' ? resolvedWidth : effectiveWidth
  // Settled phases track the region through re-measurement, which must land instantly; only a
  // phase change travels, and then on the same transition as the box it reserves space for.
  const spacerTravels = !isResizing && !reduceMotion && getSettledRightPaneMode(phase) === null
  const spacerTransition = spacerTravels ? getRightPanePhaseTransition(phase) : { duration: 0 }

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
        animate={{ width: reservesDockedSpace ? spacerWidth : 0 }}
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
        data-ui="part:conversation-inspector"
        data-right-pane
        data-right-pane-mode={targetMode}
        data-right-pane-phase={phase}
        data-resizing={isResizing || undefined}
        data-shell-maximized-overlay={fullWidthLayout ? '' : undefined}
        className={cn(
          'group/right-pane pointer-events-none absolute top-0 right-0 bottom-0 z-40 h-full min-h-0 overflow-hidden',
          className
        )}
        style={{ ...style, visibility: closed ? 'hidden' : undefined }}>
        <div
          data-shell-maximized-overlay-content={fullWidthLayout ? '' : undefined}
          style={
            composerInset === null ? undefined : ({ '--chat-composer-inset': `${composerInset}px` } as CSSProperties)
          }
          className={cn(
            // One opaque surface in every layout: the theme's background carries alpha in dark mode,
            // so a translucent pane both shows the chat it covers and flips colour when a phase settles.
            'relative h-full min-h-0 overflow-hidden bg-card',
            !interactionHidden && 'pointer-events-auto',
            resizable && !fullWidthLayout && '[border-left:0.5px_solid_var(--border)]'
          )}>
          <RightPaneContents
            paneWidth={effectiveWidth}
            minWidth={splitterMinWidth}
            maxWidth={splitterMaxWidth}
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
