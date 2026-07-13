import { TITLE_BAR_HEIGHT_CLASS, TITLE_BAR_HEIGHT_PX } from '@renderer/components/layout/titleBar'
import { QuickPanelProvider } from '@renderer/components/QuickPanel'
import useMacTransparentWindow from '@renderer/hooks/useMacTransparentWindow'
import useWindowFocus from '@renderer/hooks/useWindowFocus'
import { useWindowFrame } from '@renderer/hooks/useWindowFrame'
import { isMac } from '@renderer/utils/platform'
import { cn } from '@renderer/utils/style'
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
  const isMacTransparentWindow = useMacTransparentWindow()
  const isWindowFocused = useWindowFocus()
  const isGlassActive = isMacTransparentWindow && isWindowFocused
  const leftPaneOpen = Boolean(paneOpen && (panePosition ?? 'left') === 'left')
  // While the side pane is open (docked or maximized), the navbar (which spans only the
  // center column) can't host the window controls, so pin/back-to-main float at the root's
  // top-right corner to stay on the title-bar glass instead of sinking into the pane card.
  const shellState = useOptionalShellState()
  const sidePaneOpen = Boolean(shellState?.open)

  // In window mode the page navbar IS the window title bar, so wrap it even without a
  // right tool to pick up the drag region, traffic-light inset, and title-leading slot.
  const resolvedTopBar =
    topRightTool || isWindow ? (
      <ConversationShellTopBar
        isWindow={isWindow}
        leftPaneOpen={leftPaneOpen}
        leading={chrome?.titleLeading}
        trailing={chrome?.titleTrailing}
        topRightTool={topRightTool}>
        {topBar}
      </ConversationShellTopBar>
    ) : (
      topBar
    )
  // Window mode: match the global detached-window chrome — the navbar (window title bar)
  // stays on the sidebar-tinted glass shell; the conversation body below it is framed as
  // the floating bordered card inside ChatAppShell's window-mode branch.
  const shell = (
    <div
      id={id}
      className={cn(
        'relative flex flex-1 overflow-hidden',
        isWindow
          ? cn('h-screen', isGlassActive ? 'bg-sidebar-translucent' : 'bg-sidebar')
          : 'h-[calc(100vh-var(--navbar-height)-6px)] rounded-tl-[10px] rounded-bl-[10px] bg-background',
        className
      )}>
      {/* The navbar (window title bar) spans only the center column, so this full-width strip
          keeps the entire window top edge draggable — e.g. the glass above the docked side pane.
          Interactive clusters painted above it (navbar buttons, floating controls) opt out with
          no-drag and punch holes in the region. */}
      {isWindow && (
        <div
          data-conversation-shell-drag-strip
          aria-hidden="true"
          className={cn('absolute inset-x-0 top-0 [-webkit-app-region:drag]', TITLE_BAR_HEIGHT_CLASS)}
        />
      )}
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
          onPaneAutoCollapseChange={onPaneAutoCollapseChange}
        />
      </QuickPanelProvider>
      {rightPane}
      {isWindow && sidePaneOpen && chrome?.titleTrailing && (
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

  return <ChatMaximizedOverlayInsetProvider>{shell}</ChatMaximizedOverlayInsetProvider>
}

type TopBarProps = {
  isWindow: boolean
  leftPaneOpen: boolean
  leading?: ReactNode
  trailing?: ReactNode
  topRightTool?: ReactNode
  children?: ReactNode
}

const ConversationShellTopBar = ({
  isWindow,
  leftPaneOpen,
  leading,
  trailing,
  topRightTool,
  children
}: TopBarProps) => {
  const shellState = useOptionalShellState()
  const maximized = shellState?.maximized ?? false
  const open = shellState?.open ?? false
  const windowNavbarHeightStyle = isWindow ? ({ '--navbar-height': TITLE_BAR_HEIGHT_PX } as CSSProperties) : undefined
  const shouldReserveTrafficLightInset = isWindow && isMac && !leftPaneOpen
  const shouldShowTopRightTool = !open && !maximized && Boolean(trailing || topRightTool)
  const shouldReserveRightInset = !open && !maximized && (isWindow || shouldShowTopRightTool)
  return (
    <div
      data-conversation-shell-topbar
      style={windowNavbarHeightStyle}
      className={cn(
        'relative flex h-fit w-full min-w-0 items-center',
        // Window mode: the title bar sits on the glass shell and the content card below carries
        // its own frame border, so the hairline only belongs to the in-app (tab) navbar.
        !isWindow &&
          'after:pointer-events-none after:absolute after:right-0 after:bottom-0 after:left-0 after:h-px after:bg-border-subtle after:content-[""]',
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
