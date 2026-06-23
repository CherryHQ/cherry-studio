import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ButtonHTMLAttributes, ComponentProps, CSSProperties, ReactNode } from 'react'
import { useEffect } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CHAT_CENTER_MIN_USABLE_WIDTH } from '../../../shell/paneLayout'

const rightPaneHostMock = vi.hoisted(() => ({
  notifyReservedSpaceUnavailableOnOpen: false
}))

vi.mock('@cherrystudio/ui', () => ({
  Button: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  Tabs: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TabsContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  HorizontalScrollContainer: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div data-testid="shell-tab-scroll-container" className={className}>
      {children}
    </div>
  ),
  TabsList: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div data-testid="shell-tabs-list" className={className}>
      {children}
    </div>
  ),
  TabsTrigger: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  Tooltip: ({ children, content }: { children: ReactNode; content: ReactNode }) => (
    <div data-testid="shell-tooltip" data-content={typeof content === 'string' ? content : undefined}>
      {children}
    </div>
  )
}))

vi.mock('@renderer/components/NavbarIcon', () => ({
  default: ({
    active,
    children,
    tone,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean; children: ReactNode; tone?: string }) => (
    <button type="button" data-active={active || undefined} data-tone={tone} {...props}>
      {children}
    </button>
  )
}))

vi.mock('../../../shell/RightPaneHost', () => ({
  RightPaneHost: ({
    children,
    open,
    reservedCenterWidth,
    onReservedSpaceUnavailable,
    style
  }: {
    children?: ReactNode
    open?: boolean
    reservedCenterWidth?: number
    onReservedSpaceUnavailable?: () => void
    style?: CSSProperties
  }) => {
    useEffect(() => {
      if (open && rightPaneHostMock.notifyReservedSpaceUnavailableOnOpen) {
        onReservedSpaceUnavailable?.()
      }
    }, [onReservedSpaceUnavailable, open])

    return (
      <section
        data-testid="right-pane-host"
        data-open={String(Boolean(open))}
        data-reserved-center-width={String(reservedCenterWidth ?? '')}
        style={style}>
        <button type="button" onClick={onReservedSpaceUnavailable}>
          reserved space unavailable
        </button>
        {open ? children : null}
      </section>
    )
  }
}))

vi.mock('@renderer/components/Icons', () => ({
  RightSidebarCollapseIcon: () => <span data-testid="collapse-icon" />,
  RightSidebarExpandIcon: () => <span data-testid="expand-icon" />
}))

const shortcutHandlers = new Map<string, () => void>()

vi.mock('@renderer/hooks/command', () => ({
  useCommandHandler: (key: string, callback: () => void, options?: { enabled?: boolean }) => {
    if (options?.enabled === false) {
      shortcutHandlers.delete(key)
      return
    }
    shortcutHandlers.set(key, callback)
  }
}))

vi.mock('@renderer/components/command', () => ({
  CommandTooltip: ({ children }: { children?: ReactNode }) => children
}))

vi.mock('@renderer/utils', () => ({
  cn: (...inputs: unknown[]) => inputs.filter(Boolean).join(' ')
}))

