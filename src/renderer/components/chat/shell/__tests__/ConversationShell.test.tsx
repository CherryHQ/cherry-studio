import {
  RightPanel,
  type RightPanelCapability,
  RightPanelProvider,
  RightPanelShortcut
} from '@renderer/components/chat/panes/Shell'
import { WindowFrameProvider } from '@renderer/components/chat/shell/WindowFrameContext'
import type * as RendererPlatformModule from '@renderer/utils/platform'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import ConversationShell from '../ConversationShell'
import { ConversationTopBarPortal, ConversationTopBarPortalHost } from '../ConversationTopBarPortal'

const shellProps = vi.hoisted(() => ({
  current: null as {
    centerContent?: ReactNode
    topBar?: ReactNode
    sidePanel?: ReactNode
    centerOverlay?: ReactNode
    rightPane?: ReactNode
  } | null
}))

vi.mock('@renderer/components/QuickPanel', () => ({
  QuickPanelProvider: ({ children }: { children: ReactNode }) => <div data-testid="quick-panel">{children}</div>
}))

vi.mock('@renderer/utils/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof RendererPlatformModule>()),
  isMac: false,
  isWin: false,
  isLinux: false
}))

vi.mock('@cherrystudio/ui', async (importOriginal) => ({
  ...(await importOriginal()),
  Button: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  Tooltip: ({ children }: { children: ReactNode }) => children
}))

const rightPanelCapabilities = [
  {
    component: () => <div>resource panel</div>,
    resolve: () => ({
      id: 'files',
      instanceKey: 'files',
      title: '对话',
      readiness: 'ready' as const,
      canMaximize: true
    })
  }
] satisfies readonly RightPanelCapability<null>[]

vi.mock('../ChatAppShell', () => ({
  ChatAppShell: (props: {
    centerContent?: ReactNode
    topBar?: ReactNode
    sidePanel?: ReactNode
    centerOverlay?: ReactNode
    rightPane?: ReactNode
  }) => {
    shellProps.current = props
    return (
      <div data-testid="chat-app-shell">
        {props.topBar}
        {props.sidePanel}
        {props.centerContent}
        {props.centerOverlay}
        {props.rightPane}
      </div>
    )
  }
}))

