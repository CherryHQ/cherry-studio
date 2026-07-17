import { QuickPanelProvider } from '@renderer/components/QuickPanel'
import { useWindowFrame } from '@renderer/hooks/useWindowFrame'
import { cn } from '@renderer/utils/style'
import type { ReactNode, Ref } from 'react'

import { useOptionalRightPanelState } from '../panes/Shell'
import { ChatAppShell } from './ChatAppShell'
import { ConversationTopBarPortalProvider } from './ConversationTopBarPortal'
import type { ChatPanePosition } from './paneLayout'

export interface ConversationShellProps {
  id?: string
  className?: string
  pane?: ReactNode
  paneOpen?: boolean
  panePosition?: ChatPanePosition
  topBar?: ReactNode
  topRightTool?: ReactNode
  showTopRightToolWhenPaneOpen?: boolean
  center: ReactNode
  sidePanel?: ReactNode
  centerOverlay?: ReactNode
  /** Overlay scoped to the center area but rendered above the center's transform/stacking layer. */
  centerTopOverlay?: ReactNode
  overlay?: ReactNode
  rightPane?: ReactNode
  centerId?: string
  centerRef?: Ref<HTMLDivElement>
  centerClassName?: string
  onPaneCollapse?: () => void
  onPaneAutoCollapseChange?: (collapsed: boolean) => void
}

export default function ConversationShell({
  id,
  className,
  pane,
  paneOpen,
  panePosition,
  topBar,
  topRightTool,
  showTopRightToolWhenPaneOpen = false,
  center,
  sidePanel,
  centerOverlay,
  centerTopOverlay,
  overlay,
  rightPane,
  centerId,
  centerRef,
  centerClassName,
  onPaneCollapse,
  onPaneAutoCollapseChange
}: ConversationShellProps) {
  const { mode } = useWindowFrame()
  const isWindow = mode === 'window'

  const resolvedTopBar = topRightTool ? (
    <ConversationShellTopBar topRightTool={topRightTool} showTopRightToolWhenPaneOpen={showTopRightToolWhenPaneOpen}>
      {topBar}
    </ConversationShellTopBar>
  ) : (
    topBar
  )
  return (
    <div
      id={id}
      className={cn(
        'relative flex flex-1 overflow-hidden bg-background',
        isWindow ? 'h-full' : 'h-[calc(100vh-var(--navbar-height)-6px)] rounded-tl-[10px] rounded-bl-[10px]',
        className
      )}>
      <QuickPanelProvider>
        <ConversationTopBarPortalProvider>
          <ChatAppShell
            pane={pane}
            paneOpen={paneOpen}
            panePosition={panePosition}
            topBar={resolvedTopBar}
            centerContent={center}
            sidePanel={sidePanel}
            centerOverlay={centerOverlay}
            centerTopOverlay={centerTopOverlay}
            rightPane={rightPane}
            overlay={overlay}
            centerId={centerId}
            centerRef={centerRef}
            centerClassName={centerClassName}
            onPaneCollapse={onPaneCollapse}
            onPaneAutoCollapseChange={onPaneAutoCollapseChange}
          />
        </ConversationTopBarPortalProvider>
      </QuickPanelProvider>
    </div>
  )
}

type TopBarProps = {
  topRightTool?: ReactNode
  showTopRightToolWhenPaneOpen: boolean
  children?: ReactNode
}

const ConversationShellTopBar = ({ topRightTool, showTopRightToolWhenPaneOpen, children }: TopBarProps) => {
  const presentationState = useOptionalRightPanelState()
  const maximized = presentationState?.presentationMaximized ?? false
  const open = presentationState?.presentationOpen ?? false
  const shouldShowTopRightTool = Boolean(topRightTool) && !maximized && (!open || showTopRightToolWhenPaneOpen)
  return (
    <div
      data-conversation-shell-topbar
      className='relative flex h-fit w-full min-w-0 items-center after:pointer-events-none after:absolute after:right-0 after:bottom-0 after:left-0 after:h-px after:bg-border-subtle after:content-[""]'>
      <div data-conversation-shell-topbar-content className="min-w-0 flex-1">
        {children}
      </div>
      {shouldShowTopRightTool && (
        <div
          data-conversation-shell-topbar-right
          data-navbar-right-occupant
          className="z-20 flex h-(--navbar-height) shrink-0 items-center gap-0.5 [-webkit-app-region:no-drag]">
          {topRightTool}
        </div>
      )}
      {shouldShowTopRightTool && (
        <div data-conversation-shell-right-spacer aria-hidden="true" className="w-2 shrink-0" />
      )}
    </div>
  )
}