vi.mock('motion/react', () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => children,
  motion: {
    div: (
      props: ComponentProps<'div'> & { animate?: unknown; exit?: unknown; initial?: unknown; transition?: unknown }
    ) => {
      const divProps = { ...props }
      delete divProps.initial
      delete divProps.animate
      delete divProps.exit
      delete divProps.transition
      const { children, ...htmlProps } = divProps
      return <div {...htmlProps}>{children}</div>
    }
  },
  useReducedMotion: () => false
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

import { WindowFrameProvider } from '@renderer/components/chat/shell/WindowFrameContext'

import {
  ChatMaximizedOverlayInsetProvider,
  useChatMaximizedOverlayBottomInset,
  useSetChatMaximizedOverlayBottomInset
} from '../../../layout/ChatViewportInsetContext'
import { Shell, useShellActions, useShellState } from '../Shell'

function CloseShellButton() {
  const actions = useShellActions()

  return (
    <button type="button" onClick={() => actions.close()}>
      close shell
    </button>
  )
}

function OpenTraceButton() {
  const actions = useShellActions()

  return (
    <button type="button" onClick={() => actions.openTab('trace')}>
      open trace
    </button>
  )
}

function ToggleMaximizedButton() {
  const actions = useShellActions()

  return (
    <button type="button" onClick={actions.toggleMaximized}>
      toggle maximized
    </button>
  )
}

function SetMaximizedOverlayBottomInset({ value }: { value: number }) {
  const setBottomInset = useSetChatMaximizedOverlayBottomInset()

  useEffect(() => {
    setBottomInset(value)
  }, [setBottomInset, value])

  return null
}

function MaximizedOverlayBottomInsetSnapshot() {
  const bottomInset = useChatMaximizedOverlayBottomInset()

  return <div data-testid="maximized-overlay-bottom-inset">{String(bottomInset)}</div>
}

function ShellStateSnapshot() {
  const state = useShellState()

  return (
    <div data-testid="shell-state">{`${state.open ? 'open' : 'closed'}:${state.activeTab}:${state.maximized}`}</div>
  )
}

function triggerRightSidebarShortcut() {
  const handler = shortcutHandlers.get('topic.sidebar.toggle')
  if (!handler) throw new Error('Expected right sidebar shortcut to be registered')
  act(() => {
    handler()
  })
}

describe('Shell.Toggle', () => {
  beforeEach(() => {
    shortcutHandlers.clear()
    rightPaneHostMock.notifyReservedSpaceUnavailableOnOpen = false
  })

  it('keeps the same toggle button while swapping icons across states', () => {
    render(
      <Shell defaultTab="files">
        <Shell.Toggle tab="files" />
      </Shell>
    )

    const toggle = screen.getByRole('button', { name: 'common.open_sidebar' })

    expect(toggle).toHaveAttribute('data-state', 'closed')
    expect(toggle).toHaveAttribute('data-tone', 'conversation')
    expect(toggle).not.toHaveAttribute('data-active')
    expect(screen.getByTestId('shell-tooltip')).toHaveAttribute('data-content', 'common.open_sidebar')
    expect(screen.getByTestId('expand-icon')).toBeInTheDocument()

    fireEvent.click(toggle)

    expect(screen.getByRole('button', { name: 'common.close_sidebar' })).toBe(toggle)
    expect(toggle).toHaveAttribute('data-state', 'open')
    expect(toggle).toHaveAttribute('data-active', 'true')
    expect(screen.getByTestId('shell-tooltip')).toHaveAttribute('data-content', 'common.close_sidebar')
    expect(screen.getByTestId('collapse-icon')).toBeInTheDocument()
  })

  it('does not open the pane when disabled', () => {
    render(
      <Shell defaultTab="files">
        <Shell.Toggle tab="files" disabled />
      </Shell>
    )

    const toggle = screen.getByRole('button', { name: 'common.open_sidebar' })

    expect(toggle).toBeDisabled()
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('data-state', 'closed')
    expect(screen.getByTestId('expand-icon')).toBeInTheDocument()
  })

  it('can close the open pane through shell actions', () => {
    render(
      <Shell defaultTab="files">
        <Shell.Toggle tab="files" command="topic.sidebar.toggle" />
        <CloseShellButton />
      </Shell>
    )

    const toggle = screen.getByRole('button', { name: 'common.open_sidebar' })

    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('data-state', 'open')

    fireEvent.click(screen.getByRole('button', { name: 'close shell' }))
    expect(toggle).toHaveAttribute('data-state', 'closed')
  })

  it('closes the pane directly without switching tabs when another tab is active', () => {
    render(
      <Shell defaultTab="files">
        <Shell.Toggle tab="files" command="topic.sidebar.toggle" />
        <OpenTraceButton />
        <ShellStateSnapshot />
      </Shell>
    )

    fireEvent.click(screen.getByRole('button', { name: 'open trace' }))

    const toggle = screen.getByRole('button', { name: 'common.close_sidebar' })
    expect(toggle).toHaveAttribute('data-state', 'open')
    expect(screen.getByTestId('shell-state')).toHaveTextContent('open:trace:false')

    fireEvent.click(toggle)

    expect(toggle).toHaveAttribute('data-state', 'closed')
    expect(screen.getByTestId('shell-state')).toHaveTextContent('closed:trace:false')
  })

  it('opens the default tab with the right sidebar shortcut', () => {
    render(
      <Shell defaultTab="files">
        <Shell.Toggle tab="files" command="topic.sidebar.toggle" />
        <ShellStateSnapshot />
      </Shell>
    )

    expect(screen.getByTestId('shell-state')).toHaveTextContent('closed:files:false')

    triggerRightSidebarShortcut()

    expect(screen.getByTestId('shell-state')).toHaveTextContent('open:files:false')
    expect(screen.getByRole('button', { name: 'common.close_sidebar' })).toHaveAttribute('data-state', 'open')
  })

  it('closes the open pane with the right sidebar shortcut', () => {
    render(
      <Shell defaultTab="files">
        <Shell.Toggle tab="files" command="topic.sidebar.toggle" />
        <ShellStateSnapshot />
      </Shell>
    )

    triggerRightSidebarShortcut()
    expect(screen.getByTestId('shell-state')).toHaveTextContent('open:files:false')

    triggerRightSidebarShortcut()

    expect(screen.getByTestId('shell-state')).toHaveTextContent('closed:files:false')
  })

  it('closes and restores from maximized mode with the right sidebar shortcut', () => {
    render(
      <Shell defaultTab="files">
        <Shell.Toggle tab="files" command="topic.sidebar.toggle" />
        <Shell.Tabs>
          <Shell.TabList>
            <Shell.Tab value="files">Files</Shell.Tab>
          </Shell.TabList>
        </Shell.Tabs>
        <ShellStateSnapshot />
      </Shell>
    )

    triggerRightSidebarShortcut()
    fireEvent.click(screen.getByRole('button', { name: 'common.maximize' }))
    expect(screen.getByTestId('shell-state')).toHaveTextContent('open:files:true')

    triggerRightSidebarShortcut()

    expect(screen.getByTestId('shell-state')).toHaveTextContent('closed:files:false')
  })

  it('does not respond to the right sidebar shortcut when disabled', () => {
    render(
      <Shell defaultTab="files">
        <Shell.Toggle tab="files" command="topic.sidebar.toggle" disabled />
        <ShellStateSnapshot />
      </Shell>
    )

    expect(shortcutHandlers.has('topic.sidebar.toggle')).toBe(false)
    expect(screen.getByTestId('shell-state')).toHaveTextContent('closed:files:false')
  })
})

describe('Shell.Host', () => {
  it('caps the docked right pane width so the conversation center keeps its minimum usable width', () => {
    render(
      <Shell defaultTab="files">
        <Shell.Toggle tab="files" />
        <Shell.Host>
          <div>files pane</div>
        </Shell.Host>
      </Shell>
    )

    const toggle = screen.getByRole('button', { name: 'common.open_sidebar' })
    expect(toggle).toBeEnabled()

    fireEvent.click(toggle)

    expect(screen.getByTestId('right-pane-host')).toHaveAttribute('data-open', 'true')
    expect(screen.getByTestId('right-pane-host')).toHaveAttribute(
      'data-reserved-center-width',
      String(CHAT_CENTER_MIN_USABLE_WIDTH)
    )
  })

  it('closes the docked pane when the reserved center space is unavailable', () => {
    render(
      <Shell defaultTab="files">
        <Shell.Toggle tab="files" />
        <Shell.Host>
          <div>files pane</div>
        </Shell.Host>
        <ShellStateSnapshot />
      </Shell>
    )

    fireEvent.click(screen.getByRole('button', { name: 'common.open_sidebar' }))

    expect(screen.getByTestId('shell-state')).toHaveTextContent('open:files:false')

    fireEvent.click(screen.getByRole('button', { name: 'reserved space unavailable' }))

    expect(screen.getByTestId('shell-state')).toHaveTextContent('closed:files:false')
  })

  it('closes the docked pane when reserved center space is unavailable during the host mount effect', async () => {
    rightPaneHostMock.notifyReservedSpaceUnavailableOnOpen = true

    render(
      <Shell defaultTab="files">
        <Shell.Toggle tab="files" />
        <Shell.Host>
          <div>files pane</div>
        </Shell.Host>
        <ShellStateSnapshot />
      </Shell>
    )

    fireEvent.click(screen.getByRole('button', { name: 'common.open_sidebar' }))

    await waitFor(() => {
      expect(screen.getByTestId('shell-state')).toHaveTextContent('closed:files:false')
    })
  })
})

describe('Shell.TabList', () => {
  it('renders tabs alongside the maximize toggle without reserving navbar overlap padding', () => {
    render(
      <Shell defaultTab="files">
        <Shell.Tabs>
          <Shell.TabList>
            <Shell.Tab value="files">Files</Shell.Tab>
          </Shell.TabList>
        </Shell.Tabs>
      </Shell>
    )

    const tabList = screen.getByTestId('shell-tab-list')
    const scrollContainer = screen.getByTestId('shell-tab-scroll-container')
    const tabsList = screen.getByTestId('shell-tabs-list')

    expect(tabList).toHaveClass('pr-3', 'pl-3')
    expect(tabList).not.toHaveClass('pr-11')
    expect(scrollContainer).toHaveClass('min-w-0', 'flex-1')
    expect(tabsList).not.toHaveClass('overflow-x-auto')

    fireEvent.click(screen.getByRole('button', { name: 'common.maximize' }))

    const minimizeButton = screen.getByRole('button', { name: 'common.minimize' })

    expect(minimizeButton).toHaveAttribute('data-tone', 'conversation')
    expect(minimizeButton).toHaveAttribute('aria-pressed', 'true')
    expect(minimizeButton).not.toHaveAttribute('data-active')
    expect(minimizeButton.querySelector('svg')).not.toHaveAttribute('width', '15')
    // embedded mode (no WindowFrameProvider) stays no-drag and uses the symmetric pl-3 inset
    // even when maximized — the traffic-light inset is sub-window-only.
    expect(tabList).toHaveClass('pl-3')
    expect(tabList).not.toHaveClass('pl-[env(titlebar-area-x)]')
  })

  it('renders extraTrailing after the maximize toggle', () => {
    render(
      <Shell defaultTab="files">
        <Shell.Tabs>
          <Shell.TabList extraTrailing={<button type="button">extra</button>}>
            <Shell.Tab value="files">Files</Shell.Tab>
          </Shell.TabList>
        </Shell.Tabs>
      </Shell>
    )

    const extra = screen.getByRole('button', { name: 'extra' })
    const maximize = screen.getByRole('button', { name: 'common.maximize' })
    const cluster = extra.parentElement
    expect(cluster).not.toBeNull()
    expect(cluster).toContainElement(maximize)
    expect(maximize.compareDocumentPosition(extra) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('promotes the header to a drag region when maximized inside a sub-window', () => {
    render(
      <WindowFrameProvider value={{ mode: 'window' }}>
        <Shell defaultTab="files">
          <Shell.Tabs>
            <Shell.TabList>
              <Shell.Tab value="files">Files</Shell.Tab>
            </Shell.TabList>
          </Shell.Tabs>
        </Shell>
      </WindowFrameProvider>
    )

    const tabList = screen.getByTestId('shell-tab-list')

    // docked (pane open but not maximized) still gates drag off — chat navbar owns the drag region.
    expect(tabList).toHaveClass('[-webkit-app-region:no-drag]')

    fireEvent.click(screen.getByRole('button', { name: 'common.maximize' }))

    expect(tabList).toHaveClass('[-webkit-app-region:drag]')
    expect(tabList).not.toHaveClass('[-webkit-app-region:no-drag]')
  })
})

describe('Shell.MaximizedOverlay', () => {
  it('reserves the measured composer bottom inset while maximized', async () => {
    const { container } = render(
      <ChatMaximizedOverlayInsetProvider>
        <Shell defaultTab="files">
          <Shell.Toggle tab="files" command="topic.sidebar.toggle" />
          <ToggleMaximizedButton />
          <SetMaximizedOverlayBottomInset value={128} />
          <Shell.MaximizedOverlay>
            <div>maximized content</div>
          </Shell.MaximizedOverlay>
        </Shell>
      </ChatMaximizedOverlayInsetProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: 'common.open_sidebar' }))
    fireEvent.click(screen.getByRole('button', { name: 'toggle maximized' }))

    await waitFor(() => {
      expect(container.querySelector('[data-shell-maximized-overlay-content]')).toHaveStyle({
        height: 'max(0px, calc(100% - 128px))'
      })
    })
  })

  it('does not rerender setter-only consumers when the measured bottom inset changes', async () => {
    let setterOnlyRenderCount = 0

    function SetterOnlyProbe() {
      useSetChatMaximizedOverlayBottomInset()
      setterOnlyRenderCount += 1

      return null
    }

    render(
      <ChatMaximizedOverlayInsetProvider>
        <SetterOnlyProbe />
        <SetMaximizedOverlayBottomInset value={128} />
        <MaximizedOverlayBottomInsetSnapshot />
      </ChatMaximizedOverlayInsetProvider>
    )

    await waitFor(() => {
      expect(screen.getByTestId('maximized-overlay-bottom-inset')).toHaveTextContent('128')
    })
    expect(setterOnlyRenderCount).toBe(1)
  })
})
