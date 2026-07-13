import { Shell } from '@renderer/components/chat/panes/Shell'
import { WindowFrameProvider } from '@renderer/components/chat/shell/WindowFrameContext'
import type * as ConstantConfig from '@renderer/utils/platform'
import { fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import ConversationShell from '../ConversationShell'

const shellProps = vi.hoisted(() => ({
  current: null as {
    centerContent?: ReactNode
    topBar?: ReactNode
    sidePanel?: ReactNode
    centerOverlay?: ReactNode
  } | null
}))

vi.mock('@renderer/hooks/useWindowFocus', () => ({
  default: () => true
}))

vi.mock('@renderer/components/QuickPanel', () => ({
  QuickPanelProvider: ({ children }: { children: ReactNode }) => <div data-testid="quick-panel">{children}</div>
}))

vi.mock('@renderer/utils/platform', async (importOriginal) => {
  const actual = await importOriginal<typeof ConstantConfig>()
  return {
    ...actual,
    isMac: true
  }
})

vi.mock('../ChatAppShell', () => ({
  ChatAppShell: (props: {
    centerContent?: ReactNode
    topBar?: ReactNode
    sidePanel?: ReactNode
    centerOverlay?: ReactNode
  }) => {
    shellProps.current = props
    return (
      <div data-testid="chat-app-shell">
        {props.topBar}
        {props.sidePanel}
        {props.centerContent}
        {props.centerOverlay}
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

  it('keeps the window-mode navbar wrapper at the title-bar height', () => {
    const { container } = render(
      <WindowFrameProvider value={{ mode: 'window', chrome: { titleLeading: <div data-testid="title-leading" /> } }}>
        <ConversationShell topBar={<div data-testid="top-bar" />} center={<div />} />
      </WindowFrameProvider>
    )

    const topBarWrapper = container.querySelector<HTMLElement>('[data-conversation-shell-topbar]')
    expect(topBarWrapper).toHaveClass('h-[37.5px]')
    expect(topBarWrapper).not.toHaveClass('h-(--navbar-height)')
    expect(topBarWrapper).toHaveClass('pl-[env(titlebar-area-x)]')
    expect(topBarWrapper?.style.getPropertyValue('--navbar-height')).toBe('37.5px')
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
    expect(topBarWrapper).not.toHaveClass('pr-11', 'pr-[76px]', 'pr-[140px]', 'pr-[172px]')
    expect(topRightTool).toHaveClass('flex', 'shrink-0', 'gap-0.5')
    expect(topRightTool).not.toHaveClass('absolute')
    expect(rightSpacer).toHaveClass('w-2')
  })

  it('keeps window chrome trailing tools in the title-bar flow and preserves the controls spacer', () => {
    const { container } = render(
      <WindowFrameProvider
        value={{
          mode: 'window',
          chrome: {
            titleTrailing: <button type="button">Pin</button>
          }
        }}>
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
    expect(topBarWrapper).not.toHaveClass('pr-[calc(7rem+var(--window-controls-width,0px))]')
    expect(topRightTool).toHaveTextContent('Pin')
    expect(topRightTool).toHaveTextContent('Files')
    expect(
      within(topRightTool!)
        .getAllByRole('button')
        .map((button) => button.textContent)
    ).toEqual(['Pin', 'Files'])
    expect(topRightTool).toHaveClass('h-[37.5px]')
    expect(topRightTool).not.toHaveClass('absolute')
    expect(rightSpacer).toHaveClass('w-[calc(0.5rem+var(--window-controls-width,0px))]')
  })

  it('does not create a fake tool reserve in window mode when no trailing tool exists', () => {
    const { container } = render(
      <WindowFrameProvider value={{ mode: 'window' }}>
        <ConversationShell topBar={<div data-testid="top-bar" />} center={<div />} />
      </WindowFrameProvider>
    )

    const topBarWrapper = container.querySelector<HTMLElement>('[data-conversation-shell-topbar]')
    const rightSpacer = container.querySelector<HTMLElement>('[data-conversation-shell-right-spacer]')
    expect(container.querySelector('[data-conversation-shell-topbar-right]')).not.toBeInTheDocument()
    expect(topBarWrapper).not.toHaveClass('pr-[calc(7rem+var(--window-controls-width,0px))]')
    expect(rightSpacer).toHaveClass('w-[calc(0.5rem+var(--window-controls-width,0px))]')
  })

  it('opens the right-pane tab from a shortcut and hides the navbar cluster', () => {
    const { container } = render(
      <Shell defaultTab="resources">
        <ConversationShell
          topBar={<div data-testid="top-bar" />}
          topRightTool={
            <Shell.TabShortcut tab="resources" label="对话" icon={<span data-testid="resource-shortcut-icon" />} />
          }
          center={<div />}
        />
      </Shell>
    )

    const topBarWrapper = container.querySelector<HTMLElement>('[data-conversation-shell-topbar]')
    const topRightTool = container.querySelector<HTMLElement>('[data-conversation-shell-topbar-right]')
    expect(topBarWrapper).toContainElement(topRightTool)
    expect(topBarWrapper).not.toHaveClass('pr-11')

    fireEvent.click(screen.getByRole('button', { name: '对话' }))

    expect(screen.queryByRole('button', { name: '对话' })).not.toBeInTheDocument()
    expect(container.querySelector('[data-conversation-shell-topbar-right]')).not.toBeInTheDocument()
  })

  it('uses normal title-bar padding when the left pane is open in window mode', () => {
    const { container } = render(
      <WindowFrameProvider value={{ mode: 'window', chrome: { titleLeading: <div data-testid="title-leading" /> } }}>
        <ConversationShell
          pane={<div data-testid="pane" />}
          paneOpen
          panePosition="left"
          topBar={<div data-testid="top-bar" />}
          center={<div />}
        />
      </WindowFrameProvider>
    )

    const topBarWrapper = container.querySelector<HTMLElement>('[data-conversation-shell-topbar]')
    expect(topBarWrapper).toHaveClass('pl-2')
    expect(topBarWrapper).not.toHaveClass('pl-[env(titlebar-area-x)]')
  })
})
