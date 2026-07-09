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

vi.mock('@renderer/data/hooks/usePreference', () => ({
  usePreference: (key: string) =>
    key === 'app.developer_mode.enabled' ? [developerModeEnabled(), vi.fn()] : [undefined, vi.fn()]
}))

vi.mock('@cherrystudio/ui', async (importOriginal) => ({
  ...(await importOriginal()),
  Button: ({ children, ...props }: PropsWithChildren<Record<string, unknown>>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  Tabs: ({ children }: PropsWithChildren) => <div>{children}</div>,
  TabsContent: ({ children }: PropsWithChildren) => <div>{children}</div>,
  TabsList: ({ children }: PropsWithChildren) => <div>{children}</div>,
  TabsTrigger: ({ children, ...props }: PropsWithChildren<Record<string, unknown>>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  Tooltip: ({ children }: PropsWithChildren) => children
}))

vi.mock('@renderer/components/chat/shell/RightPaneHost', async () => {
  const React = await import('react')

  return {
    ARTIFACT_RIGHT_PANE_CACHE_KEY: 'ui.chat.artifact_pane.width',
    ARTIFACT_RIGHT_PANE_DEFAULT_WIDTH: 280,
    ARTIFACT_RIGHT_PANE_MAX_WIDTH: 720,
    ARTIFACT_RIGHT_PANE_MIN_WIDTH: 280,
    RightPaneHost: ({
      children,
      onCloseAnimationComplete,
      open
    }: PropsWithChildren<{ onCloseAnimationComplete?: () => void; open?: boolean }>) => {
      React.useEffect(() => {
        if (!open) onCloseAnimationComplete?.()
      }, [onCloseAnimationComplete, open])

      return (
        <section data-testid="right-pane" data-open={String(Boolean(open))}>
          {open ? children : null}
        </section>
      )
    }
  }
})

vi.mock('@renderer/components/chat/trace/TracePane', () => ({
  TracePane: ({ payload }: { payload: { topicId: string; traceId: string } | null }) => (
    <div data-testid="trace-pane" data-topic-id={payload?.topicId} data-trace-id={payload?.traceId} />
  )
}))

vi.mock('../TopicBranchPanel', () => ({
  default: ({ onLocateMessage }: { onLocateMessage?: (messageId: string) => void }) => (
    <button type="button" data-testid="branch-pane" onClick={() => onLocateMessage?.('message-1')}>
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

  it('does not register the right sidebar keyboard shortcut for conversation panes', () => {
    render(
      <TopicRightPane>
        <TopicRightPane.Shortcuts topicId="topic-a" />
        <TopicRightPane.Host topicId="topic-a" />
      </TopicRightPane>
    )

    expect(useCommandHandlerMock).not.toHaveBeenCalledWith(
      'topic.sidebar.toggle',
      expect.any(Function),
      expect.anything()
    )
  })

  it('shows a permanent trace tab keyed on the container traceId when developer mode is on', () => {
    render(
      <TopicRightPane>
        <TopicRightPane.Shortcuts topicId="topic-a" />
        <TopicRightPane.Host topicId="topic-a" traceId="trace-a" />
      </TopicRightPane>
    )

    fireEvent.click(document.querySelector('[data-shell-tab-shortcut="branch"]') as HTMLElement)

    expect(document.querySelector('[data-shell-tab-shortcut="trace"]')).toBeInTheDocument()
    expect(screen.getByTestId('trace-pane')).toHaveAttribute('data-topic-id', 'topic-a')
    expect(screen.getByTestId('trace-pane')).toHaveAttribute('data-trace-id', 'trace-a')
  })

  it('hides the trace tab when developer mode is off', () => {
    developerModeEnabled.mockReturnValue(false)

    render(
      <TopicRightPane>
        <TopicRightPane.Shortcuts topicId="topic-a" />
        <TopicRightPane.Host topicId="topic-a" traceId="trace-a" />
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
      <TopicRightPane>
        <TopicRightPane.Shortcuts topicId="topic-1" />
        <TopicRightPane.Host topicId="topic-1" topicName="Topic" onLocateMessage={onLocateMessage} />
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
        <TopicRightPane.Host />
      </TopicRightPane>
    )

    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-open', 'true')
    expect(screen.getByTestId('resource-list')).toBeInTheDocument()
    expect(document.querySelector('[data-shell-tab-shortcut="resources"]')).toBeInTheDocument()
  })

  it('shows top shortcuts for the stable right-pane tabs while closed', () => {
    render(
      <TopicRightPane
        resourcePane={{ node: <div data-testid="resource-list">Resources</div>, label: 'chat.topics.title' }}>
        <TopicRightPane.Shortcuts topicId="topic-a" />
        <TopicRightPane.Host topicId="topic-a" traceId="trace-a" />
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

  it('collapses the active pane from the same tab shortcut without rendering the generic close toggle', () => {
    render(
      <TopicRightPane>
        <TopicRightPane.Shortcuts topicId="topic-a" />
        <TopicRightPane.Host topicId="topic-a" traceId="trace-a" />
      </TopicRightPane>
    )

    fireEvent.click(document.querySelector('[data-shell-tab-shortcut="branch"]') as HTMLElement)

    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-open', 'true')
    expect(screen.getByRole('button', { name: 'common.close_sidebar' })).toHaveAttribute(
      'data-shell-tab-shortcut',
      'branch'
    )

    const openStateShortcut = document.querySelector('[data-shell-tab-shortcut="branch"]')
    expect(openStateShortcut).toBeInTheDocument()

    fireEvent.click(openStateShortcut as HTMLElement)

    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-open', 'false')
  })

  it('hides the top trace shortcut when developer mode is off', () => {
    developerModeEnabled.mockReturnValue(false)

    render(
      <TopicRightPane
        resourcePane={{ node: <div data-testid="resource-list">Resources</div>, label: 'chat.topics.title' }}>
        <TopicRightPane.Shortcuts topicId="topic-a" />
        <TopicRightPane.Host topicId="topic-a" traceId="trace-a" />
      </TopicRightPane>
    )

    expect(screen.queryByRole('button', { name: 'chat.topics.title' })).toBeNull()
    expect(screen.getByRole('button', { name: 'chat.message.flow.title' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'trace.label' })).toBeNull()
  })

  it('resets the open resource tab when the resource pane is removed', () => {
    const { rerender } = render(
      <TopicRightPane
        resourcePane={{ node: <div data-testid="resource-list">Resources</div>, label: 'chat.topics.title' }}
        defaultOpen>
        <TopicRightPane.Host topicId="topic-a" />
      </TopicRightPane>
    )

    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-open', 'true')
    expect(screen.getByTestId('resource-list')).toBeInTheDocument()

    rerender(
      <TopicRightPane>
        <TopicRightPane.Host topicId="topic-a" />
      </TopicRightPane>
    )

    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-open', 'false')
    expect(screen.queryByTestId('resource-list')).toBeNull()
  })

  it('opens the resource pane on a locate reveal request', () => {
    const resourcePane = { node: <div data-testid="resource-list">Resources</div>, label: 'chat.topics.title' }
    const { rerender } = render(
      <TopicRightPane resourcePane={resourcePane}>
        <TopicRightPane.Host />
      </TopicRightPane>
    )

    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-open', 'false')

    rerender(
      <TopicRightPane
        resourcePane={resourcePane}
        revealRequest={{ itemId: 'topic-a', requestId: 1, clearFilters: true, clearQuery: true }}>
        <TopicRightPane.Host />
      </TopicRightPane>
    )

    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-open', 'true')
    expect(screen.getByTestId('resource-list')).toBeInTheDocument()
  })

  it('does not open the resource pane for a passive (non-locate) reveal request', () => {
    const resourcePane = { node: <div data-testid="resource-list">Resources</div>, label: 'chat.topics.title' }
    const { rerender } = render(
      <TopicRightPane resourcePane={resourcePane}>
        <TopicRightPane.Host />
      </TopicRightPane>
    )

    rerender(
      <TopicRightPane resourcePane={resourcePane} revealRequest={{ itemId: 'topic-a', requestId: 2 }}>
        <TopicRightPane.Host />
      </TopicRightPane>
    )

    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-open', 'false')
  })

  it('does not open the resource list pane when the owning tab is revealed', async () => {
    render(
      <TabIdProvider tabId="chat-tab">
        <TopicRightPane
          resourcePane={{ node: <div data-testid="resource-list">Resources</div>, label: 'chat.topics.title' }}>
          <TopicRightPane.Host />
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
