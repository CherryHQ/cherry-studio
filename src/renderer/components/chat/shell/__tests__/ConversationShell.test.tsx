import { WindowFrameProvider } from '@renderer/components/chat/shell/WindowFrameContext'
import type * as ConstantConfig from '@renderer/config/constant'
import { render, screen } from '@testing-library/react'
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

vi.mock('@renderer/components/QuickPanel', () => ({
  QuickPanelProvider: ({ children }: { children: ReactNode }) => <div data-testid="quick-panel">{children}</div>
}))

vi.mock('@renderer/config/constant', async (importOriginal) => {
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
    render(
      <WindowFrameProvider value={{ mode: 'window', chrome: { titleLeading: <div data-testid="title-leading" /> } }}>
        <ConversationShell topBar={<div data-testid="top-bar" />} center={<div />} />
      </WindowFrameProvider>
    )

    const topBarWrapper = screen.getByTestId('top-bar').parentElement
    expect(topBarWrapper).toHaveClass('h-[37.5px]')
    expect(topBarWrapper).not.toHaveClass('h-(--navbar-height)')
    expect(topBarWrapper).toHaveClass('pl-[env(titlebar-area-x)]')
    expect(topBarWrapper?.style.getPropertyValue('--navbar-height')).toBe('37.5px')
  })

  it('lays out a double top-right tool cluster without the single-button width clamp', () => {
    const { container } = render(
      <ConversationShell
        topBar={<div data-testid="top-bar" />}
        topRightTool={
          <>
            <button type="button">info</button>
            <button type="button">toggle</button>
          </>
        }
        topRightToolReserve="double"
        center={<div />}
      />
    )

    const topBarWrapper = screen.getByTestId('top-bar').parentElement
    const topRightTool = container.querySelector('[data-navbar-right-occupant]')
    expect(topBarWrapper).toHaveClass('pr-[76px]')
    expect(topRightTool).toHaveClass('gap-0.5')
    expect(topRightTool).not.toHaveClass('w-7.5')
  })

  it('uses normal title-bar padding when the left pane is open in window mode', () => {
    render(
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

    const topBarWrapper = screen.getByTestId('top-bar').parentElement
    expect(topBarWrapper).toHaveClass('pl-2')
    expect(topBarWrapper).not.toHaveClass('pl-[env(titlebar-area-x)]')
  })
})
