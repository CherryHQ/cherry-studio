import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  ResourceViewSourceProvider,
  shouldLoadResourceViewSource
} from '@renderer/components/ResourceViewSourceProvider'
import type * as ResourceViewSourcesModule from '@renderer/hooks/resourceViewSources'
import {
  type AgentSessionsSource,
  type AssistantTopicsSource,
  useAgentSessionsSource,
  useAssistantTopicsSource
} from '@renderer/hooks/resourceViewSources'
import type * as TabHooksModule from '@renderer/hooks/tab'
import type { Tab } from '@shared/data/cache/cacheValueTypes'

const sourceMocks = vi.hoisted(() => ({
  tabs: [] as Tab[],
  activeTabId: null as string | null,
  assistantEnabled: [] as Array<boolean | undefined>,
  agentEnabled: [] as Array<boolean | undefined>,
  assistantSource: undefined as unknown,
  agentSource: undefined as unknown
}))
const sourceProbeRenders = vi.fn()

vi.mock('@renderer/hooks/tab', async (importOriginal) => {
  const actual = await importOriginal<typeof TabHooksModule>()

  return {
    ...actual,
    useTabs: () => ({ activeTabId: sourceMocks.activeTabId, tabs: sourceMocks.tabs })
  }
})

vi.mock('@renderer/hooks/resourceViewSources', async (importOriginal) => {
  const actual = await importOriginal<typeof ResourceViewSourcesModule>()

  return {
    ...actual,
    useRawAssistantTopicsSource: ({ enabled }: { enabled?: boolean } = {}) => {
      sourceMocks.assistantEnabled.push(enabled)
      return sourceMocks.assistantSource
    },
    useRawAgentSessionsSource: ({ enabled }: { enabled?: boolean } = {}) => {
      sourceMocks.agentEnabled.push(enabled)
      return sourceMocks.agentSource
    }
  }
})

function createTab(id: string, url: string, isDormant = false): Tab {
  return {
    id,
    type: 'route',
    url,
    title: id,
    isDormant
  }
}

function createAssistantSource(
  ids: string[],
  {
    complete,
    refreshing = false,
    error
  }: {
    complete: boolean
    refreshing?: boolean
    error?: Error
  }
): AssistantTopicsSource {
  const topics = ids.map((id) => ({ id }))

  return {
    topics,
    pages: [{ items: topics, nextCursor: complete ? undefined : 'next' }],
    hasNext: !complete,
    loadNext: vi.fn(),
    isLoading: ids.length === 0,
    isLoadingAll: !complete,
    isFullyLoaded: complete,
    isRefreshing: refreshing,
    error,
    refetch: vi.fn(),
    mutate: vi.fn()
  } as unknown as AssistantTopicsSource
}

function createAgentSource(
  ids: string[],
  {
    complete,
    refreshing = false,
    error,
    pinnedIds = []
  }: {
    complete: boolean
    refreshing?: boolean
    error?: Error
    pinnedIds?: string[]
  }
): AgentSessionsSource {
  const sessions = ids.map((id) => ({ id }))

  return {
    sessions,
    pinIdBySessionId: new Map(pinnedIds.map((id) => [id, `pin-${id}`])),
    total: sessions.length,
    hasMore: !complete,
    error,
    isLoading: ids.length === 0,
    isLoadingMore: !complete && ids.length > 0,
    isValidating: refreshing,
    reload: vi.fn(),
    loadMore: vi.fn(),
    createSession: vi.fn(),
    deleteSession: vi.fn(),
    deleteSessions: vi.fn(),
    reorderSession: vi.fn(),
    reorderSessions: vi.fn(),
    togglePin: vi.fn(),
    isFullyLoaded: complete,
    isLoadingAll: !complete,
    isPinsLoading: false
  } as unknown as AgentSessionsSource
}

function SourceProbe() {
  sourceProbeRenders()
  const topicsSource = useAssistantTopicsSource()
  const sessionsSource = useAgentSessionsSource()

  return (
    <>
      <span data-testid="topic-ids">{topicsSource.topics.map((topic) => topic.id).join(',')}</span>
      <span data-testid="topics-loading">{String(topicsSource.isLoadingAll)}</span>
      <span data-testid="topics-refreshing">{String(topicsSource.isRefreshing)}</span>
      <span data-testid="topics-error">{String(Boolean(topicsSource.error))}</span>
      <span data-testid="topics-refresh-error">{String(Boolean(topicsSource.refreshError))}</span>
      <span data-testid="session-ids">{sessionsSource.sessions.map((session) => session.id).join(',')}</span>
      <span data-testid="sessions-loading">{String(sessionsSource.isLoadingAll)}</span>
      <span data-testid="sessions-refreshing">{String(sessionsSource.isValidating)}</span>
      <span data-testid="sessions-refresh-error">{String(Boolean(sessionsSource.refreshError))}</span>
      <span data-testid="session-pins">{[...sessionsSource.pinIdBySessionId.keys()].join(',')}</span>
    </>
  )
}

