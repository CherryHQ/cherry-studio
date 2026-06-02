import { MIN_WINDOW_HEIGHT, SECOND_MIN_WINDOW_WIDTH } from '@shared/config/constant'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const agentPageMocks = vi.hoisted(() => ({
  activeSessionId: 'session-initial' as string | null,
  agents: [{ id: 'agent-a', model: 'model-a', name: 'Agent A' }],
  lastUsedAgentId: null as string | null,
  lastUsedSessionId: null as string | null,
  lastUsedWorkspaceId: null as string | null,
  navigate: vi.fn(),
  setActiveSessionId: vi.fn(),
  setLastUsedAgentId: vi.fn(),
  setLastUsedSessionId: vi.fn(),
  setLastUsedWorkspaceId: vi.fn(),
  setShowSidebar: vi.fn(),
  isActiveTab: false,
  showSidebar: false
}))

const temporaryConversationMocks = vi.hoisted(() => ({
  conversation: null as any,
  persistedConversation: null as any,
  start: vi.fn(),
  replace: vi.fn(),
  persist: vi.fn(),
  discard: vi.fn()
}))

const activeSessionMocks = vi.hoisted(() => ({
  session: null as any,
  isLoading: false,
  sessionSource: 'none' as 'query' | 'pending' | 'none'
}))

vi.mock('@data/hooks/usePreference', async () => {
  const React = await import('react')

  return {
    usePreference: (key: string) => {
      const [value, setValue] = React.useState<unknown>(
        key === 'topic.tab.show' ? agentPageMocks.showSidebar : undefined
      )
      const setPreference = vi.fn(async (nextValue: unknown) => {
        if (key === 'topic.tab.show') {
          agentPageMocks.showSidebar = Boolean(nextValue)
          agentPageMocks.setShowSidebar(nextValue)
        }
        setValue(nextValue)
      })

      return [value, setPreference]
    }
  }
})

vi.mock('@renderer/components/app/Navbar', () => ({
  Navbar: ({ children }: { children?: ReactNode }) => <nav>{children}</nav>,
  NavbarCenter: ({ children }: { children?: ReactNode }) => <div>{children}</div>
}))

vi.mock('@renderer/data/hooks/useCache', async () => {
  const React = await import('react')

  return {
    usePersistCache: (key: string) => {
      const initialValue =
        key === 'ui.agent.last_used_agent_id'
          ? agentPageMocks.lastUsedAgentId
          : key === 'ui.agent.last_used_session_id'
            ? agentPageMocks.lastUsedSessionId
            : key === 'ui.agent.last_used_workspace_id'
              ? agentPageMocks.lastUsedWorkspaceId
              : undefined
      const [value, setValue] = React.useState(initialValue)
      if (
        key !== 'ui.agent.last_used_agent_id' &&
        key !== 'ui.agent.last_used_session_id' &&
        key !== 'ui.agent.last_used_workspace_id'
      )
        return [undefined, vi.fn()]

      const setCache = vi.fn((nextValue: string | null) => {
        if (key === 'ui.agent.last_used_agent_id') {
          agentPageMocks.lastUsedAgentId = nextValue
          agentPageMocks.setLastUsedAgentId(nextValue)
        } else if (key === 'ui.agent.last_used_session_id') {
          agentPageMocks.lastUsedSessionId = nextValue
          agentPageMocks.setLastUsedSessionId(nextValue)
        } else {
          agentPageMocks.lastUsedWorkspaceId = nextValue
          agentPageMocks.setLastUsedWorkspaceId(nextValue)
        }
        setValue(nextValue)
      })

      return [value, setCache]
    }
  }
})

vi.mock('@renderer/hooks/agents/useAgent', () => ({
  useAgents: () => ({
    agents: agentPageMocks.agents,
    isLoading: false
  }),
  useAgent: (id: string | null) => ({
    agent: id ? agentPageMocks.agents.find((a) => a.id === id) : undefined
  })
}))

vi.mock('@renderer/hooks/agents/useSession', () => ({
  useSession: () => ({
    session: undefined,
    isLoading: false
  }),
  useActiveSession: (options: {
    activeSessionId: string | null
    setActiveSessionId: (id: string | null) => void
    pendingSession?: any
  }) => ({
    session: activeSessionMocks.session ?? options?.pendingSession ?? undefined,
    isLoading: activeSessionMocks.isLoading,
    sessionSource: activeSessionMocks.session
      ? activeSessionMocks.sessionSource
      : options?.pendingSession
        ? 'pending'
        : 'none',
    activeSessionId: options.activeSessionId,
    setActiveSessionId: options.setActiveSessionId
  })
}))

