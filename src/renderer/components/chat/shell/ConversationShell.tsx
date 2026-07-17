import { TITLE_BAR_HEIGHT_CLASS, TITLE_BAR_HEIGHT_PX } from '@renderer/components/layout/titleBar'
import { QuickPanelProvider } from '@renderer/components/QuickPanel'
import { useWindowFrame } from '@renderer/hooks/useWindowFrame'
import { isMac } from '@renderer/utils/platform'
import { cn } from '@renderer/utils/style'
import type { CSSProperties, ReactNode, Ref } from 'react'

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
  const { mode, chrome, translucent = false } = useWindowFrame()
  const isWindow = mode === 'window'
  const leftPaneOpen = Boolean(paneOpen && (panePosition ?? 'left') === 'left')
  const rightPanelState = useOptionalRightPanelState()
  const rightPanelOpen = rightPanelState?.presentationOpen ?? false
  const rightPanelMaximized = rightPanelState?.presentationMaximized ?? false

  const resolvedTopBar =
    topRightTool || isWindow ? (
      <ConversationShellTopBar
        isWindow={isWindow}
        leftPaneOpen={leftPaneOpen}
        leading={chrome?.titleLeading}
        trailing={chrome?.titleTrailing}
        topRightTool={topRightTool}
        showTopRightToolWhenPaneOpen={showTopRightToolWhenPaneOpen}>
        {topBar}
      </ConversationShellTopBar>
    ) : (
      topBar
    )

  return (
    <div
      id={id}
      className={cn(
        'relative flex flex-1 overflow-hidden',
        isWindow
          ? cn('h-screen', translucent ? 'bg-sidebar/70' : 'bg-sidebar')
          : 'h-[calc(100vh-var(--navbar-height)-6px)] rounded-tl-[10px] rounded-bl-[10px] bg-background',
        className
      )}>
      {isWindow && (
        <div
          data-conversation-shell-drag-strip
          aria-hidden="true"
          className={cn('absolute inset-x-0 top-0 [-webkit-app-region:drag]', TITLE_BAR_HEIGHT_CLASS)}
        />
      )}
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
      {isWindow && (rightPanelOpen || rightPanelMaximized) && chrome?.titleTrailing && (
        <div
          data-conversation-shell-floating-trailing
          className={cn(
            'absolute top-0 right-[calc(0.5rem+var(--window-controls-width,0px))] z-20 flex items-center gap-0.5 [-webkit-app-region:no-drag]',
            TITLE_BAR_HEIGHT_CLASS
          )}>
          {chrome.titleTrailing}
        </div>
      )}
    </div>
  )
}

type TopBarProps = {
  isWindow: boolean
  leftPaneOpen: boolean
  leading?: ReactNode
  trailing?: ReactNode
  topRightTool?: ReactNode
  showTopRightToolWhenPaneOpen: boolean
  children?: ReactNode
}

const ConversationShellTopBar = ({
  isWindow,
  leftPaneOpen,
  leading,
  trailing,
  topRightTool,
  showTopRightToolWhenPaneOpen,
  children
}: TopBarProps) => {
  const presentationState = useOptionalRightPanelState()
  const maximized = presentationState?.presentationMaximized ?? false
  const open = presentationState?.presentationOpen ?? false
  const windowNavbarHeightStyle = isWindow ? ({ '--navbar-height': TITLE_BAR_HEIGHT_PX } as CSSProperties) : undefined
  const shouldReserveTrafficLightInset = isWindow && isMac && !leftPaneOpen
  const shouldShowTrailing = isWindow && Boolean(trailing) && !open && !maximized
  const shouldShowTopRightTool = Boolean(topRightTool) && !maximized && (!open || showTopRightToolWhenPaneOpen)
  const shouldShowRightCluster = shouldShowTrailing || shouldShowTopRightTool
  const shouldReserveWindowControls = isWindow && !open && !maximized
  const shouldReserveRightInset = shouldShowRightCluster || shouldReserveWindowControls

  return (
    <div
      data-conversation-shell-topbar
      style={windowNavbarHeightStyle}
      className={cn(
        'relative flex h-fit w-full min-w-0 items-center',
        !isWindow &&
          'after:pointer-events-none after:absolute after:right-0 after:bottom-0 after:left-0 after:h-px after:bg-border-subtle after:content-[""]',
        isWindow && [
          TITLE_BAR_HEIGHT_CLASS,
          '[-webkit-app-region:drag]',
          shouldReserveTrafficLightInset ? 'pl-[env(titlebar-area-x)]' : 'pl-2'
        ]
      )}>
      {leading}
      <div data-conversation-shell-topbar-content className="min-w-0 flex-1">
        {children}
      </div>
      {shouldShowRightCluster && (
        <div
          data-conversation-shell-topbar-right
          data-navbar-right-occupant
          className={cn(
            'z-20 flex shrink-0 items-center gap-0.5 [-webkit-app-region:no-drag]',
            isWindow ? TITLE_BAR_HEIGHT_CLASS : 'h-(--navbar-height)'
          )}>
          {shouldShowTrailing && trailing}
          {topRightTool}
        </div>
      )}
      {shouldReserveRightInset && (
        <div
          data-conversation-shell-right-spacer
          aria-hidden="true"
          className={cn(
            'shrink-0',
            shouldReserveWindowControls ? 'w-[calc(0.5rem+var(--window-controls-width,0px))]' : 'w-2'
          )}
        />
      )}
    </div>
  )
}
