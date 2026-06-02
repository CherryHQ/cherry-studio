import {
  ImmersiveNarrowReportProvider,
  ImmersiveNavbarStateProvider,
  resolveImmersiveNavbar
} from '@renderer/components/chat/layout/ImmersiveNavbarContext'
import { ErrorBoundary } from '@renderer/components/ErrorBoundary'
import { useWindowFrame } from '@renderer/context/WindowFrameContext'
import { cn } from '@renderer/utils'
import { motion } from 'motion/react'
import type { ReactNode, Ref } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { OverlayHost } from './OverlayHost'
import { PageSidebar } from './PageSidebar'
import { RightPaneHost } from './RightPaneHost'
import { CHAT_SHELL_TRANSITION, type ChatPanePosition } from './types'

const RESOURCE_LIST_PANE_AUTO_COLLAPSE_WIDTH = 540

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
  onPaneCollapse
}: ChatAppShellProps) {
  const hasCenterContent = centerContent !== undefined
  const leftPaneOpen = Boolean(paneOpen && panePosition === 'left')
  const rootRef = useRef<HTMLDivElement>(null)
  const centerInnerRef = useRef<HTMLDivElement | null>(null)
  const leftPaneOpenRef = useRef(leftPaneOpen)
  const onPaneCollapseRef = useRef(onPaneCollapse)
  const previousShellWidthRef = useRef<number | null>(null)

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
    onPaneCollapseRef.current = onPaneCollapse
  }, [leftPaneOpen, onPaneCollapse])

  useEffect(() => {
    const center = centerInnerRef.current
    if (!center || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      setCenterWidth(entry.contentRect.width)
    })
    observer.observe(center)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const root = rootRef.current
    if (!root || typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver(([entry]) => {
      const previousShellWidth = previousShellWidthRef.current
      const nextShellWidth = entry.contentRect.width
      previousShellWidthRef.current = nextShellWidth

      if (previousShellWidth === null) return
      if (!leftPaneOpenRef.current) return
      if (previousShellWidth < RESOURCE_LIST_PANE_AUTO_COLLAPSE_WIDTH) return
      if (nextShellWidth >= RESOURCE_LIST_PANE_AUTO_COLLAPSE_WIDTH) return

      onPaneCollapseRef.current?.()
    })

    observer.observe(root)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={rootRef}
      id={rootId}
      className={cn('relative flex min-w-0 flex-1 flex-col overflow-hidden', rootClassName)}>
      <div id={contentId} className="flex min-w-0 flex-1 shrink flex-row overflow-hidden">
        <PageSidebar open={leftPaneOpen} onPaneCollapse={onPaneCollapse}>
          {pane}
        </PageSidebar>

        <div className="relative flex min-w-0 flex-1 flex-col">
          <motion.div
            ref={assignCenterRef}
            id={centerId}
            layout
            transition={CHAT_SHELL_TRANSITION}
            className={cn('relative flex min-w-0 flex-1 flex-col overflow-hidden', centerClassName)}>
            {topBar && (
              <div
                data-chat-navbar-floating={immersive.floating ? '' : undefined}
                className={cn('z-10', immersive.floating ? 'absolute inset-x-0 top-0' : 'relative shrink-0')}>
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