vi.mock('@renderer/data/hooks/useDataApi', () => ({
  useInvalidateCache: () => vi.fn().mockResolvedValue(undefined)
}))

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => (agentPageMocks.activeSessionId ? { sessionId: agentPageMocks.activeSessionId } : {}),
  useNavigate: () => (args: { search?: ((prev: any) => any) | Record<string, unknown> }) => {
    const next =
      typeof args.search === 'function'
        ? args.search({ sessionId: agentPageMocks.activeSessionId ?? undefined })
        : (args.search ?? {})
    const nextSessionId = (next as { sessionId?: string | null }).sessionId ?? null
    agentPageMocks.activeSessionId = nextSessionId
    agentPageMocks.setActiveSessionId(nextSessionId)
    agentPageMocks.navigate(args)
  }
}))

vi.mock('@renderer/hooks/useTemporaryConversation', () => ({
  useTemporaryConversation: () => ({
    conversation: temporaryConversationMocks.conversation,
    persistedConversation: temporaryConversationMocks.persistedConversation,
    start: temporaryConversationMocks.start,
    replace: temporaryConversationMocks.replace,
    persist: temporaryConversationMocks.persist,
    discard: temporaryConversationMocks.discard
  })
}))

vi.mock('@renderer/context/TabIdContext', () => ({
  useCurrentTabId: () => 'agent-tab',
  useIsActiveTab: () => agentPageMocks.isActiveTab,
  useTabSelfMetadata: vi.fn()
}))

vi.mock('@renderer/pages/history/HistoryRecordsPage', () => ({
  default: ({ onClose, onRecordSelect, open }: any) =>
    open ? (
      <button
        type="button"
        onClick={() => {
          onRecordSelect?.('session-history')
          onClose?.()
        }}>
        Select history session
      </button>
    ) : null
}))

vi.mock('@renderer/services/EventService', () => ({
  EVENT_NAMES: {
    GLOBAL_SEARCH_SELECT_AGENT_SESSION: 'GLOBAL_SEARCH_SELECT_AGENT_SESSION',
    GLOBAL_SEARCH_SELECT_AGENT_SESSION_MESSAGE: 'GLOBAL_SEARCH_SELECT_AGENT_SESSION_MESSAGE',
    SHOW_ASSISTANTS: 'SHOW_ASSISTANTS',
    REVEAL_ACTIVE_RESOURCE_LIST: 'REVEAL_ACTIVE_RESOURCE_LIST'
  },
  EventEmitter: {
    emit: vi.fn(),
    on: vi.fn(() => vi.fn())
  }
}))

