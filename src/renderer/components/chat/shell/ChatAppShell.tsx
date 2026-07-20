import { usePersistCache } from '@data/hooks/useCache'
import { ErrorBoundary } from '@renderer/components/ErrorBoundary'
import { cn } from '@renderer/utils/style'
import { motion } from 'motion/react'
import type { ReactNode, Ref, RefObject } from 'react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { useOptionalRightPanelState } from '../panes/Shell'
import { OverlayHost } from './OverlayHost'
import { PageSidebar } from './PageSidebar'
import {
  ARTIFACT_RIGHT_PANE_MAX_WIDTH,
  ARTIFACT_RIGHT_PANE_MIN_WIDTH,
  CHAT_SHELL_TRANSITION,
  type ChatPanePosition
} from './paneLayout'
import { evaluateAutoCollapse, predictCenterWidth } from './paneWidthPolicy'
import { RightPaneHost } from './RightPaneHost'
import { clampResourceListPaneWidth } from './useResourceListPaneResize'

/**
 * User-driven left-pane toggle marker: pages bump `seq` inside explicit user
 * toggle handlers (both directions) in the same commit that flips `paneOpen`.
 * Programmatic opens (history locate, layout resets, auto-restore) must not.
 */
export interface PaneManualToggleSignal {
  seq: number
  open: boolean
}

interface ChatAppShellBaseProps {
  topBar?: ReactNode
  pane?: ReactNode
  paneOpen?: boolean
  panePosition?: ChatPanePosition
  sidePanel?: ReactNode
  centerOverlay?: ReactNode
  /** Overlay scoped to the center area but rendered above the center's transform/stacking layer. */
  centerTopOverlay?: ReactNode
  rightPane?: ReactNode
  overlay?: ReactNode
  rootId?: string
  rootClassName?: string
  contentId?: string
  centerId?: string
  centerRef?: Ref<HTMLDivElement>
  centerClassName?: string
  onPaneCollapse?: () => void
  onPaneAutoCollapseChange?: (collapsed: boolean) => void
  paneManualToggle?: PaneManualToggleSignal
}

type ChatAppShellMainProps = ChatAppShellBaseProps & {
  main: ReactNode
  bottomComposer?: ReactNode
  centerContent?: never
}

type ChatAppShellCenterContentProps = ChatAppShellBaseProps & {
  centerContent: ReactNode
  main?: never
  bottomComposer?: never
}

export type ChatAppShellProps = ChatAppShellMainProps | ChatAppShellCenterContentProps

const MANUAL_EXPAND_RELEASE_NARROWING = 8

function clampPaneStoredWidth(width: number): number {
  return Math.min(ARTIFACT_RIGHT_PANE_MAX_WIDTH, Math.max(ARTIFACT_RIGHT_PANE_MIN_WIDTH, Math.round(width)))
}

/**
 * Predicted-center auto-collapse for the left resource list (single source,
 * replacing the former center/shell crossing-edge observers):
 *
 * - Level + hysteresis: collapse while the center the list-expanded layout
 *   would yield is below the comfort threshold; restore with a small margin.
 *   The prediction depends only on shell width + persisted widths + pane open
 *   state — never on whether the list is currently expanded — so there is no
 *   feedback loop.
 * - Manual-expand suppression (hard block): a user who explicitly expanded the
 *   list keeps it until the shell net-narrows past a threshold, a user
 *   explicitly opens the panel, or the user collapses the list again.
 * - Drag exemption and full-width freeze delay evaluation; unfreezing
 *   re-evaluates once (still hard-blocked by suppression).
 */