const createProviderTree = () => (
  <ResourceViewSourceProvider>
    <SourceProbe />
  </ResourceViewSourceProvider>
)

describe('ResourceViewSourceProvider', () => {
  beforeEach(() => {
    sourceMocks.tabs = []
    sourceMocks.activeTabId = null
    sourceMocks.assistantEnabled = []
    sourceMocks.agentEnabled = []
    sourceMocks.assistantSource = createAssistantSource([], { complete: false })
    sourceMocks.agentSource = createAgentSource([], { complete: false })
    sourceProbeRenders.mockClear()
  })

  it('publishes progressive assistant topics on cold start and keeps the complete snapshot stable during refresh', async () => {
    sourceMocks.tabs = [createTab('chat', '/app/chat')]
    sourceMocks.activeTabId = 'chat'
    sourceMocks.assistantSource = createAssistantSource(['partial'], { complete: false })

    const { rerender } = render(createProviderTree())

    expect(screen.getByTestId('topic-ids')).toHaveTextContent('partial')
    expect(screen.getByTestId('topics-loading')).toHaveTextContent('true')

    sourceMocks.assistantSource = createAssistantSource(['topic-1', 'topic-2'], { complete: true })
    rerender(createProviderTree())

    await waitFor(() => expect(screen.getByTestId('topic-ids')).toHaveTextContent('topic-1,topic-2'))

    sourceMocks.assistantSource = createAssistantSource(['replacement-partial'], {
      complete: false,
      refreshing: true
    })
    rerender(createProviderTree())

    expect(screen.getByTestId('topic-ids')).toHaveTextContent('topic-1,topic-2')
    expect(screen.getByTestId('topics-loading')).toHaveTextContent('false')
    expect(screen.getByTestId('topics-refreshing')).toHaveTextContent('true')

    sourceMocks.assistantSource = createAssistantSource(['topic-3'], { complete: true })
    rerender(createProviderTree())

    await waitFor(() => expect(screen.getByTestId('topic-ids')).toHaveTextContent('topic-3'))
  })

  it('publishes progressive agent sessions on cold start and keeps the complete snapshot during refresh', async () => {
    sourceMocks.tabs = [createTab('agent', '/app/agents')]
    sourceMocks.activeTabId = 'agent'
    sourceMocks.agentSource = createAgentSource(['session-partial'], { complete: false })

    const { rerender } = render(createProviderTree())

    expect(screen.getByTestId('session-ids')).toHaveTextContent('session-partial')
    expect(screen.getByTestId('sessions-loading')).toHaveTextContent('true')

    sourceMocks.agentSource = createAgentSource(['session-1', 'session-2'], { complete: true })
    rerender(createProviderTree())

    await waitFor(() => expect(screen.getByTestId('session-ids')).toHaveTextContent('session-1,session-2'))

    sourceMocks.agentSource = createAgentSource(['replacement-partial'], {
      complete: false,
      refreshing: true,
      error: new Error('refresh failed')
    })
    rerender(createProviderTree())

    expect(screen.getByTestId('session-ids')).toHaveTextContent('session-1,session-2')
    expect(screen.getByTestId('sessions-loading')).toHaveTextContent('false')
    expect(screen.getByTestId('sessions-refreshing')).toHaveTextContent('true')
  })

  it('stops reporting refreshing when a failed background refresh goes idle', async () => {
    sourceMocks.tabs = [createTab('chat', '/app/chat'), createTab('agent', '/app/agents')]
    sourceMocks.activeTabId = 'chat'
    sourceMocks.assistantSource = createAssistantSource(['topic-1'], { complete: true })

    const { rerender } = render(createProviderTree())

    await waitFor(() => expect(screen.getByTestId('topic-ids')).toHaveTextContent('topic-1'))

    // A mid-chain load-all failure leaves the source incomplete and idle. The
    // stale snapshot stays published, but the refreshing flag must clear so
    // consumers (e.g. reorder gating) do not hang on it indefinitely.
    sourceMocks.assistantSource = createAssistantSource(['replacement-partial'], {
      complete: false,
      refreshing: false,
      error: new Error('refresh failed')
    })
    rerender(createProviderTree())

    expect(screen.getByTestId('topic-ids')).toHaveTextContent('topic-1')
    expect(screen.getByTestId('topics-refreshing')).toHaveTextContent('false')
  })

  it('does not publish another snapshot when a refresh resolves to the same references', async () => {
    sourceMocks.tabs = [createTab('chat', '/app/chat')]
    sourceMocks.activeTabId = 'chat'
    const assistantSource = createAssistantSource(['topic-1'], { complete: true })
    sourceMocks.assistantSource = assistantSource

    const { rerender } = render(createProviderTree())

    await waitFor(() => expect(screen.getByTestId('topic-ids')).toHaveTextContent('topic-1'))

    sourceMocks.assistantSource = { ...assistantSource, isFullyLoaded: false, isRefreshing: true }
    rerender(createProviderTree())

    sourceProbeRenders.mockClear()
    sourceMocks.assistantSource = assistantSource
    rerender(createProviderTree())

    await waitFor(() => expect(screen.getByTestId('topics-refreshing')).toHaveTextContent('false'))
    expect(sourceProbeRenders).toHaveBeenCalledTimes(1)
  })

  it('reports a failed background refresh without tearing down the stale snapshot', async () => {
    sourceMocks.tabs = [createTab('chat', '/app/chat')]
    sourceMocks.activeTabId = 'chat'
    sourceMocks.assistantSource = createAssistantSource(['topic-1'], { complete: true })

    const { rerender } = render(createProviderTree())

    await waitFor(() => expect(screen.getByTestId('topic-ids')).toHaveTextContent('topic-1'))
    expect(screen.getByTestId('topics-refresh-error')).toHaveTextContent('false')

    sourceMocks.assistantSource = createAssistantSource(['replacement-partial'], {
      complete: false,
      error: new Error('refresh failed')
    })
    rerender(createProviderTree())

    // `error` stays clear so the list is not replaced by an error panel, but
    // the failure has to reach consumers somehow — nothing retries on its own.
    expect(screen.getByTestId('topic-ids')).toHaveTextContent('topic-1')
    expect(screen.getByTestId('topics-error')).toHaveTextContent('false')
    expect(screen.getByTestId('topics-refresh-error')).toHaveTextContent('true')
  })

  it('keeps the published pin state in step with the map togglePin acts on', async () => {
    sourceMocks.tabs = [createTab('agent', '/app/agents')]
    sourceMocks.activeTabId = 'agent'
    sourceMocks.agentSource = createAgentSource(['session-1', 'session-2'], { complete: true })

    const { rerender } = render(createProviderTree())

    await waitFor(() => expect(screen.getByTestId('session-ids')).toHaveTextContent('session-1,session-2'))
    expect(screen.getByTestId('session-pins')).toHaveTextContent('')

    // The pin lands, then the session refresh fails and freezes the snapshot.
    // `togglePin` reads the raw map, so a published snapshot pin state would
    // make the row's button do the opposite of its label on the next click.
    sourceMocks.agentSource = createAgentSource(['session-1', 'session-2'], {
      complete: false,
      error: new Error('refresh failed'),
      pinnedIds: ['session-1']
    })
    rerender(createProviderTree())

    expect(screen.getByTestId('session-ids')).toHaveTextContent('session-1,session-2')
    expect(screen.getByTestId('sessions-refresh-error')).toHaveTextContent('true')
    expect(screen.getByTestId('session-pins')).toHaveTextContent('session-1')
  })

  it('loads only the source owned by the active non-dormant, non-message-only route tab', () => {
    sourceMocks.tabs = [
      createTab('chat-message', '/app/chat?topicId=topic-1&view=message'),
      createTab('agent-dormant', '/app/agents?sessionId=session-1', true),
      createTab('chat', '/app/chat?topicId=topic-2')
    ]
    sourceMocks.activeTabId = 'chat'

    render(createProviderTree())

    expect(sourceMocks.assistantEnabled.at(-1)).toBe(true)
    expect(sourceMocks.agentEnabled.at(-1)).toBe(false)
    expect(
      shouldLoadResourceViewSource([createTab('message', '/app/chat?view=message')], 'message', 'assistants')
    ).toBe(false)
  })
})
