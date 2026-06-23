import { useWindowFrame } from '@renderer/components/chat/shell/WindowFrameContext'
import { TITLE_BAR_HEIGHT_CLASS, TITLE_BAR_HEIGHT_PX } from '@renderer/components/layout/titleBar'
import { QuickPanelProvider } from '@renderer/components/QuickPanel'
import { isMac } from '@renderer/config/constant'
import { cn } from '@renderer/utils'
import type { CSSProperties, ReactNode, Ref } from 'react'

import { ChatMaximizedOverlayInsetProvider } from '../layout/ChatViewportInsetContext'
import { useOptionalShellState } from '../panes/Shell'
import { ChatAppShell } from './ChatAppShell'
import type { ChatPanePosition } from './paneLayout'

export interface ConversationShellProps {
  id?: string
  className?: string
  pane?: ReactNode
  paneOpen?: boolean
  panePosition?: ChatPanePosition
  topBar?: ReactNode
  topRightTool?: ReactNode
  topRightToolReserve?: 'single' | 'double'
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
}

export default function ConversationShell({
  id,
  className,
  pane,
  paneOpen,
  panePosition,
  topBar,
  topRightTool,
  topRightToolReserve = 'single',
  center,
  sidePanel,
  centerOverlay,
  centerTopOverlay,
  overlay,
  rightPane,
  centerId,
  centerRef,
  centerClassName,
  onPaneCollapse
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
        topRightToolReserve={topRightToolReserve}>
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
          />
        </QuickPanelProvider>
        {(topRightTool || isWindow) && (
          <ConversationShellTopRightTool isWindow={isWindow} trailing={chrome?.titleTrailing}>
            {topRightTool}
          </ConversationShellTopRightTool>
        )}
        {rightPane}
      </div>
    </ChatMaximizedOverlayInsetProvider>
  )
}

type TopBarProps = {
  isWindow: boolean
  leftPaneOpen: boolean
  leading?: ReactNode
  topRightToolReserve: 'single' | 'double'
  children?: ReactNode
}

const ConversationShellTopBar = ({ isWindow, leftPaneOpen, leading, topRightToolReserve, children }: TopBarProps) => {
  const shellState = useOptionalShellState()
  const maximized = shellState?.maximized ?? false
  const windowNavbarHeightStyle = isWindow ? ({ '--navbar-height': TITLE_BAR_HEIGHT_PX } as CSSProperties) : undefined
  const shouldReserveTrafficLightInset = isWindow && isMac && !leftPaneOpen
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
        ],
        // Reserve room for the floating right group: wider in window mode (pin + back + tool).
        !maximized && (isWindow ? 'pr-28' : topRightToolReserve === 'double' ? 'pr-[76px]' : 'pr-11')
      )}>
      {leading}
      {children}
    </div>
  )
}

type TopRightToolProps = { isWindow: boolean; trailing?: ReactNode; children?: ReactNode }

const ConversationShellTopRightTool = ({ isWindow, trailing, children }: TopRightToolProps) => {
  const shellState = useOptionalShellState()
  // When the pane is open or maximized, the navbar cluster (sub-window chrome + page tool)
  // moves into Shell.TabList's extraTrailing slot — see TopicRightPane / AgentRightPane.
  // Rendering both at once would let pin/back/toggle visually overlap the pane's own header.
  if (shellState?.open || shellState?.maximized) return null
  return (
    <div
      data-navbar-right-occupant
      className={cn(
        'absolute top-0 right-2 z-20 flex items-center gap-0.5 [-webkit-app-region:no-drag]',
        // Window mode: shorter bar (lines up with the traffic lights) + injected controls
        // (pin / back-to-main) to the left of the page's own tool.
        isWindow ? TITLE_BAR_HEIGHT_CLASS : 'h-(--navbar-height)'
      )}>
      {trailing}
      {children}
    </div>
  )
}
