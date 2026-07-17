import { ResourcePaneCountButton } from '@renderer/components/chat/panes/Shell'
import { TabIdProvider } from '@renderer/components/layout/TabIdProvider'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { PropsWithChildren } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { TopicRightPane } from '../TopicRightPane'

const developerModeEnabled = vi.fn(() => true)
const useCommandHandlerMock = vi.hoisted(() => vi.fn())

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
    ARTIFACT_RIGHT_PANE_MIN_WIDTH: 280,
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

vi.mock('../TopicBranchPanel', () => ({
  default: ({ open, onLocateMessage }: { open: boolean; onLocateMessage?: (messageId: string) => void }) => (
    <button
      type="button"
      data-open={String(open)}
      data-testid="branch-pane"
      onClick={() => onLocateMessage?.('message-1')}>
      locate current branch message
    </button>
  )
}))

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: vi.fn()
  },
  useTranslation: () => ({ t: (key: string) => key })
}))

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

  it('registers the right sidebar keyboard shortcut for the branch pane', () => {
    render(
      <TopicRightPane topicId="topic-a">
        <TopicRightPane.Viewport />
      </TopicRightPane>
    )

    expect(useCommandHandlerMock).toHaveBeenCalledWith(
      'topic.sidebar.toggle',
      expect.any(Function),
      expect.objectContaining({ enabled: true })
    )
    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-open', 'false')

    act(triggerRightSidebarShortcut)

    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-open', 'true')
    expect(screen.getByTestId('branch-pane')).toBeInTheDocument()

    act(triggerRightSidebarShortcut)

    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-open', 'false')
  })

  it('opens the resource pane from the right sidebar keyboard shortcut when resources are available', () => {
    render(
      <TopicRightPane
        topicId="topic-a"
        resourcePane={{ node: <div data-testid="resource-list">Resources</div>, label: 'chat.topics.title' }}>
        <TopicRightPane.Viewport />
      </TopicRightPane>
    )

    act(triggerRightSidebarShortcut)

    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-open', 'true')
    expect(screen.getByTestId('resource-list')).toBeInTheDocument()
  })

  it('disables the right sidebar keyboard shortcut without a ready capability', () => {
    render(
      <TopicRightPane>
        <TopicRightPane.Viewport />
      </TopicRightPane>
    )

    expect(useCommandHandlerMock).toHaveBeenCalledWith(
      'topic.sidebar.toggle',
      expect.any(Function),
      expect.objectContaining({ enabled: false })
    )
  })

  it('hides environmental presentation without discarding topic pane intent or its visited instance', () => {
    const { rerender } = render(
      <TopicRightPane topicId="topic-a">
        <TopicRightPane.Viewport />
      </TopicRightPane>
    )

    act(triggerRightSidebarShortcut)
    const branchPane = screen.getByTestId('branch-pane')

    rerender(
      <TopicRightPane topicId="topic-a" present={false}>
        <TopicRightPane.Viewport />
      </TopicRightPane>
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
      <TopicRightPane topicId="topic-a">
        <TopicRightPane.Viewport />
      </TopicRightPane>
    )

    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-open', 'true')
    expect(screen.getByTestId('branch-pane')).toBe(branchPane)
    expect(branchPane).toHaveAttribute('data-open', 'true')
  })

  it('shows a permanent trace tab keyed on the container traceId when developer mode is on', () => {
    render(
      <TopicRightPane topicId="topic-a" traceId="trace-a">
        <TopicRightPane.Shortcuts />
        <TopicRightPane.Viewport />
      </TopicRightPane>
    )

    fireEvent.click(document.querySelector('[data-shell-tab-shortcut="trace"]') as HTMLElement)

    expect(document.querySelector('[data-shell-tab-shortcut="trace"]')).toBeInTheDocument()
    expect(screen.getByTestId('trace-pane')).toHaveAttribute('data-topic-id', 'topic-a')
    expect(screen.getByTestId('trace-pane')).toHaveAttribute('data-trace-id', 'trace-a')
  })

  it('hides the trace tab when developer mode is off', () => {
    developerModeEnabled.mockReturnValue(false)

    render(
      <TopicRightPane topicId="topic-a" traceId="trace-a">
        <TopicRightPane.Shortcuts />
        <TopicRightPane.Viewport />
      </TopicRightPane>
    )

    fireEvent.click(document.querySelector('[data-shell-tab-shortcut="branch"]') as HTMLElement)

    expect(screen.queryByRole('button', { name: /trace\.label/ })).toBeNull()
    expect(screen.queryByTestId('trace-pane')).toBeNull()
    expect(screen.getByTestId('branch-pane')).toBeInTheDocument()
  })

  it('forwards branch-node locate requests without closing the shell', async () => {
    const onLocateMessage = vi.fn()

    render(
      <TopicRightPane topicId="topic-1" topicName="Topic">
        <TopicRightPane.Shortcuts />
        <TopicRightPane.Viewport onLocateMessage={onLocateMessage} />
      </TopicRightPane>
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
      <TopicRightPane
        resourcePane={{ node: <div data-testid="resource-list">Resources</div>, label: 'chat.topics.title' }}
        defaultOpen>
        <TopicRightPane.Viewport />
      </TopicRightPane>
    )

    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-open', 'true')
    expect(screen.getByTestId('resource-list')).toBeInTheDocument()
    expect(screen.getByTestId('shell-tab-title')).toHaveTextContent('chat.topics.title')
    expect(document.querySelector('[data-shell-tab-shortcut="resources"]')).not.toBeInTheDocument()
  })

  it('shows top shortcuts for the stable right-pane tabs while closed', () => {
    render(
      <TopicRightPane
        topicId="topic-a"
        traceId="trace-a"
        resourcePane={{ node: <div data-testid="resource-list">Resources</div>, label: 'chat.topics.title' }}>
        <TopicRightPane.Shortcuts />
        <TopicRightPane.Viewport />
      </TopicRightPane>
    )

    expect(screen.queryByRole('button', { name: 'chat.topics.title' })).toBeNull()
    expect(screen.getByRole('button', { name: 'chat.message.flow.title' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'trace.label' })).toBeInTheDocument()

    const branchShortcut = document.querySelector('[data-shell-tab-shortcut="branch"]')
    expect(branchShortcut).toBeInTheDocument()

    fireEvent.click(branchShortcut as HTMLElement)

    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-open', 'true')
    expect(document.querySelector('[data-shell-tab-shortcut="branch"]')).toBeInTheDocument()
  })

  it('collapses the active pane from the same tab shortcut while preserving the view label', () => {
    render(
      <TopicRightPane topicId="topic-a" traceId="trace-a">
        <TopicRightPane.Shortcuts />
        <TopicRightPane.Viewport />
      </TopicRightPane>
    )

    fireEvent.click(document.querySelector('[data-shell-tab-shortcut="branch"]') as HTMLElement)

    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-open', 'true')
    expect(screen.getByTestId('shell-tab-title')).toHaveTextContent('chat.message.flow.title')

    const openStateShortcut = document.querySelector('[data-shell-tab-shortcut="branch"]')
    expect(openStateShortcut).toBeInTheDocument()
    expect(openStateShortcut).toHaveAttribute('aria-label', 'chat.message.flow.title')
    expect(screen.queryByRole('button', { name: 'common.close_sidebar' })).toBeInTheDocument()

    fireEvent.click(openStateShortcut as HTMLElement)

    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-open', 'false')
  })

  it('switches to another pane entry without closing the docked pane', () => {
    render(
      <TopicRightPane topicId="topic-a" traceId="trace-a">
        <TopicRightPane.Shortcuts />
        <TopicRightPane.Viewport />
      </TopicRightPane>
    )

    fireEvent.click(document.querySelector('[data-shell-tab-shortcut="branch"]') as HTMLElement)
    fireEvent.click(document.querySelector('[data-shell-tab-shortcut="trace"]') as HTMLElement)

    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-open', 'true')
    expect(screen.getByTestId('shell-tab-title')).toHaveTextContent('trace.label')
    expect(screen.getByTestId('trace-pane')).toHaveAttribute('data-topic-id', 'topic-a')
    expect(document.querySelector('[data-shell-tab-shortcut="branch"]')).toHaveAttribute('aria-pressed', 'false')
    expect(document.querySelector('[data-shell-tab-shortcut="trace"]')).toHaveAttribute('aria-pressed', 'true')
  })

  it('keeps visited capabilities mounted across switches without offering maximize', () => {
    render(
      <TopicRightPane
        topicId="topic-a"
        traceId="trace-a"
        resourcePane={{ node: <div data-testid="resource-list">Resources</div>, label: 'chat.topics.title' }}>
        <ResourcePaneCountButton label="chat.topics.title" count={3} />
        <TopicRightPane.Shortcuts />
        <TopicRightPane.Viewport />
      </TopicRightPane>
    )

    fireEvent.click(document.querySelector('[data-shell-tab-shortcut="branch"]') as HTMLElement)
    const branchPane = screen.getByTestId('branch-pane')
    expect(screen.queryByRole('button', { name: 'common.maximize' })).toBeNull()

    fireEvent.click(document.querySelector('[data-shell-tab-shortcut="trace"]') as HTMLElement)

    expect(screen.getByTestId('branch-pane')).toBe(branchPane)
    expect(branchPane).toHaveAttribute('data-open', 'false')
    expect(branchPane).not.toBeVisible()
    expect(screen.queryByRole('button', { name: 'common.maximize' })).toBeNull()

    fireEvent.click(document.querySelector('[data-shell-tab-shortcut="branch"]') as HTMLElement)
    expect(screen.getByTestId('branch-pane')).toBe(branchPane)
    expect(branchPane).toHaveAttribute('data-open', 'true')
    expect(screen.getByTestId('shell-tab-title')).toHaveTextContent('chat.message.flow.title')
    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-open', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'chat.topics.title 3' }))
    expect(screen.getByTestId('resource-list')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'common.maximize' })).toBeNull()
  })

  it('keeps the resource count entry visible while docked open and lets it close the active resource view', () => {
    render(
      <TopicRightPane
        resourcePane={{ node: <div data-testid="resource-list">Resources</div>, label: 'chat.topics.title' }}>
        <ResourcePaneCountButton label="chat.topics.title" count={3} />
        <TopicRightPane.Viewport />
      </TopicRightPane>
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

  it('reconciles an open resource capability to the next ready capability', () => {
    const { rerender } = render(
      <TopicRightPane
        topicId="topic-a"
        resourcePane={{ node: <div data-testid="resource-list">Resources</div>, label: 'chat.topics.title' }}
        defaultOpen>
        <TopicRightPane.Viewport />
      </TopicRightPane>
    )

    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-open', 'true')
    expect(screen.getByTestId('resource-list')).toBeInTheDocument()

    rerender(
      <TopicRightPane topicId="topic-a" defaultOpen>
        <TopicRightPane.Viewport />
      </TopicRightPane>
    )

    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-open', 'true')
    expect(screen.queryByTestId('resource-list')).toBeNull()
    expect(screen.getByTestId('branch-pane')).toBeInTheDocument()
  })

  it('opens the resource pane on a locate reveal request', () => {
    const resourcePane = { node: <div data-testid="resource-list">Resources</div>, label: 'chat.topics.title' }
    const { rerender } = render(
      <TopicRightPane resourcePane={resourcePane}>
        <TopicRightPane.Viewport />
      </TopicRightPane>
    )

    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-open', 'false')

    rerender(
      <TopicRightPane
        resourcePane={resourcePane}
        revealRequest={{ itemId: 'topic-a', requestId: 1, clearFilters: true, clearQuery: true }}>
        <TopicRightPane.Viewport />
      </TopicRightPane>
    )

    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-open', 'true')
    expect(screen.getByTestId('resource-list')).toBeInTheDocument()
  })

  it('does not open the resource pane for a passive (non-locate) reveal request', () => {
    const resourcePane = { node: <div data-testid="resource-list">Resources</div>, label: 'chat.topics.title' }
    const { rerender } = render(
      <TopicRightPane resourcePane={resourcePane}>
        <TopicRightPane.Viewport />
      </TopicRightPane>
    )

    rerender(
      <TopicRightPane resourcePane={resourcePane} revealRequest={{ itemId: 'topic-a', requestId: 2 }}>
        <TopicRightPane.Viewport />
      </TopicRightPane>
    )

    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-open', 'false')
  })

  it('does not open the resource list pane when the owning tab is revealed', async () => {
    render(
      <TabIdProvider tabId="chat-tab">
        <TopicRightPane
          resourcePane={{ node: <div data-testid="resource-list">Resources</div>, label: 'chat.topics.title' }}>
          <TopicRightPane.Viewport />
        </TopicRightPane>
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
