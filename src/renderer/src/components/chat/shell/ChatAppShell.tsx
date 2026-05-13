import { ErrorBoundary } from '@renderer/components/ErrorBoundary'
import { cn } from '@renderer/utils'
import { motion } from 'motion/react'
import type { ReactNode, Ref } from 'react'

import { OverlayHost } from './OverlayHost'
import { PageSidebar } from './PageSidebar'
import { RightPaneHost } from './RightPaneHost'
import { CHAT_SHELL_TRANSITION, type ChatPanePosition } from './types'

export interface ChatAppShellProps {
  topBar?: ReactNode
  pane?: ReactNode
  paneOpen?: boolean
  panePosition?: ChatPanePosition
  main: ReactNode
  bottomComposer?: ReactNode
  sidePanel?: ReactNode
  overlay?: ReactNode
  rootId?: string
  rootClassName?: string
  contentId?: string
  centerId?: string
  centerRef?: Ref<HTMLDivElement>
  centerClassName?: string
}

export function ChatAppShell({
  topBar,
  pane,
  paneOpen,
  panePosition = 'left',
  main,
  bottomComposer,
  sidePanel,
  overlay,
  rootId,
  rootClassName,
  contentId,
  centerId,
  centerRef,
  centerClassName
}: ChatAppShellProps) {
  return (
    <div id={rootId} className={cn('relative flex min-w-0 flex-1 flex-col overflow-hidden', rootClassName)}>
      <div id={contentId} className="flex min-w-0 flex-1 shrink flex-row overflow-hidden">
        <PageSidebar open={paneOpen && panePosition === 'left'}>{pane}</PageSidebar>

        <motion.div
          ref={centerRef}
          id={centerId}
          layout
          transition={CHAT_SHELL_TRANSITION}
          className={cn('relative flex min-w-0 flex-1 flex-col overflow-hidden', centerClassName)}>
          {topBar && <ErrorBoundary>{topBar}</ErrorBoundary>}
          {sidePanel && <ErrorBoundary>{sidePanel}</ErrorBoundary>}
          <ErrorBoundary>
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{main}</div>
          </ErrorBoundary>
          {bottomComposer && <ErrorBoundary>{bottomComposer}</ErrorBoundary>}
        </motion.div>

        <RightPaneHost open={paneOpen && panePosition === 'right'}>{pane}</RightPaneHost>
      </div>

      <OverlayHost>{overlay}</OverlayHost>
    </div>
  )
}
