import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ComponentProps, PropsWithChildren } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ResourcePaneCountButton } from '@renderer/components/chat/panes/Shell'
import { TabIdProvider } from '@renderer/components/layout/TabIdProvider'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'

import { TopicBranchPortal, TopicRightPane } from '../TopicRightPane'

const developerModeEnabled = vi.fn(() => true)
const useCommandHandlerMock = vi.hoisted(() => vi.fn())
const topicBranchPanelModuleState = vi.hoisted(() => ({ importCount: 0 }))

vi.mock('@renderer/hooks/command', () => ({
  useCommandHandler: useCommandHandlerMock
}))

vi.mock('@renderer/hooks/tab', async (importOriginal) => ({
  ...(await importOriginal()),
  useIsActiveTab: () => true
}))

vi.mock('@renderer/data/hooks/usePreference', () => ({
  usePreference: (key: string) =>
    key === 'app.developer_mode.enabled' ? [developerModeEnabled(), vi.fn()] : [undefined, vi.fn()]
}))

vi.mock('@cherrystudio/ui', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>()
  const { createContext, use } = await import('react')
  const TabsValueContext = createContext('')

  return {
    ...original,
    Button: ({ children, ...props }: PropsWithChildren<Record<string, unknown>>) => (
      <button type="button" {...props}>
        {children}
      </button>
    ),
    Tabs: ({ children, value }: PropsWithChildren<{ value?: string }>) => (
      <TabsValueContext value={value ?? ''}>{children}</TabsValueContext>
    ),
    TabsContent: ({
      children,
      className,
      forceMount,
      value
    }: PropsWithChildren<{ className?: string; forceMount?: boolean; value: string }>) => {
      const activeValue = use(TabsValueContext)
      const active = activeValue === value
      if (!active && !forceMount) return null

      return (
        <div className={className} data-state={active ? 'active' : 'inactive'} hidden={!active}>
          {children}
        </div>
      )
    },
    TabsList: ({ children }: PropsWithChildren) => <div>{children}</div>,
    TabsTrigger: ({ children, ...props }: PropsWithChildren<Record<string, unknown>>) => (
      <button type="button" {...props}>
        {children}
      </button>
    ),
    Tooltip: ({ children }: PropsWithChildren) => children
  }
})

vi.mock('@renderer/components/chat/shell/RightPaneHost', () => {
  return {
    ARTIFACT_RIGHT_PANE_CACHE_KEY: 'ui.chat.artifact_pane.width',
    ARTIFACT_RIGHT_PANE_DEFAULT_WIDTH: 280,
    ARTIFACT_RIGHT_PANE_MAX_WIDTH: 720,
    ARTIFACT_RIGHT_PANE_MIN_WIDTH: 255,
    PersistentRightPaneHost: ({
      children,
      maximized,
      open
    }: PropsWithChildren<{ maximized?: boolean; open?: boolean }>) => (
      <section
        data-testid="right-pane"
        data-open={String(Boolean(open))}
        data-maximized={String(Boolean(maximized))}
        hidden={!open}>
        {children}
      </section>
    )
  }
})

vi.mock('@renderer/components/chat/trace/TracePane', () => ({
  TracePane: ({ payload }: { payload: { topicId: string; traceId: string } | null }) =>
    payload ? <div data-testid="trace-pane" data-topic-id={payload.topicId} data-trace-id={payload.traceId} /> : null
}))

vi.mock('../TopicBranchPanel', () => {
  topicBranchPanelModuleState.importCount += 1
  return {
    default: ({ open, onLocateMessage }: { open: boolean; onLocateMessage?: (messageId: string) => void }) => (
      <button
        type="button"
        data-open={String(open)}
        data-testid="branch-pane"
        onClick={() => onLocateMessage?.('message-1')}>
        locate current branch message
      </button>
    )
  }
})

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: vi.fn()
  },
  useTranslation: () => ({ t: (key: string) => key })
}))