vi.mock('react-i18next', () => ({
  initReactI18next: {
    init: vi.fn(),
    type: '3rdParty'
  },
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

vi.mock('../AgentChat', () => ({
  default: ({
    activeSession,
    activeSessionLoading,
    missingAgentDraft,
    onMissingAgentDraftAgentChange,
    onStartTemporarySession,
    onVisibleAgentChange,
    onVisibleWorkspaceChange,
    onDraftWorkspaceChange,
    pane,
    paneOpen,
    onPaneCollapse
  }: {
    activeSession?: { id: string } | null
    activeSessionLoading?: boolean
    missingAgentDraft?: boolean
    onMissingAgentDraftAgentChange?: (agentId: string | null) => void | Promise<void>
    onStartTemporarySession?: (defaults: {
      agentId: string
      workspaceId?: string
      workspaceMode?: 'user' | 'system'
      name?: string
    }) => void | Promise<void>
    onVisibleAgentChange?: (agentId: string) => void
    onVisibleWorkspaceChange?: (workspaceId: string) => void
    onDraftWorkspaceChange?: (workspaceId: string | null) => void | Promise<void>
    pane?: ReactNode
    paneOpen?: boolean
    onPaneCollapse?: () => void
  }) => (
    <section>
      <output data-testid="active-session">{activeSession?.id ?? ''}</output>
      <output data-testid="active-session-loading">{String(Boolean(activeSessionLoading))}</output>
      <output data-testid="missing-agent-draft">{String(Boolean(missingAgentDraft))}</output>
      <output data-testid="pane-open">{String(paneOpen)}</output>
      <button type="button" onClick={() => void onDraftWorkspaceChange?.('workspace-next')}>
        Select workspace
      </button>
      <button type="button" onClick={() => void onDraftWorkspaceChange?.(null)}>
        Select no project
      </button>
      <button type="button" onClick={() => void onStartTemporarySession?.({ agentId: 'agent-a' })}>
        Start temporary session
      </button>
      <button type="button" onClick={() => void onMissingAgentDraftAgentChange?.('agent-b')}>
        Select missing draft agent
      </button>
      <button type="button" onClick={() => onVisibleAgentChange?.('agent-visible')}>
        Show visible agent
      </button>
      <button type="button" onClick={() => onVisibleWorkspaceChange?.('workspace-visible')}>
        Show visible workspace
      </button>
      {onPaneCollapse && (
        <button type="button" onClick={onPaneCollapse}>
          Collapse pane
        </button>
      )}
      {pane}
    </section>
  )
}))

vi.mock('../AgentSidePanel', () => ({
  default: ({ onOpenHistory, onStartMissingAgentDraft, revealRequest }: any) => (
    <div data-reveal-request={JSON.stringify(revealRequest ?? null)} data-testid="agent-side-panel">
      <button type="button" onClick={() => onOpenHistory?.()}>
        Open agent history
      </button>
      <button type="button" onClick={() => onStartMissingAgentDraft?.()}>
        Start missing agent draft
      </button>
    </div>
  )
}))

import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'

import AgentPage from '../AgentPage'

describe('AgentPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    agentPageMocks.activeSessionId = 'session-initial'
    agentPageMocks.agents = [{ id: 'agent-a', model: 'model-a', name: 'Agent A' }]
    agentPageMocks.lastUsedAgentId = null
    agentPageMocks.lastUsedWorkspaceId = null
    agentPageMocks.showSidebar = false
    agentPageMocks.isActiveTab = false
    temporaryConversationMocks.conversation = null
    temporaryConversationMocks.persistedConversation = null
    temporaryConversationMocks.start.mockResolvedValue(null)
    activeSessionMocks.session = null
    activeSessionMocks.isLoading = false
    activeSessionMocks.sessionSource = 'none'

    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        window: {
          resetMinimumSize: vi.fn().mockResolvedValue(undefined),
          setMinimumSize: vi.fn().mockResolvedValue(undefined)
        }
      }
    })
  })

  it('opens the agent sidebar and forwards a reveal request after selecting a history session', async () => {
    render(<AgentPage />)

    expect(screen.getByTestId('pane-open')).toHaveTextContent('false')

    fireEvent.click(screen.getByRole('button', { name: 'Open agent history' }))
    fireEvent.click(screen.getByRole('button', { name: 'Select history session' }))

    await waitFor(() => expect(agentPageMocks.setActiveSessionId).toHaveBeenCalledWith('session-history'))

    expect(agentPageMocks.setShowSidebar).toHaveBeenCalledWith(true)
    expect(screen.getByTestId('pane-open')).toHaveTextContent('true')
    expect(JSON.parse(screen.getByTestId('agent-side-panel').getAttribute('data-reveal-request') ?? 'null')).toEqual({
      clearFilters: true,
      clearQuery: true,
      itemId: 'session-history',
      requestId: 1
    })
  })

  it('forwards a reveal request when navigation asks the current agent tab to reveal its selection', async () => {
    render(<AgentPage />)

    expect(JSON.parse(screen.getByTestId('agent-side-panel').getAttribute('data-reveal-request') ?? 'null')).toBeNull()

    const revealHandler = vi
      .mocked(EventEmitter.on)
      .mock.calls.find(([eventName]) => eventName === EVENT_NAMES.REVEAL_ACTIVE_RESOURCE_LIST)?.[1] as
      | ((payload: unknown) => void)
      | undefined

    act(() => {
      revealHandler?.({ source: 'agents', tabId: 'agent-tab' })
    })

    expect(JSON.parse(screen.getByTestId('agent-side-panel').getAttribute('data-reveal-request') ?? 'null')).toEqual({
      itemId: 'session-initial',
      requestId: 1
    })

    await act(async () => {
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
    })

    expect(JSON.parse(screen.getByTestId('agent-side-panel').getAttribute('data-reveal-request') ?? 'null')).toBeNull()
  })

  it('collapses the agent sidebar when the shared shell requests it', async () => {
    agentPageMocks.showSidebar = true

    render(<AgentPage />)

    expect(screen.getByTestId('pane-open')).toHaveTextContent('true')

    fireEvent.click(screen.getByRole('button', { name: 'Collapse pane' }))

    await waitFor(() => expect(agentPageMocks.setShowSidebar).toHaveBeenCalledWith(false))
    expect(screen.getByTestId('pane-open')).toHaveTextContent('false')
  })

  it('uses the compact minimum window width even while the agent sidebar is open', async () => {
    agentPageMocks.showSidebar = true

    render(<AgentPage />)

    await waitFor(() => {
      expect(window.api.window.setMinimumSize).toHaveBeenCalledWith(SECOND_MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT)
    })
  })

  it('shows the missing-agent home composer by default when there are no agents', async () => {
    agentPageMocks.activeSessionId = null
    agentPageMocks.agents = []

    render(<AgentPage />)

    expect(screen.getByTestId('active-session')).toHaveTextContent('')
    await waitFor(() => expect(screen.getByTestId('missing-agent-draft')).toHaveTextContent('true'))
    expect(screen.getByTestId('agent-side-panel')).toBeInTheDocument()
    expect(temporaryConversationMocks.start).not.toHaveBeenCalled()
  })

  it('falls back to the missing-agent home composer when sidebar navigation opens a stale session id', async () => {
    agentPageMocks.activeSessionId = 'stale-session'
    agentPageMocks.agents = []

    render(<AgentPage />)

    await waitFor(() => expect(screen.getByTestId('missing-agent-draft')).toHaveTextContent('true'))
    expect(agentPageMocks.setActiveSessionId).toHaveBeenCalledWith(null)
    expect(temporaryConversationMocks.start).not.toHaveBeenCalled()
  })

  it('starts a renderer-only missing-agent draft and leases a temporary session only after selecting an agent', async () => {
    agentPageMocks.activeSessionId = null
    agentPageMocks.agents = []

    const { rerender } = render(<AgentPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Start missing agent draft' }))

    expect(screen.getByTestId('missing-agent-draft')).toHaveTextContent('true')
    expect(temporaryConversationMocks.start).not.toHaveBeenCalled()

    agentPageMocks.agents = [{ id: 'agent-b', model: 'model-b', name: 'Agent B' }]
    rerender(<AgentPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Select missing draft agent' }))

    await waitFor(() =>
      expect(temporaryConversationMocks.start).toHaveBeenCalledWith({
        agentId: 'agent-b',
        name: 'common.unnamed'
      })
    )
    expect(agentPageMocks.setActiveSessionId).toHaveBeenCalledWith(null)
  })

  it('keeps the previous visible session while the selected session is loading', () => {
    activeSessionMocks.session = {
      id: 'session-1',
      agentId: 'agent-a',
      name: 'Session 1',
      workspaceId: null,
      workspace: null
    }
    activeSessionMocks.sessionSource = 'query'

    const { rerender } = render(<AgentPage />)

    expect(screen.getByTestId('active-session')).toHaveTextContent('session-1')

    activeSessionMocks.session = null
    activeSessionMocks.isLoading = true
    rerender(<AgentPage />)

    expect(screen.getByTestId('active-session')).toHaveTextContent('session-1')
    expect(screen.getByTestId('active-session-loading')).toHaveTextContent('true')

    activeSessionMocks.session = {
      id: 'session-2',
      agentId: 'agent-a',
      name: 'Session 2',
      workspaceId: null,
      workspace: null
    }
    activeSessionMocks.isLoading = false
    rerender(<AgentPage />)

    expect(screen.getByTestId('active-session')).toHaveTextContent('session-2')
    expect(screen.getByTestId('active-session-loading')).toHaveTextContent('false')
  })

  it('replaces the temporary agent conversation when the draft workspace changes', async () => {
    agentPageMocks.activeSessionId = null
    temporaryConversationMocks.conversation = {
      type: 'agent',
      id: 'temporary-session',
      sessionId: 'temporary-session',
      topicId: 'agent-session:temporary-session',
      agentId: 'agent-a',
      name: 'Draft',
      session: {
        id: 'temporary-session',
        agentId: 'agent-a',
        name: 'Draft',
        description: '',
        workspaceId: 'workspace-current',
        workspace: {
          id: 'workspace-current',
          name: 'Current Workspace',
          path: '/workspace/current',
          type: 'user',
          orderKey: 'a0',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z'
        },
        orderKey: 'a0',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      }
    }
    temporaryConversationMocks.replace.mockResolvedValue({
      ...temporaryConversationMocks.conversation,
      session: {
        ...temporaryConversationMocks.conversation.session,
        workspaceId: 'workspace-next'
      }
    })

    render(<AgentPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Select workspace' }))

    await waitFor(() =>
      expect(temporaryConversationMocks.replace).toHaveBeenCalledWith({
        agentId: 'agent-a',
        workspaceId: 'workspace-next',
        name: 'Draft'
      })
    )
    expect(agentPageMocks.setActiveSessionId).toHaveBeenCalledWith(null)
    expect(agentPageMocks.setLastUsedWorkspaceId).toHaveBeenCalledWith('workspace-next')
  })

  it('replaces the temporary agent conversation with no-project mode', async () => {
    agentPageMocks.activeSessionId = null
    temporaryConversationMocks.conversation = {
      type: 'agent',
      id: 'temporary-session',
      sessionId: 'temporary-session',
      topicId: 'agent-session:temporary-session',
      agentId: 'agent-a',
      name: 'Draft',
      session: {
        id: 'temporary-session',
        agentId: 'agent-a',
        name: 'Draft',
        description: '',
        workspaceId: 'workspace-current',
        workspace: {
          id: 'workspace-current',
          name: 'Current Workspace',
          path: '/workspace/current',
          type: 'user',
          orderKey: 'a0',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z'
        },
        orderKey: 'a0',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      }
    }
    temporaryConversationMocks.replace.mockResolvedValue({
      ...temporaryConversationMocks.conversation,
      session: {
        ...temporaryConversationMocks.conversation.session,
        workspaceId: 'system-workspace',
        workspace: {
          id: 'system-workspace',
          name: 'No project',
          path: '/workspace/system',
          type: 'system',
          orderKey: 'a0',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z'
        }
      }
    })

    render(<AgentPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Select no project' }))

    await waitFor(() =>
      expect(temporaryConversationMocks.replace).toHaveBeenCalledWith({
        agentId: 'agent-a',
        workspaceMode: 'system',
        name: 'Draft'
      })
    )
    expect(agentPageMocks.setActiveSessionId).toHaveBeenCalledWith(null)
    expect(agentPageMocks.setLastUsedWorkspaceId).not.toHaveBeenCalled()
  })

  it('starts a first-launch temporary session with the remembered agent and workspace', async () => {
    agentPageMocks.activeSessionId = null
    agentPageMocks.agents = [
      { id: 'agent-a', model: 'model-a', name: 'Agent A' },
      { id: 'agent-b', model: 'model-b', name: 'Agent B' }
    ]
    agentPageMocks.lastUsedAgentId = 'agent-b'
    agentPageMocks.lastUsedWorkspaceId = 'workspace-remembered'

    render(<AgentPage />)

    await waitFor(() =>
      expect(temporaryConversationMocks.start).toHaveBeenCalledWith({
        agentId: 'agent-b',
        workspaceId: 'workspace-remembered',
        name: 'common.unnamed'
      })
    )
    expect(agentPageMocks.setActiveSessionId).toHaveBeenCalledWith(null)
  })

  it('restarts a same-agent temporary session when the remembered workspace differs', async () => {
    agentPageMocks.activeSessionId = null
    agentPageMocks.lastUsedWorkspaceId = 'workspace-remembered'
    temporaryConversationMocks.conversation = {
      type: 'agent',
      id: 'temporary-session',
      sessionId: 'temporary-session',
      topicId: 'agent-session:temporary-session',
      agentId: 'agent-a',
      name: 'Draft',
      session: {
        id: 'temporary-session',
        agentId: 'agent-a',
        name: 'Draft',
        description: '',
        workspaceId: null,
        workspace: null,
        orderKey: 'a0',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      }
    }
    temporaryConversationMocks.start.mockResolvedValue({
      ...temporaryConversationMocks.conversation,
      session: {
        ...temporaryConversationMocks.conversation.session,
        workspaceId: 'workspace-remembered'
      }
    })

    render(<AgentPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Start temporary session' }))

    await waitFor(() =>
      expect(temporaryConversationMocks.start).toHaveBeenCalledWith({
        agentId: 'agent-a',
        workspaceId: 'workspace-remembered',
        name: 'common.unnamed'
      })
    )
  })

  it('records the visible agent reported by the chat body', async () => {
    render(<AgentPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Show visible agent' }))

    await waitFor(() => expect(agentPageMocks.setLastUsedAgentId).toHaveBeenCalledWith('agent-visible'))
  })

  it('records the visible workspace reported by the chat body', async () => {
    render(<AgentPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Show visible workspace' }))

    await waitFor(() => expect(agentPageMocks.setLastUsedWorkspaceId).toHaveBeenCalledWith('workspace-visible'))
  })
})