function useResourceListAutoCollapse({
  leftPaneOpen,
  listResizing,
  onPaneAutoCollapseChange,
  paneManualToggle,
  rootRef
}: {
  leftPaneOpen: boolean
  listResizing: boolean
  onPaneAutoCollapseChange?: (collapsed: boolean) => void
  paneManualToggle?: PaneManualToggleSignal
  rootRef: RefObject<HTMLDivElement | null>
}) {
  const rightPanelState = useOptionalRightPanelState()
  const [storedListWidth] = usePersistCache('ui.chat.sidebar.width')
  const [storedPaneWidth] = usePersistCache('ui.chat.artifact_pane.width')

  const dockedPaneOpen = Boolean(rightPanelState?.presentationOpen && !rightPanelState.presentationMaximized)
  const frozen = Boolean(rightPanelState?.fullWidthActive || rightPanelState?.paneResizing || listResizing)
  const userOpenSeq = rightPanelState?.userOpenSeq ?? 0

  const shellWidthRef = useRef(0)
  const collapsedRef = useRef(false)
  const notifiedRef = useRef(false)
  const suppressedRef = useRef(false)
  const suppressStartShellRef = useRef(0)
  const pendingEvaluateRef = useRef(false)
  const consumedManualSeqRef = useRef(paneManualToggle?.seq ?? 0)
  const lastUserOpenSeqRef = useRef(userOpenSeq)
  const previousLeftPaneOpenRef = useRef(leftPaneOpen)

  const leftPaneOpenRef = useRef(leftPaneOpen)
  const frozenRef = useRef(frozen)
  const dockedPaneOpenRef = useRef(dockedPaneOpen)
  const widthsRef = useRef({ listWidth: 0, paneWidth: 0 })
  const onChangeRef = useRef(onPaneAutoCollapseChange)
  leftPaneOpenRef.current = leftPaneOpen
  frozenRef.current = frozen
  dockedPaneOpenRef.current = dockedPaneOpen
  widthsRef.current = {
    listWidth: clampResourceListPaneWidth(storedListWidth ?? 0),
    paneWidth: clampPaneStoredWidth(storedPaneWidth ?? 0)
  }
  useEffect(() => {
    onChangeRef.current = onPaneAutoCollapseChange
  }, [onPaneAutoCollapseChange])

  const notify = useCallback((collapsed: boolean, force = false) => {
    if (!force && notifiedRef.current === collapsed) return
    notifiedRef.current = collapsed
    onChangeRef.current?.(collapsed)
  }, [])

  const evaluate = useCallback(
    (forceNotify = false) => {
      if (suppressedRef.current) return
      if (frozenRef.current) {
        pendingEvaluateRef.current = true
        return
      }
      const shellWidth = shellWidthRef.current
      if (shellWidth <= 0) return

      const predictedCenter = predictCenterWidth({
        shellWidth,
        listWidth: widthsRef.current.listWidth,
        paneOpen: dockedPaneOpenRef.current,
        paneWidth: widthsRef.current.paneWidth
      })
      let next = evaluateAutoCollapse(predictedCenter, collapsedRef.current)
      // Never newly collapse a list the user is not showing; releasing stays allowed.
      if (next && !collapsedRef.current && !leftPaneOpenRef.current) next = collapsedRef.current
      if (next !== collapsedRef.current || forceNotify) {
        collapsedRef.current = next
        notify(next, forceNotify)
      }
    },
    [notify]
  )

  // Manual toggle signal — must be consumed before the paneOpen effect below so a
  // manual expand is never misread as a programmatic one (trigger 4).
  useLayoutEffect(() => {
    const signal = paneManualToggle
    if (!signal || signal.seq === consumedManualSeqRef.current) return
    consumedManualSeqRef.current = signal.seq
    if (signal.open) {
      suppressedRef.current = true
      suppressStartShellRef.current = shellWidthRef.current
      if (collapsedRef.current) {
        collapsedRef.current = false
        notify(false)
      }
    } else {
      suppressedRef.current = false
      evaluate()
    }
  }, [evaluate, notify, paneManualToggle])

  // Trigger 4: the list opened without a manual signal (history locate, layout
  // resets). Evaluate once and re-declare the output so the page-side flag and
  // this source cannot desync.
  useLayoutEffect(() => {
    const wasOpen = previousLeftPaneOpenRef.current
    previousLeftPaneOpenRef.current = leftPaneOpen
    if (!wasOpen && leftPaneOpen) evaluate(true)
  }, [evaluate, leftPaneOpen])

  // Docked open/close (including present-derived flips) re-evaluates; suppression
  // release via user open is keyed off userOpenSeq alone.
  useLayoutEffect(() => {
    evaluate()
  }, [dockedPaneOpen, evaluate])

  useLayoutEffect(() => {
    if (userOpenSeq === lastUserOpenSeqRef.current) return
    lastUserOpenSeqRef.current = userOpenSeq
    suppressedRef.current = false
    evaluate()
  }, [evaluate, userOpenSeq])

  // Persisted widths are live inputs (either side can be dragged); drag exemption
  // rides on `frozen`, so mid-drag updates defer to the release evaluation.
  useLayoutEffect(() => {
    evaluate()
  }, [evaluate, storedListWidth, storedPaneWidth])

  // Unfreeze → evaluate once (hard-blocked by suppression like every deferred pass).
  useLayoutEffect(() => {
    if (frozen || !pendingEvaluateRef.current) return
    pendingEvaluateRef.current = false
    evaluate()
  }, [evaluate, frozen])

  useEffect(() => {
    const root = rootRef.current
    if (!root || typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver(([entry]) => {
      const nextShellWidth = entry.contentRect.width
      if (nextShellWidth <= 0) return
      shellWidthRef.current = nextShellWidth

      if (suppressedRef.current) {
        if (suppressStartShellRef.current - nextShellWidth > MANUAL_EXPAND_RELEASE_NARROWING) {
          suppressedRef.current = false
          evaluate()
        }
        return
      }
      evaluate()
    })

    observer.observe(root)
    return () => observer.disconnect()
  }, [evaluate, rootRef])

  // Activity keep-alive resync: effects unmount while the tab is hidden, so drop
  // every retained input/output on teardown (and release the page-side flag);
  // remount re-measures and re-declares from scratch.
  useEffect(() => {
    return () => {
      if (collapsedRef.current) onChangeRef.current?.(false)
      collapsedRef.current = false
      notifiedRef.current = false
      suppressedRef.current = false
      pendingEvaluateRef.current = false
      shellWidthRef.current = 0
    }
  }, [])
}

export function ChatAppShell({
  topBar,
  pane,
  paneOpen,
  panePosition = 'left',
  main,
  centerContent,
  bottomComposer,
  sidePanel,
  centerOverlay,
  centerTopOverlay,
  rightPane,
  overlay,
  rootId,
  rootClassName,
  contentId,
  centerId,
  centerRef,
  centerClassName,
  onPaneCollapse,
  onPaneAutoCollapseChange,
  paneManualToggle
}: ChatAppShellProps) {
  const hasCenterContent = centerContent !== undefined
  const leftPaneOpen = Boolean(paneOpen && panePosition === 'left')
  const rightPanelState = useOptionalRightPanelState()
  // While the right pane maximizes/minimizes, its docked spacer snaps under the
  // covering surface; a FLIP layout animation would smear that snap across the
  // wipe as visible scale distortion, so the center reflows instantly instead.
  const centerTransition = rightPanelState?.layoutAnimationPending ? { duration: 0 } : CHAT_SHELL_TRANSITION
  const rootRef = useRef<HTMLDivElement>(null)
  const [listResizing, setListResizing] = useState(false)

  useResourceListAutoCollapse({
    leftPaneOpen,
    listResizing,
    onPaneAutoCollapseChange,
    paneManualToggle,
    rootRef
  })

  return (
    <div
      ref={rootRef}
      data-chat-app-shell-root
      id={rootId}
      className={cn('relative flex min-w-0 flex-1 flex-col overflow-hidden', rootClassName)}>
      <div id={contentId} className="flex min-w-0 flex-1 shrink flex-row overflow-hidden">
        <PageSidebar open={leftPaneOpen} onPaneCollapse={onPaneCollapse} onResizingChange={setListResizing}>
          {pane}
        </PageSidebar>

        <div data-chat-app-shell-main-region className="relative flex min-w-0 flex-1 overflow-hidden">
          <div className="relative flex min-w-0 flex-1 flex-col">
            <motion.div
              ref={centerRef}
              data-chat-app-shell-center
              id={centerId}
              layout
              transition={centerTransition}
              className={cn(
                'relative flex min-w-0 flex-1 flex-col overflow-hidden',
                centerClassName,
                // Let the elevated composer escape the center stacking context and paint
                // above the full-height maximized panel without replacing its editor DOM.
                rightPanelState?.presentationMaximized && '!transform-none !will-change-auto'
              )}>
              {topBar && (
                <div className="relative z-10 shrink-0 bg-background">
                  <ErrorBoundary>{topBar}</ErrorBoundary>
                </div>
              )}
              {hasCenterContent ? (
                <ErrorBoundary>{centerContent}</ErrorBoundary>
              ) : (
                <>
                  <ErrorBoundary>
                    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{main}</div>
                  </ErrorBoundary>
                  {bottomComposer && <ErrorBoundary>{bottomComposer}</ErrorBoundary>}
                </>
              )}
              {centerOverlay && <ErrorBoundary>{centerOverlay}</ErrorBoundary>}
            </motion.div>
            {centerTopOverlay && <OverlayHost>{centerTopOverlay}</OverlayHost>}
          </div>

          {rightPane}
        </div>

        <RightPaneHost open={Boolean(paneOpen && panePosition === 'right')}>{pane}</RightPaneHost>
      </div>

      {sidePanel && (
        <div data-chat-side-panel-host className="pointer-events-none absolute inset-0 z-80 *:pointer-events-auto">
          <ErrorBoundary>{sidePanel}</ErrorBoundary>
        </div>
      )}

      <OverlayHost>{overlay}</OverlayHost>
    </div>
  )
}
