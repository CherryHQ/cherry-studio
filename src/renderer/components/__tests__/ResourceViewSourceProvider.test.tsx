import {
  ResourceViewSourceProvider,
  shouldLoadResourceViewSource
} from '@renderer/components/ResourceViewSourceProvider'
import type * as ResourceViewSourcesModule from '@renderer/hooks/resourceViewSources'
import { useAgentSessionsSource, useAssistantTopicsSource } from '@renderer/hooks/resourceViewSources'
import type * as TabHooksModule from '@renderer/hooks/tab'
import type { Tab } from '@shared/data/cache/cacheValueTypes'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const sourceMocks = vi.hoisted(() => ({
  tabs: [] as Tab[],
  activeTabId: null as string | null,
  assistantEnabled: [] as Array<boolean | undefined>,
  agentEnabled: [] as Array<boolean | undefined>,
  assistantSource: undefined as unknown,
  agentSource: undefined as unknown
}))

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

function SourceProbe() {
  const topicsSource = useAssistantTopicsSource()
  const sessionsSource = useAgentSessionsSource()

  return (
    <>
      <span data-testid="topic-count">{topicsSource.stats?.total}</span>
      <span data-testid="session-count">{sessionsSource.stats?.total}</span>
    </>
  )
}

describe('ResourceViewSourceProvider', () => {
  beforeEach(() => {
    sourceMocks.tabs = []
    sourceMocks.activeTabId = null
    sourceMocks.assistantEnabled = []
    sourceMocks.agentEnabled = []
    sourceMocks.assistantSource = {
      stats: { total: 2, pinnedCount: 0, byAssistant: [] },
      isStatsLoading: false,
      statsError: undefined,
      refetchStats: vi.fn(),
      loadLatestTopic: vi.fn(),
      loadReusableTopic: vi.fn()
    }
    sourceMocks.agentSource = {
      stats: { total: 3, pinnedCount: 0, byAgent: [], byWorkspace: [] },
      isStatsLoading: false,
      statsError: undefined,
      refetchStats: vi.fn(),
      loadSession: vi.fn(),
      loadLatestSession: vi.fn(),
      loadReusableSessions: vi.fn()
    }
  })

  it('publishes the lightweight resource facts through context', () => {
    render(
      <ResourceViewSourceProvider>
        <SourceProbe />
      </ResourceViewSourceProvider>
    )

    expect(screen.getByTestId('topic-count')).toHaveTextContent('2')
    expect(screen.getByTestId('session-count')).toHaveTextContent('3')
  })

  it('loads only the source owned by the active non-dormant, non-message-only route tab', () => {
    sourceMocks.tabs = [
      createTab('chat-message', '/app/chat?topicId=topic-1&view=message'),
      createTab('agent-dormant', '/app/agents?sessionId=session-1', true),
      createTab('chat', '/app/chat?topicId=topic-2')
    ]
    sourceMocks.activeTabId = 'chat'

    render(
      <ResourceViewSourceProvider>
        <SourceProbe />
      </ResourceViewSourceProvider>
    )

    expect(sourceMocks.assistantEnabled.at(-1)).toBe(true)
    expect(sourceMocks.agentEnabled.at(-1)).toBe(false)
    expect(
      shouldLoadResourceViewSource([createTab('message', '/app/chat?view=message')], 'message', 'assistants')
    ).toBe(false)
  })
})
