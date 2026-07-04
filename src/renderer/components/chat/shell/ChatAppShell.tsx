import {
  ImmersiveNarrowReportProvider,
  ImmersiveNavbarStateProvider,
  resolveImmersiveNavbar
} from '@renderer/components/chat/layout/ImmersiveNavbarContext'
import { ErrorBoundary } from '@renderer/components/ErrorBoundary'
import { TITLE_BAR_HEIGHT_PX } from '@renderer/components/layout/titleBar'
import { useWindowFrame } from '@renderer/hooks/useWindowFrame'
import { cn } from '@renderer/utils/style'
import { motion } from 'motion/react'
import type { ReactNode, Ref } from 'react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { OverlayHost } from './OverlayHost'
import { PageSidebar } from './PageSidebar'
import {
  CHAT_CENTER_MIN_USABLE_WIDTH,
  CHAT_SHELL_TRANSITION,
  type ChatPanePosition,
  RESOURCE_LIST_PANE_AUTO_COLLAPSE_WIDTH
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
  const rootRef = useRef<HTMLDivElement>(null)
  const centerInnerRef = useRef<HTMLDivElement | null>(null)
  const leftPaneOpenRef = useRef(leftPaneOpen)
  const onPaneAutoCollapseChangeRef = useRef(onPaneAutoCollapseChange)
  const autoCollapseReasonsRef = useRef<Record<AutoCollapseSource, boolean>>({ center: false, shell: false })
  const previousShellWidthRef = useRef<number | null>(null)
  const previousCenterWidthRef = useRef<number | null>(null)

  // Immersive navbar owner: the top bar floats over the message list when the list is narrow
  // (centered) and the center is wide enough for the navbar's edge clusters. Decided from a single
  // self-measurement (the center's own width) + a `narrow` boolean the list reports up — no probe,
  // no occupant scraping. When floating, a CSS clamp keeps the navbar's clusters inside the gutters.
  const isWindow = useWindowFrame().mode === 'window'
  const [centerWidth, setCenterWidth] = useState(0)
  const [narrow, setNarrow] = useState(false)
  const reportNarrow = useCallback((next: boolean) => {
    setNarrow((current) => (current === next ? current : next))
  }, [])
  const immersive = useMemo(
    () => resolveImmersiveNavbar({ narrow, centerWidth, isWindow }),
    [narrow, centerWidth, isWindow]
  )
  const updatePaneAutoCollapse = useCallback((source: AutoCollapseSource, collapsed: boolean) => {
    const reasons = autoCollapseReasonsRef.current
    const wasCollapsed = reasons.center || reasons.shell
    reasons[source] = collapsed
    const isCollapsed = reasons.center || reasons.shell

    if (wasCollapsed !== isCollapsed) {
      onPaneAutoCollapseChangeRef.current?.(isCollapsed)
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
    setCenterWidth(initialCenterWidth)
    const observer = new ResizeObserver(([entry]) => {
      const previousCenterWidth = previousCenterWidthRef.current
      const nextCenterWidth = entry.contentRect.width
      previousCenterWidthRef.current = nextCenterWidth
      setCenterWidth(nextCenterWidth)

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
      previousShellWidthRef.current = nextShellWidth

      if (previousShellWidth === null) return

      if (
        leftPaneOpenRef.current &&
        previousShellWidth >= RESOURCE_LIST_PANE_AUTO_COLLAPSE_WIDTH &&
        nextShellWidth < RESOURCE_LIST_PANE_AUTO_COLLAPSE_WIDTH
      ) {
        updatePaneAutoCollapse('shell', true)
        return
      }

      if (
        previousShellWidth < RESOURCE_LIST_PANE_AUTO_COLLAPSE_WIDTH &&
        nextShellWidth >= RESOURCE_LIST_PANE_AUTO_COLLAPSE_WIDTH
      ) {
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
        <PageSidebar
          open={leftPaneOpen}
          style={isWindow ? { paddingTop: TITLE_BAR_HEIGHT_PX } : undefined}
          onPaneCollapse={onPaneCollapse}>
          {pane}
        </PageSidebar>

        <div className="relative flex min-w-0 flex-1 flex-col">
          <motion.div
            ref={assignCenterRef}
            data-chat-app-shell-center
            id={centerId}
            layout
            transition={CHAT_SHELL_TRANSITION}
            className={cn('relative flex min-w-0 flex-1 flex-col overflow-hidden', centerClassName)}>
            {topBar && (
              <div
                data-chat-navbar-floating={immersive.floating ? '' : undefined}
                className={cn(
                  'z-10',
                  immersive.floating
                    ? 'absolute inset-x-0 top-0 [&_[data-conversation-shell-topbar]::after]:hidden'
                    : 'relative shrink-0'
                )}>
                <ErrorBoundary>{topBar}</ErrorBoundary>
              </div>
            )}
            <ImmersiveNarrowReportProvider value={reportNarrow}>
              <ImmersiveNavbarStateProvider value={immersive}>
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
              </ImmersiveNavbarStateProvider>
            </ImmersiveNarrowReportProvider>
            {centerOverlay && <ErrorBoundary>{centerOverlay}</ErrorBoundary>}
          </motion.div>
          {centerTopOverlay && <OverlayHost>{centerTopOverlay}</OverlayHost>}
        </div>

        <RightPaneHost open={paneOpen && panePosition === 'right'}>{pane}</RightPaneHost>
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