describe('ConversationShell', () => {
  it('wraps center content in the shared app shell and keeps right pane beside it', () => {
    render(
      <ConversationShell
        id="conversation"
        className="message-style"
        topBar={<div data-testid="top-bar" />}
        sidePanel={<div data-testid="side-panel" />}
        center={<div data-testid="center" />}
        centerOverlay={<div data-testid="center-overlay" />}
        rightPane={<div data-testid="right-pane" />}
      />
    )

    expect(screen.getByTestId('quick-panel')).toContainElement(screen.getByTestId('chat-app-shell'))
    expect(screen.getByTestId('chat-app-shell')).toContainElement(screen.getByTestId('center'))
    expect(screen.getByTestId('chat-app-shell')).toContainElement(screen.getByTestId('center-overlay'))
    expect(screen.getByTestId('right-pane')).toBeInTheDocument()
    expect(shellProps.current?.centerContent).toBeTruthy()
    expect(document.getElementById('conversation')).toHaveClass('message-style')
  })

  it('renders conversation controls into the top bar host', () => {
    const { container } = render(
      <ConversationShell
        topBar={<ConversationTopBarPortalHost />}
        center={
          <ConversationTopBarPortal>
            <button type="button">assistant selector</button>
          </ConversationTopBarPortal>
        }
      />
    )

    const host = container.querySelector<HTMLElement>('[data-conversation-topbar-controls]')
    expect(host).toContainElement(screen.getByRole('button', { name: 'assistant selector' }))
  })

  it('turns the detached conversation navbar into draggable window chrome', () => {
    const { container } = render(
      <WindowFrameProvider value={{ mode: 'window' }}>
        <ConversationShell
          topBar={<div data-testid="top-bar" />}
          topRightTool={<button type="button">Files</button>}
          center={<div />}
        />
      </WindowFrameProvider>
    )

    const topBarWrapper = container.querySelector<HTMLElement>('[data-conversation-shell-topbar]')
    const topRightTool = container.querySelector<HTMLElement>('[data-conversation-shell-topbar-right]')
    const rightSpacer = container.querySelector<HTMLElement>('[data-conversation-shell-right-spacer]')
    expect(topBarWrapper).toContainElement(topRightTool)
    expect(topBarWrapper).toHaveClass('[-webkit-app-region:drag]', 'pl-2', 'h-[37.5px]')
    expect(topBarWrapper?.style.getPropertyValue('--navbar-height')).toBe('37.5px')
    expect(topRightTool).toHaveClass('h-[37.5px]', '[-webkit-app-region:no-drag]')
    expect(rightSpacer).toHaveClass('w-[calc(0.5rem+var(--window-controls-width,0px))]')
  })

  it('uses a full-height sidebar shell when the page owns detached window chrome', () => {
    const { container } = render(
      <WindowFrameProvider value={{ mode: 'window', translucent: true }}>
        <ConversationShell center={<div />} />
      </WindowFrameProvider>
    )

    expect(container.firstElementChild).toHaveClass('h-screen', 'bg-sidebar/70')
    expect(container.querySelector('[data-conversation-shell-drag-strip]')).toBeInTheDocument()
  })

  it('does not add an embedded topbar wrapper or reserve when no right tool exists', () => {
    const { container } = render(<ConversationShell topBar={<div data-testid="top-bar" />} center={<div />} />)

    expect(screen.getByTestId('top-bar')).toBeInTheDocument()
    expect(container.querySelector('[data-conversation-shell-topbar]')).not.toBeInTheDocument()
    expect(container.querySelector('[data-navbar-right-occupant]')).not.toBeInTheDocument()
    expect(container.querySelector('[data-conversation-shell-right-spacer]')).not.toBeInTheDocument()
  })

  it('keeps a multi-button top-right tool cluster in the topbar layout flow', () => {
    const { container } = render(
      <ConversationShell
        topBar={<div data-testid="top-bar" />}
        topRightTool={
          <>
            <button type="button">info</button>
            <button type="button">toggle</button>
            <button type="button">files</button>
            <button type="button">status</button>
          </>
        }
        center={<div />}
      />
    )

    const topBarWrapper = container.querySelector<HTMLElement>('[data-conversation-shell-topbar]')
    const topRightTool = container.querySelector<HTMLElement>('[data-conversation-shell-topbar-right]')
    const rightSpacer = container.querySelector<HTMLElement>('[data-conversation-shell-right-spacer]')
    expect(topBarWrapper).toContainElement(topRightTool)
    expect(topBarWrapper).toHaveClass(
      'after:absolute',
      'after:right-0',
      'after:bottom-0',
      'after:left-0',
      'after:h-px',
      'after:bg-border-subtle'
    )
    expect(topBarWrapper).not.toHaveClass('pr-11', 'pr-[76px]', 'pr-[140px]', 'pr-[172px]')
    expect(topRightTool).toHaveClass('flex', 'shrink-0', 'gap-0.5')
    expect(topRightTool).not.toHaveClass('absolute')
    expect(rightSpacer).toHaveClass('w-2')
  })

  it('reserves native window controls in window mode even without a page tool', () => {
    const { container } = render(
      <WindowFrameProvider value={{ mode: 'window' }}>
        <ConversationShell topBar={<div data-testid="top-bar" />} center={<div />} />
      </WindowFrameProvider>
    )

    expect(screen.getByTestId('top-bar')).toBeInTheDocument()
    expect(container.querySelector('[data-conversation-shell-topbar]')).toBeInTheDocument()
    expect(container.querySelector('[data-conversation-shell-topbar-right]')).not.toBeInTheDocument()
    expect(container.querySelector('[data-conversation-shell-right-spacer]')).toHaveClass(
      'w-[calc(0.5rem+var(--window-controls-width,0px))]'
    )
  })

  it('composes host-provided title chrome into the detached navbar', () => {
    const { container } = render(
      <WindowFrameProvider
        value={{
          mode: 'window',
          chrome: {
            titleLeading: <div data-testid="title-leading" />,
            titleTrailing: <button type="button">Pin</button>
          }
        }}>
        <ConversationShell topBar={<div data-testid="top-bar" />} center={<div />} />
      </WindowFrameProvider>
    )

    const topBarWrapper = container.querySelector<HTMLElement>('[data-conversation-shell-topbar]')
    expect(topBarWrapper).toContainElement(screen.getByTestId('title-leading'))
    expect(topBarWrapper).toContainElement(screen.getByRole('button', { name: 'Pin' }))
  })

  it('keeps the top-right tool visible while the docked right pane is open when requested', () => {
    const { container } = render(
      <RightPanelProvider capabilities={rightPanelCapabilities} scope={null} defaultPanelId="files">
        <ConversationShell
          topBar={<div data-testid="top-bar" />}
          topRightTool={
            <RightPanelShortcut tab="files" label="对话" icon={<span data-testid="resource-shortcut-icon" />} />
          }
          showTopRightToolWhenPaneOpen
          center={<div />}
        />
        <RightPanel />
      </RightPanelProvider>
    )

    const topBarWrapper = container.querySelector<HTMLElement>('[data-conversation-shell-topbar]')
    const topRightTool = container.querySelector<HTMLElement>('[data-conversation-shell-topbar-right]')
    expect(topBarWrapper).toContainElement(topRightTool)
    expect(topBarWrapper).not.toHaveClass('pr-11')

    fireEvent.click(container.querySelector('[data-shell-tab-shortcut="files"]') as HTMLElement)

    expect(screen.getByRole('button', { name: '对话' })).toBeInTheDocument()
    expect(container.querySelector('[data-conversation-shell-topbar-right]')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /最大化|common\.maximize/ }))

    expect(container.querySelector('[data-conversation-shell-topbar-right]')).not.toBeInTheDocument()
  })

  it('floats host window controls at the outer edge while the right panel is open', () => {
    const { container } = render(
      <RightPanelProvider capabilities={rightPanelCapabilities} scope={null} defaultOpen defaultPanelId="files">
        <WindowFrameProvider
          value={{
            mode: 'window',
            chrome: { titleTrailing: <button type="button">Back to main</button> }
          }}>
          <ConversationShell topBar={<div data-testid="top-bar" />} center={<div />} rightPane={<RightPanel />} />
        </WindowFrameProvider>
      </RightPanelProvider>
    )

    const floating = container.querySelector<HTMLElement>('[data-conversation-shell-floating-trailing]')
    expect(floating).toContainElement(screen.getByRole('button', { name: 'Back to main' }))
    expect(container.querySelector('[data-conversation-shell-topbar-right]')).not.toBeInTheDocument()
  })

  it('uses the page-sidebar edge instead of traffic-light padding when the left pane is open', () => {
    const { container } = render(
      <WindowFrameProvider value={{ mode: 'window' }}>
        <ConversationShell
          pane={<div data-testid="pane" />}
          paneOpen
          panePosition="left"
          topBar={<div data-testid="top-bar" />}
          topRightTool={<button type="button">Files</button>}
          showTopRightToolWhenPaneOpen
          center={<div />}
        />
      </WindowFrameProvider>
    )

    const topBarWrapper = container.querySelector<HTMLElement>('[data-conversation-shell-topbar]')
    expect(topBarWrapper).toHaveClass('[-webkit-app-region:drag]', 'pl-2')
    expect(topBarWrapper).not.toHaveClass('pl-[env(titlebar-area-x)]')
    expect(container.querySelector('[data-conversation-shell-right-spacer]')).toHaveClass(
      'w-[calc(0.5rem+var(--window-controls-width,0px))]'
    )
  })
})
