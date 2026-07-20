import { ErrorBoundary } from '@renderer/components/ErrorBoundary'
import { cn } from '@renderer/utils/style'
import { motion } from 'motion/react'
import type { ReactNode, Ref } from 'react'
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'

import { useOptionalRightPanelState } from '../panes/Shell'
import { OverlayHost } from './OverlayHost'
import { PageSidebar } from './PageSidebar'
import {
  CHAT_CENTER_MIN_USABLE_WIDTH,
  CHAT_SHELL_TRANSITION,
  type ChatPanePosition,
  RESOURCE_LIST_PANE_AUTO_COLLAPSE_WIDTH,
  RESOURCE_LIST_PANE_MIN_WIDTH
} from './paneLayout'
import { RightPaneHost } from './RightPaneHost'

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

type AutoCollapseSource = 'center' | 'shell'

function getResourceListPaneAutoCollapseWidth() {
  if (typeof document === 'undefined') {
    return RESOURCE_LIST_PANE_MIN_WIDTH + CHAT_CENTER_MIN_USABLE_WIDTH
  }

  const paneWidth = Number.parseFloat(document.documentElement.style.getPropertyValue('--assistants-width'))
  const resolvedPaneWidth = Number.isFinite(paneWidth) && paneWidth > 0 ? paneWidth : RESOURCE_LIST_PANE_MIN_WIDTH

  return Math.max(RESOURCE_LIST_PANE_AUTO_COLLAPSE_WIDTH, resolvedPaneWidth + CHAT_CENTER_MIN_USABLE_WIDTH)
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
  onPaneAutoCollapseChange
}: ChatAppShellProps) {
  const hasCenterContent = centerContent !== undefined
  const leftPaneOpen = Boolean(paneOpen && panePosition === 'left')
  const rightPanelState = useOptionalRightPanelState()
  // While the right pane maximizes/minimizes, its docked spacer snaps under the
  // covering surface; a FLIP layout animation would smear that snap across the
  // wipe as visible scale distortion, so the center reflows instantly instead.
  const centerTransition = rightPanelState?.layoutAnimationPending ? { duration: 0 } : CHAT_SHELL_TRANSITION
  const rootRef = useRef<HTMLDivElement>(null)
  const centerInnerRef = useRef<HTMLDivElement | null>(null)
  const leftPaneOpenRef = useRef(leftPaneOpen)
  const onPaneAutoCollapseChangeRef = useRef(onPaneAutoCollapseChange)
  const autoCollapseReasonsRef = useRef<Record<AutoCollapseSource, boolean>>({ center: false, shell: false })
  const previousShellWidthRef = useRef<number | null>(null)
  const previousCenterWidthRef = useRef<number | null>(null)

  const updatePaneAutoCollapse = useCallback((source: AutoCollapseSource, collapsed: boolean) => {
    const reasons = autoCollapseReasonsRef.current
    const wasCollapsed = reasons.center || reasons.shell
    reasons[source] = collapsed
    const isCollapsed = reasons.center || reasons.shell

    if (wasCollapsed !== isCollapsed) {
      onPaneAutoCollapseChangeRef.current?.(isCollapsed)
    }
  }, [])

  useEffect(() => {
    return () => {
      const reasons = autoCollapseReasonsRef.current
      if (reasons.center || reasons.shell) {
        onPaneAutoCollapseChangeRef.current?.(false)
      }
    }
  }, [])

  // Merge the forwarded centerRef with our own ref so we can measure the center element's width.
  const assignCenterRef = useCallback(
    (node: HTMLDivElement | null) => {
      centerInnerRef.current = node
      if (typeof centerRef === 'function') centerRef(node)
      else if (centerRef) (centerRef as { current: HTMLDivElement | null }).current = node
    },
    [centerRef]
  )

  useEffect(() => {
    leftPaneOpenRef.current = leftPaneOpen
    onPaneAutoCollapseChangeRef.current = onPaneAutoCollapseChange
  }, [leftPaneOpen, onPaneAutoCollapseChange])

  useLayoutEffect(() => {
    const center = centerInnerRef.current
    if (!center || typeof ResizeObserver === 'undefined') return
    const initialCenterWidth = center.getBoundingClientRect().width
    previousCenterWidthRef.current = initialCenterWidth > 0 ? initialCenterWidth : null
    const observer = new ResizeObserver(([entry]) => {
      const previousCenterWidth = previousCenterWidthRef.current
      const nextCenterWidth = entry.contentRect.width
      previousCenterWidthRef.current = nextCenterWidth

      if (previousCenterWidth === null) return

      if (
        leftPaneOpenRef.current &&
        previousCenterWidth >= CHAT_CENTER_MIN_USABLE_WIDTH &&
        nextCenterWidth < CHAT_CENTER_MIN_USABLE_WIDTH
      ) {
        updatePaneAutoCollapse('center', true)
        return
      }

      if (previousCenterWidth < CHAT_CENTER_MIN_USABLE_WIDTH && nextCenterWidth >= CHAT_CENTER_MIN_USABLE_WIDTH) {
        updatePaneAutoCollapse('center', false)
      }
    })
    observer.observe(center)
    return () => observer.disconnect()
  }, [updatePaneAutoCollapse])

  useEffect(() => {
    const root = rootRef.current
    if (!root || typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver(([entry]) => {
      const previousShellWidth = previousShellWidthRef.current
      const nextShellWidth = entry.contentRect.width
      const autoCollapseWidth = getResourceListPaneAutoCollapseWidth()
      previousShellWidthRef.current = nextShellWidth

      if (previousShellWidth === null) return

      if (leftPaneOpenRef.current && previousShellWidth >= autoCollapseWidth && nextShellWidth < autoCollapseWidth) {
        updatePaneAutoCollapse('shell', true)
        return
      }

      if (previousShellWidth < autoCollapseWidth && nextShellWidth >= autoCollapseWidth) {
        updatePaneAutoCollapse('shell', false)
      }
    })

    observer.observe(root)
    return () => observer.disconnect()
  }, [updatePaneAutoCollapse])

  return (
    <div
      ref={rootRef}
      data-chat-app-shell-root
      id={rootId}
      className={cn('relative flex min-w-0 flex-1 flex-col overflow-hidden', rootClassName)}>
      <div id={contentId} className="flex min-w-0 flex-1 shrink flex-row overflow-hidden">
        <PageSidebar open={leftPaneOpen} onPaneCollapse={onPaneCollapse}>
          {pane}
        </PageSidebar>

        <div data-chat-app-shell-main-region className="relative flex min-w-0 flex-1 overflow-hidden">
          <div className="relative flex min-w-0 flex-1 flex-col">
            <motion.div
              ref={assignCenterRef}
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
