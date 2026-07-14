import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ButtonHTMLAttributes, ComponentProps, CSSProperties, ReactNode } from 'react'
import { useEffect, useRef } from 'react'
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

vi.mock('@renderer/components/icons/SidebarToggleIcons', () => ({
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

vi.mock('@renderer/utils/style', () => ({
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

function ShellActionsRenderCounter() {
  useShellActions()
  const renderCountRef = useRef(0)
  renderCountRef.current += 1

  return <output data-testid="shell-actions-render-count">{renderCountRef.current}</output>
}

function ToggleMaximizedButton() {
  const actions = useShellActions()

  return (
    <button type="button" onClick={actions.toggleMaximized}>
      toggle maximized
    </button>
  )
}

function ShellStateSnapshot() {
  const state = useShellState()

  return (
    <div data-testid="shell-state">{`${state.open ? 'open' : 'closed'}:${state.activeTab}:${state.maximized}`}</div>
  )
}

function ShellMinimizeButton() {
  const actions = useShellActions()

  return (
    <button type="button" onClick={actions.minimize}>
      minimize shell
    </button>
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

  it('can mount open on the default tab', () => {
    render(
      <Shell defaultTab="files" defaultOpen>
        <Shell.Toggle tab="files" command="topic.sidebar.toggle" />
        <ShellStateSnapshot />
      </Shell>
    )

    expect(screen.getByTestId('shell-state')).toHaveTextContent('open:files:false')
    expect(screen.getByRole('button', { name: 'common.close_sidebar' })).toHaveAttribute('data-state', 'open')
  })

  it('syncs when the owning component changes the default open state', () => {
    const { rerender } = render(
      <Shell defaultTab="files" defaultOpen>
        <Shell.Toggle tab="files" command="topic.sidebar.toggle" />
        <OpenTraceButton />
        <ShellStateSnapshot />
      </Shell>
    )

    expect(screen.getByTestId('shell-state')).toHaveTextContent('open:files:false')

    fireEvent.click(screen.getByRole('button', { name: 'open trace' }))
    expect(screen.getByTestId('shell-state')).toHaveTextContent('open:trace:false')

    rerender(
      <Shell defaultTab="files" defaultOpen={false}>
        <Shell.Toggle tab="files" command="topic.sidebar.toggle" />
        <OpenTraceButton />
        <ShellStateSnapshot />
      </Shell>
    )

    expect(screen.getByTestId('shell-state')).toHaveTextContent('closed:trace:false')

    rerender(
      <Shell defaultTab="files" defaultOpen>
        <Shell.Toggle tab="files" command="topic.sidebar.toggle" />
        <OpenTraceButton />
        <ShellStateSnapshot />
      </Shell>
    )

    expect(screen.getByTestId('shell-state')).toHaveTextContent('open:files:false')
  })

  it('does not rerender actions-only consumers when shell state changes', () => {
    render(
      <Shell defaultTab="files">
        <OpenTraceButton />
        <ShellActionsRenderCounter />
        <ShellStateSnapshot />
      </Shell>
    )

    expect(screen.getByTestId('shell-actions-render-count')).toHaveTextContent('1')
    expect(screen.getByTestId('shell-state')).toHaveTextContent('closed:files:false')

    fireEvent.click(screen.getByRole('button', { name: 'open trace' }))

    expect(screen.getByTestId('shell-state')).toHaveTextContent('open:trace:false')
    expect(screen.getByTestId('shell-actions-render-count')).toHaveTextContent('1')
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

  it('minimizes from maximized mode without closing the pane', () => {
    render(
      <Shell defaultTab="files">
        <Shell.Toggle tab="files" command="topic.sidebar.toggle" />
        <Shell.Tabs>
          <Shell.TabList>
            <Shell.Tab value="files">Files</Shell.Tab>
          </Shell.TabList>
        </Shell.Tabs>
        <ShellMinimizeButton />
        <ShellStateSnapshot />
      </Shell>
    )

    triggerRightSidebarShortcut()
    fireEvent.click(screen.getByRole('button', { name: 'common.maximize' }))
    expect(screen.getByTestId('shell-state')).toHaveTextContent('open:files:true')

    fireEvent.click(screen.getByRole('button', { name: 'minimize shell' }))

    expect(screen.getByTestId('shell-state')).toHaveTextContent('open:files:false')
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

describe('Shell.TabShortcut', () => {
  beforeEach(() => {
    shortcutHandlers.clear()
    rightPaneHostMock.notifyReservedSpaceUnavailableOnOpen = false
  })

  it('opens the requested tab and hides itself while the pane is open', () => {
    render(
      <Shell defaultTab="files">
        <Shell.TabShortcut tab="status" label="Status" icon={<span data-testid="status-icon" />} />
        <ShellStateSnapshot />
      </Shell>
    )

    expect(screen.getByRole('button', { name: 'Status' })).toBeInTheDocument()
    expect(screen.getByTestId('status-icon')).toBeInTheDocument()
    expect(screen.getByTestId('shell-state')).toHaveTextContent('closed:files:false')

    fireEvent.click(screen.getByRole('button', { name: 'Status' }))

    expect(screen.getByTestId('shell-state')).toHaveTextContent('open:status:false')
    expect(screen.queryByRole('button', { name: 'Status' })).toBeNull()
  })

  it('forwards button props for composed triggers', () => {
    const onPointerEnter = vi.fn()

    render(
      <Shell defaultTab="files">
        <Shell.TabShortcut
          tab="status"
          label="Status"
          icon={<span data-testid="status-icon" />}
          data-hover-card-trigger="true"
          onPointerEnter={onPointerEnter}
        />
      </Shell>
    )

    const shortcut = screen.getByRole('button', { name: 'Status' })

    expect(shortcut).toHaveAttribute('data-hover-card-trigger', 'true')

    fireEvent.pointerEnter(shortcut)

    expect(onPointerEnter).toHaveBeenCalled()
  })

  it('stays hidden when the pane mounts open', () => {
    render(
      <Shell defaultTab="files" defaultOpen>
        <Shell.TabShortcut tab="files" label="Files" icon={<span data-testid="files-icon" />} />
        <ShellStateSnapshot />
      </Shell>
    )

    expect(screen.getByTestId('shell-state')).toHaveTextContent('open:files:false')
    expect(screen.queryByRole('button', { name: 'Files' })).toBeNull()
  })

  it('can stay visible while open and close the active tab without changing its view label', () => {
    render(
      <Shell defaultTab="files">
        <Shell.TabShortcut
          tab="files"
          label="Files"
          icon={<span data-testid="files-icon" />}
          openBehavior="toggle-active"
        />
        <ShellStateSnapshot />
      </Shell>
    )

    fireEvent.click(screen.getByRole('button', { name: 'Files' }))

    expect(screen.getByTestId('shell-state')).toHaveTextContent('open:files:false')
    expect(screen.getByRole('button', { name: 'Files' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('button', { name: 'common.close_sidebar' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Files' }))

    expect(screen.getByTestId('shell-state')).toHaveTextContent('closed:files:false')
    expect(screen.getByRole('button', { name: 'Files' })).toBeInTheDocument()
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

    // The opened-pane header uses ConversationShell's edge inset so the tab row is balanced
    // while the right side still reserves frameless window controls when present.
    expect(tabList).toHaveClass('pr-[calc(0.5rem+var(--window-controls-width,0px))]', 'pl-2')
    expect(tabList).not.toHaveClass('pr-11')
    expect(scrollContainer).toHaveClass('min-w-0', 'flex-1')
    expect(tabsList).not.toHaveClass('overflow-x-auto')

    fireEvent.click(screen.getByRole('button', { name: 'common.maximize' }))

    const minimizeButton = screen.getByRole('button', { name: 'common.minimize' })

    expect(minimizeButton).toHaveAttribute('data-tone', 'conversation')
    expect(minimizeButton).toHaveAttribute('aria-pressed', 'true')
    expect(minimizeButton).not.toHaveAttribute('data-active')
    expect(minimizeButton.querySelector('svg')).not.toHaveAttribute('width', '15')
    // embedded mode (no WindowFrameProvider) stays no-drag and uses the symmetric pl-2 inset
    // even when maximized — the traffic-light inset is sub-window-only.
    expect(tabList).toHaveClass('pl-2')
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

  it('renders a title-mode header with pane-level maximize and close controls', () => {
    render(
      <Shell defaultTab="files" defaultOpen>
        <Shell.Tabs>
          <Shell.TabList title="Files" showTabs={false}>
            <Shell.Tab value="files">Files</Shell.Tab>
          </Shell.TabList>
        </Shell.Tabs>
        <ShellStateSnapshot />
      </Shell>
    )

    expect(screen.getByTestId('shell-tab-title')).toHaveTextContent('Files')
    expect(screen.queryByTestId('shell-tab-scroll-container')).toBeNull()
    expect(screen.getByRole('button', { name: 'common.maximize' })).toBeInTheDocument()

    const closeButton = screen.getByRole('button', { name: 'common.close_sidebar' })
    expect(closeButton).not.toHaveAttribute('data-shell-tab-shortcut')
    expect(closeButton).toHaveAttribute('data-tone', 'conversation')
    expect(closeButton).not.toHaveClass('[&_svg]:!size-3.5')
    expect(within(closeButton).getByTestId('collapse-icon')).toBeInTheDocument()
    expect(closeButton.querySelector('.lucide-x')).toBeNull()

    fireEvent.click(closeButton)

    expect(screen.getByTestId('shell-state')).toHaveTextContent('closed:files:false')
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

  it('keeps the title area draggable when title mode is maximized inside a sub-window', () => {
    render(
      <WindowFrameProvider value={{ mode: 'window' }}>
        <Shell defaultTab="files" defaultOpen>
          <Shell.Tabs>
            <Shell.TabList title="Files" showTabs={false}>
              <Shell.Tab value="files">Files</Shell.Tab>
            </Shell.TabList>
          </Shell.Tabs>
        </Shell>
      </WindowFrameProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: 'common.maximize' }))

    const tabList = screen.getByTestId('shell-tab-list')
    const title = screen.getByTestId('shell-tab-title')
    const controls = title.nextElementSibling

    expect(tabList).toHaveClass('[-webkit-app-region:drag]')
    expect(title).toHaveClass('flex-1', 'select-none')
    expect(title).not.toHaveClass('[-webkit-app-region:no-drag]')
    expect(controls).toHaveClass('[-webkit-app-region:no-drag]')
  })
})

describe('Shell.MaximizedOverlay', () => {
  it('keeps maximized content full-height instead of reserving composer space', async () => {
    const { container } = render(
      <Shell defaultTab="files">
        <Shell.Toggle tab="files" command="topic.sidebar.toggle" />
        <ToggleMaximizedButton />
        <Shell.MaximizedOverlay>
          <div>maximized content</div>
        </Shell.MaximizedOverlay>
      </Shell>
    )

    fireEvent.click(screen.getByRole('button', { name: 'common.open_sidebar' }))
    fireEvent.click(screen.getByRole('button', { name: 'toggle maximized' }))

    await waitFor(() => {
      const content = container.querySelector<HTMLElement>('[data-shell-maximized-overlay-content]')
      expect(content).toHaveClass('h-full')
      expect(content?.style.height).toBe('')
    })
  })
})