function TestScope({ children, ...props }: ComponentProps<typeof TopicRightPane.Scope>) {
  return (
    <TopicRightPane.Scope {...props}>
      <TopicBranchPortal topicId={props.topicId ?? ''} />
      {children}
    </TopicRightPane.Scope>
  )
}

describe('TopicRightPane', () => {
  beforeEach(() => {
    useCommandHandlerMock.mockClear()
    developerModeEnabled.mockReturnValue(true)
  })

  const triggerRightSidebarShortcut = () => {
    const handler = useCommandHandlerMock.mock.calls
      .filter(([command]) => command === 'topic.sidebar.toggle')
      .at(-1)?.[1] as (() => void) | undefined

    expect(handler).toBeDefined()
    handler?.()
  }

  const openAdvancedView = () => {
    fireEvent.click(document.querySelector('[data-shell-tab-shortcut="branch"]') as HTMLElement)
  }

  it('does not load the branch flow implementation before the pane opens', () => {
    render(
      <TestScope topicId="topic-a">
        <TopicRightPane.Viewport />
      </TestScope>
    )

    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-open', 'false')
    expect(topicBranchPanelModuleState.importCount).toBe(0)
  })

  it('registers the right sidebar keyboard shortcut for the branch pane', async () => {
    render(
      <TestScope topicId="topic-a">
        <TopicRightPane.Viewport />
      </TestScope>
    )

    expect(useCommandHandlerMock).toHaveBeenCalledWith(
      'topic.sidebar.toggle',
      expect.any(Function),
      expect.objectContaining({ enabled: true })
    )
    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-open', 'false')

    act(triggerRightSidebarShortcut)

    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-open', 'true')
    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-maximized', 'true')
    expect(await screen.findByTestId('branch-pane')).toBeInTheDocument()

    act(triggerRightSidebarShortcut)

    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-open', 'false')
  })

  it('opens the resource pane from the right sidebar keyboard shortcut when resources are available', () => {
    render(
      <TestScope
        topicId="topic-a"
        resourcePane={{ node: <div data-testid="resource-list">Resources</div>, label: 'chat.topics.title' }}>
        <TopicRightPane.Viewport />
      </TestScope>
    )

    act(triggerRightSidebarShortcut)

    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-open', 'true')
    expect(screen.getByTestId('resource-list')).toBeInTheDocument()
  })

  it('disables the right sidebar keyboard shortcut without a ready capability', () => {
    render(
      <TestScope>
        <TopicRightPane.Viewport />
      </TestScope>
    )

    expect(useCommandHandlerMock).toHaveBeenCalledWith(
      'topic.sidebar.toggle',
      expect.any(Function),
      expect.objectContaining({ enabled: false })
    )
  })

  it('hides environmental presentation without discarding topic pane intent or its visited instance', async () => {
    const { rerender } = render(
      <TestScope topicId="topic-a">
        <TopicRightPane.Viewport />
      </TestScope>
    )

    act(triggerRightSidebarShortcut)
    const branchPane = await screen.findByTestId('branch-pane')

    rerender(
      <TestScope topicId="topic-a" present={false}>
        <TopicRightPane.Viewport />
      </TestScope>
    )

    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-open', 'false')
    expect(screen.getByTestId('branch-pane')).toBe(branchPane)
    expect(branchPane).toHaveAttribute('data-open', 'false')
    expect(useCommandHandlerMock).toHaveBeenLastCalledWith(
      'topic.sidebar.toggle',
      expect.any(Function),
      expect.objectContaining({ enabled: false })
    )

    rerender(
      <TestScope topicId="topic-a">
        <TopicRightPane.Viewport />
      </TestScope>
    )

    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-open', 'true')
    expect(screen.getByTestId('branch-pane')).toBe(branchPane)
    expect(branchPane).toHaveAttribute('data-open', 'true')
  })

  it('loads the trace pane with the container traceId only when the trace tab is selected', async () => {
    render(
      <TestScope topicId="topic-a" traceId="trace-a">
        <TopicRightPane.Shortcuts />
        <TopicRightPane.Viewport />
      </TestScope>
    )

    expect(document.querySelector('[data-shell-tab-shortcut="trace"]')).toBeInTheDocument()
    expect(screen.queryByTestId('trace-pane')).toBeNull()

    fireEvent.click(document.querySelector('[data-shell-tab-shortcut="trace"]') as HTMLElement)

    expect(await screen.findByTestId('trace-pane')).toHaveAttribute('data-topic-id', 'topic-a')
    expect(screen.getByTestId('trace-pane')).toHaveAttribute('data-trace-id', 'trace-a')
  })

  it('unmounts the trace pane after switching away so its trace tree can be collected', async () => {
    render(
      <TestScope topicId="topic-a" traceId="trace-a">
        <TopicRightPane.Shortcuts />
        <TopicRightPane.Viewport />
      </TestScope>
    )

    fireEvent.click(document.querySelector('[data-shell-tab-shortcut="trace"]') as HTMLElement)
    const tracePane = await screen.findByTestId('trace-pane')

    openAdvancedView()
    expect(screen.queryByTestId('trace-pane')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'common.close' }))
    fireEvent.click(document.querySelector('[data-shell-tab-shortcut="trace"]') as HTMLElement)
    expect(await screen.findByTestId('trace-pane')).not.toBe(tracePane)
  })

  it('hides the trace tab when developer mode is off', async () => {
    developerModeEnabled.mockReturnValue(false)

    render(
      <TestScope topicId="topic-a" traceId="trace-a">
        <TopicRightPane.Shortcuts />
        <TopicRightPane.Viewport />
      </TestScope>
    )

    expect(screen.queryByRole('button', { name: /trace\.label/ })).toBeNull()
    expect(screen.queryByTestId('trace-pane')).toBeNull()
    openAdvancedView()
    expect(await screen.findByTestId('branch-pane')).toBeInTheDocument()
  })

  it('forwards branch-node locate requests without closing the shell', async () => {
    const onLocateMessage = vi.fn()

    render(
      <TestScope topicId="topic-1" topicName="Topic">
        <TopicRightPane.Shortcuts />
        <TopicRightPane.Viewport onLocateMessage={onLocateMessage} />
      </TestScope>
    )

    fireEvent.click(document.querySelector('[data-shell-tab-shortcut="branch"]') as HTMLElement)
    fireEvent.click(screen.getByRole('button', { name: 'locate current branch message' }))

    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-open', 'true')

    await waitFor(() => {
      expect(onLocateMessage).toHaveBeenCalledWith('message-1')
    })
  })

  it('mounts the resource list pane open when requested', () => {
    render(
      <TestScope
        resourcePane={{ node: <div data-testid="resource-list">Resources</div>, label: 'chat.topics.title' }}
        defaultOpen>
        <TopicRightPane.Viewport />
      </TestScope>
    )

    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-open', 'true')
    expect(screen.getByTestId('resource-list')).toBeInTheDocument()
    expect(screen.getByTestId('shell-tab-title')).toHaveTextContent('chat.topics.title')
    expect(document.querySelector('[data-shell-tab-shortcut="resources"]')).not.toBeInTheDocument()
  })

  it('opens Advanced View only maximized and restores shortcuts after closing', () => {
    render(
      <TestScope
        topicId="topic-a"
        topicName="Trip planning"
        traceId="trace-a"
        resourcePane={{ node: <div data-testid="resource-list">Resources</div>, label: 'chat.topics.title' }}>
        <TopicRightPane.Shortcuts />
        <TopicRightPane.Viewport />
      </TestScope>
    )

    expect(screen.queryByRole('button', { name: 'chat.topics.title' })).toBeNull()
    expect(screen.getByRole('button', { name: 'chat.message.flow.title' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'trace.label' })).toBeInTheDocument()

    const branchShortcut = document.querySelector('[data-shell-tab-shortcut="branch"]')
    expect(branchShortcut).toBeInTheDocument()

    fireEvent.click(branchShortcut as HTMLElement)

    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-maximized', 'true')
    expect(screen.getByText('Trip planning')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'common.minimize' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'common.maximize' })).toBeNull()
    expect(document.querySelector('[data-shell-tab-shortcut="branch"]')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'common.close' }))
    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-open', 'false')
    expect(document.querySelector('[data-shell-tab-shortcut="branch"]')).toBeInTheDocument()
  })

  it('collapses the active docked pane from the same tab shortcut while preserving the view label', () => {
    render(
      <TestScope topicId="topic-a" traceId="trace-a">
        <TopicRightPane.Shortcuts />
        <TopicRightPane.Viewport />
      </TestScope>
    )

    fireEvent.click(document.querySelector('[data-shell-tab-shortcut="trace"]') as HTMLElement)

    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-open', 'true')
    expect(screen.getByTestId('shell-tab-title')).toHaveTextContent('trace.label')

    const openStateShortcut = document.querySelector('[data-shell-tab-shortcut="trace"]')
    expect(openStateShortcut).toBeInTheDocument()
    expect(openStateShortcut).toHaveAttribute('aria-label', 'trace.label')
    expect(screen.queryByRole('button', { name: 'common.close_sidebar' })).toBeInTheDocument()

    fireEvent.click(openStateShortcut as HTMLElement)

    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-open', 'false')
  })

  it('switches to another pane entry without closing the docked pane', () => {
    render(
      <TestScope
        topicId="topic-a"
        traceId="trace-a"
        resourcePane={{ node: <div data-testid="resource-list">Resources</div>, label: 'chat.topics.title' }}
        defaultOpen>
        <TopicRightPane.Shortcuts />
        <TopicRightPane.Viewport />
      </TestScope>
    )

    fireEvent.click(document.querySelector('[data-shell-tab-shortcut="trace"]') as HTMLElement)

    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-open', 'true')
    expect(screen.getByTestId('shell-tab-title')).toHaveTextContent('trace.label')
    expect(screen.getByTestId('trace-pane')).toHaveAttribute('data-topic-id', 'topic-a')
    expect(document.querySelector('[data-shell-tab-shortcut="branch"]')).toHaveAttribute('aria-pressed', 'false')
    expect(document.querySelector('[data-shell-tab-shortcut="trace"]')).toHaveAttribute('aria-pressed', 'true')
  })

  it('preserves Advanced View across reopening while trace and resources remain docked', async () => {
    render(
      <TestScope
        topicId="topic-a"
        topicName="Trip planning"
        traceId="trace-a"
        resourcePane={{ node: <div data-testid="resource-list">Resources</div>, label: 'chat.topics.title' }}>
        <ResourcePaneCountButton label="chat.topics.title" count={3} />
        <TopicRightPane.Shortcuts />
        <TopicRightPane.Viewport />
      </TestScope>
    )

    fireEvent.click(document.querySelector('[data-shell-tab-shortcut="branch"]') as HTMLElement)
    const branchPane = await screen.findByTestId('branch-pane')
    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-maximized', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'common.close' }))

    fireEvent.click(document.querySelector('[data-shell-tab-shortcut="trace"]') as HTMLElement)

    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-maximized', 'false')
    expect(screen.getByTestId('branch-pane')).toBe(branchPane)
    expect(branchPane).toHaveAttribute('data-open', 'false')
    expect(branchPane).not.toBeVisible()
    expect(screen.queryByRole('button', { name: 'common.maximize' })).toBeNull()

    fireEvent.click(document.querySelector('[data-shell-tab-shortcut="branch"]') as HTMLElement)
    expect(screen.getByTestId('branch-pane')).toBe(branchPane)
    expect(branchPane).toHaveAttribute('data-open', 'true')
    expect(screen.getByText('Trip planning')).toBeVisible()
    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-open', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'common.close' }))
    fireEvent.click(screen.getByRole('button', { name: 'chat.topics.title 3' }))
    expect(screen.getByTestId('resource-list')).toBeInTheDocument()
    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-maximized', 'false')
    expect(screen.queryByRole('button', { name: 'common.maximize' })).toBeNull()
  })

  it('keeps the resource count entry visible while docked open and lets it close the active resource view', () => {
    render(
      <TestScope resourcePane={{ node: <div data-testid="resource-list">Resources</div>, label: 'chat.topics.title' }}>
        <ResourcePaneCountButton label="chat.topics.title" count={3} />
        <TopicRightPane.Viewport />
      </TestScope>
    )

    const resourceEntry = screen.getByRole('button', { name: 'chat.topics.title 3' })

    fireEvent.click(resourceEntry)

    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-open', 'true')
    expect(screen.getByTestId('resource-list')).toBeInTheDocument()
    expect(screen.getByTestId('shell-tab-title')).toHaveTextContent('chat.topics.title')
    expect(resourceEntry).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(resourceEntry)

    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-open', 'false')
  })

  it('reconciles an open resource capability to the next ready capability', async () => {
    const { rerender } = render(
      <TestScope
        topicId="topic-a"
        resourcePane={{ node: <div data-testid="resource-list">Resources</div>, label: 'chat.topics.title' }}
        defaultOpen>
        <TopicRightPane.Viewport />
      </TestScope>
    )

    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-open', 'true')
    expect(screen.getByTestId('resource-list')).toBeInTheDocument()

    rerender(
      <TestScope topicId="topic-a" defaultOpen>
        <TopicRightPane.Viewport />
      </TestScope>
    )

    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-open', 'true')
    expect(screen.queryByTestId('resource-list')).toBeNull()
    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-maximized', 'true')
    expect(await screen.findByTestId('branch-pane')).toBeInTheDocument()
  })

  it('opens the resource pane on a locate reveal request', () => {
    const resourcePane = { node: <div data-testid="resource-list">Resources</div>, label: 'chat.topics.title' }
    const { rerender } = render(
      <TestScope resourcePane={resourcePane}>
        <TopicRightPane.Viewport />
      </TestScope>
    )

    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-open', 'false')

    rerender(
      <TestScope
        resourcePane={resourcePane}
        revealRequest={{ itemId: 'topic-a', requestId: 1, clearFilters: true, clearQuery: true }}>
        <TopicRightPane.Viewport />
      </TestScope>
    )

    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-open', 'true')
    expect(screen.getByTestId('resource-list')).toBeInTheDocument()
  })

  it('does not open the resource pane for a passive (non-locate) reveal request', () => {
    const resourcePane = { node: <div data-testid="resource-list">Resources</div>, label: 'chat.topics.title' }
    const { rerender } = render(
      <TestScope resourcePane={resourcePane}>
        <TopicRightPane.Viewport />
      </TestScope>
    )

    rerender(
      <TestScope resourcePane={resourcePane} revealRequest={{ itemId: 'topic-a', requestId: 2 }}>
        <TopicRightPane.Viewport />
      </TestScope>
    )

    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-open', 'false')
  })

  it('does not open the resource list pane when the owning tab is revealed', async () => {
    render(
      <TabIdProvider tabId="chat-tab">
        <TestScope
          resourcePane={{ node: <div data-testid="resource-list">Resources</div>, label: 'chat.topics.title' }}>
          <TopicRightPane.Viewport />
        </TestScope>
      </TabIdProvider>
    )

    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-open', 'false')

    await act(async () => {
      await EventEmitter.emit(EVENT_NAMES.REVEAL_ACTIVE_RESOURCE_LIST, {
        source: 'assistants',
        tabId: 'chat-tab'
      })
    })

    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-open', 'false')
    expect(screen.queryByTestId('resource-list')).toBeNull()
  })
})
