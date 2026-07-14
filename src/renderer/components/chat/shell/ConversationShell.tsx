import { TITLE_BAR_HEIGHT_CLASS, TITLE_BAR_HEIGHT_PX } from '@renderer/components/layout/titleBar'
import { QuickPanelProvider } from '@renderer/components/QuickPanel'
import { useWindowFrame } from '@renderer/hooks/useWindowFrame'
import { isMac } from '@renderer/utils/platform'
import { cn } from '@renderer/utils/style'
import type { CSSProperties, ReactNode, Ref } from 'react'

import { ChatMaximizedOverlayInsetProvider } from '../layout/ChatViewportInsetContext'
import { useOptionalShellState } from '../panes/Shell'
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
  const { mode, chrome } = useWindowFrame()
  const isWindow = mode === 'window'
  const leftPaneOpen = Boolean(paneOpen && (panePosition ?? 'left') === 'left')

  // In window mode the page navbar IS the window title bar, so wrap it even without a
  // right tool to pick up the drag region, traffic-light inset, and title-leading slot.
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
    <ChatMaximizedOverlayInsetProvider>
      <div
        id={id}
        className={cn(
          'relative flex flex-1 overflow-hidden bg-background',
          isWindow ? 'h-screen' : 'h-[calc(100vh-var(--navbar-height)-6px)] rounded-tl-[10px] rounded-bl-[10px]',
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
              overlay={overlay}
              centerId={centerId}
              centerRef={centerRef}
              centerClassName={centerClassName}
              onPaneCollapse={onPaneCollapse}
              onPaneAutoCollapseChange={onPaneAutoCollapseChange}
            />
          </ConversationTopBarPortalProvider>
        </QuickPanelProvider>
        {rightPane}
      </div>
    </ChatMaximizedOverlayInsetProvider>
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
  const shellState = useOptionalShellState()
  const maximized = shellState?.maximized ?? false
  const open = shellState?.open ?? false
  const windowNavbarHeightStyle = isWindow ? ({ '--navbar-height': TITLE_BAR_HEIGHT_PX } as CSSProperties) : undefined
  const shouldReserveTrafficLightInset = isWindow && isMac && !leftPaneOpen
  const shouldShowTopRightTool =
    !maximized && (!open || showTopRightToolWhenPaneOpen) && Boolean(trailing || topRightTool)
  const shouldReserveRightInset = !maximized && ((!open && isWindow) || shouldShowTopRightTool)
  return (
    <div
      data-conversation-shell-topbar
      style={windowNavbarHeightStyle}
      className={cn(
        'relative flex h-fit w-full min-w-0 items-center after:pointer-events-none after:absolute after:right-0 after:bottom-0 after:left-0 after:h-px after:bg-border-subtle after:content-[""]',
        // Window mode: the navbar is the window title bar. Only reserve the macOS traffic-light
        // inset when the left pane is closed; an open pane already owns that area.
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
      {shouldShowTopRightTool && (
        <div
          data-conversation-shell-topbar-right
          data-navbar-right-occupant
          className={cn(
            'z-20 flex shrink-0 items-center gap-0.5 [-webkit-app-region:no-drag]',
            isWindow ? TITLE_BAR_HEIGHT_CLASS : 'h-(--navbar-height)'
          )}>
          {trailing}
          {topRightTool}
        </div>
      )}
      {shouldReserveRightInset && (
        <div
          data-conversation-shell-right-spacer
          aria-hidden="true"
          className={cn('shrink-0', isWindow ? 'w-[calc(0.5rem+var(--window-controls-width,0px))]' : 'w-2')}
        />
      )}
    </div>
  )
}
