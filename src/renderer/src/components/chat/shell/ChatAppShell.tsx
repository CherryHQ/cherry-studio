import { ErrorBoundary } from '@renderer/components/ErrorBoundary'
import { cn } from '@renderer/utils'
import { motion } from 'motion/react'
import type { ReactNode, Ref } from 'react'

import { OverlayHost } from './OverlayHost'
import { PageSidebar } from './PageSidebar'
import { RightPaneHost } from './RightPaneHost'
import { CHAT_SHELL_TRANSITION, type ChatPanePosition } from './types'

interface ChatAppShellBaseProps {
  topBar?: ReactNode
  pane?: ReactNode
  paneOpen?: boolean
  panePosition?: ChatPanePosition
  sidePanel?: ReactNode
  overlay?: ReactNode
  rootId?: string
  rootClassName?: string
  contentId?: string
  centerId?: string
  centerRef?: Ref<HTMLDivElement>
  centerClassName?: string
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
  overlay,
  rootId,
  rootClassName,
  contentId,
  centerId,
  centerRef,
  centerClassName
}: ChatAppShellProps) {
  const hasCenterContent = centerContent !== undefined

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
        </motion.div>

        <RightPaneHost open={paneOpen && panePosition === 'right'}>{pane}</RightPaneHost>
      </div>

      <OverlayHost>{overlay}</OverlayHost>
    </div>
  )
}
