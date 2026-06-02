import { TITLE_BAR_HEIGHT_CLASS, TITLE_BAR_HEIGHT_PX } from '@renderer/components/layout/titleBar'
import { QuickPanelProvider } from '@renderer/components/QuickPanel'
import { isMac } from '@renderer/config/constant'
import { useWindowFrame } from '@renderer/context/WindowFrameContext'
import { cn } from '@renderer/utils'
import type { CSSProperties, ReactNode, Ref } from 'react'

import { ChatMaximizedOverlayInsetProvider } from '../layout/ChatViewportInsetContext'
import { useOptionalShellState } from '../panes/Shell'
import { ChatAppShell } from './ChatAppShell'
import type { ChatPanePosition } from './types'

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
  onPaneCollapse
}: ConversationShellProps) {
  const { mode, chrome } = useWindowFrame()
  const isWindow = mode === 'window'

  // In window mode the page navbar IS the window title bar, so wrap it even without a
  // right tool to pick up the drag region, traffic-light inset, and title-leading slot.
  const resolvedTopBar =
    topRightTool || isWindow ? (
      <ConversationShellTopBar isWindow={isWindow} leading={chrome?.titleLeading}>
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

type TopBarProps = { isWindow: boolean; leading?: ReactNode; children?: ReactNode }

const ConversationShellTopBar = ({ isWindow, leading, children }: TopBarProps) => {
  const shellState = useOptionalShellState()
  const maximized = shellState?.maximized ?? false
  const windowNavbarHeightStyle = isWindow ? ({ '--navbar-height': TITLE_BAR_HEIGHT_PX } as CSSProperties) : undefined
  return (
    <div
      style={windowNavbarHeightStyle}
      className={cn(
        'flex h-fit w-full min-w-0 items-center',
        // Window mode: the navbar is the window title bar — make it draggable, inset past the
        // macOS traffic lights, and show the injected title (emoji + name) on the left.
        isWindow && [TITLE_BAR_HEIGHT_CLASS, '[-webkit-app-region:drag]', isMac ? 'pl-[env(titlebar-area-x)]' : 'pl-2'],
        // Reserve room for the floating right group: wider in window mode (pin + back + tool).
        !maximized && (isWindow ? 'pr-28' : 'pr-11')
      )}>
      {leading}
      {children}
    </div>
  )
}

type TopRightToolProps = { isWindow: boolean; trailing?: ReactNode; children?: ReactNode }

const ConversationShellTopRightTool = ({ isWindow, trailing, children }: TopRightToolProps) => {
  const shellState = useOptionalShellState()
  const maximized = shellState?.maximized ?? false
  if (maximized) return null
  return (
    <div
      data-navbar-right-occupant
      className={cn(
        'absolute top-0 right-2 z-20 flex items-center [-webkit-app-region:no-drag]',
        // Window mode: shorter bar (lines up with the traffic lights) + injected controls
        // (pin / back-to-main) to the left of the page's own tool.
        isWindow ? [TITLE_BAR_HEIGHT_CLASS, 'gap-0.5'] : 'h-(--navbar-height) w-7.5 justify-center'
      )}>
      {trailing}
      {children}
    </div>
  )
}
