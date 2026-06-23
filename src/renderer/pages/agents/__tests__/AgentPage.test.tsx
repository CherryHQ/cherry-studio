import { WindowFrameProvider } from '@renderer/components/chat/shell/WindowFrameContext'
import { useCommandHandler } from '@renderer/hooks/command'
import { AGENT_WORKSPACE_TYPE } from '@shared/data/api/schemas/agentWorkspaces'
import { MIN_WINDOW_HEIGHT, SECOND_MIN_WINDOW_WIDTH } from '@shared/utils/window'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const agentPageMocks = vi.hoisted(() => ({
  workspace: {
    id: 'workspace-a',
    name: 'Workspace A',
    path: '/workspace/a',
    type: 'user',
    orderKey: 'a0',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  },
  workspaceNext: {
    id: 'workspace-next',
    name: 'Workspace Next',
    path: '/workspace/next',
    type: 'user',
    orderKey: 'a1',
    createdAt: '2026-01-02T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z'
  },
  persistedSession: {
    id: 'session-created',
    agentId: 'agent-a',
    name: 'hello',
    description: '',
    workspaceId: 'workspace-a',
    workspace: {
      id: 'workspace-a',
      name: 'Workspace A',
      path: '/workspace/a',
      type: 'user',
      orderKey: 'a0',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    },
    orderKey: 'p0',
    createdAt: '2026-01-03T00:00:00.000Z',
    updatedAt: '2026-01-03T00:00:00.000Z'
  },
  agents: [{ id: 'agent-a', model: 'model-a', name: 'Agent A' }],
  currentTab: undefined as { metadata?: Record<string, unknown> } | undefined,
  lastUsedAgentId: null as string | null,
  lastUsedSessionId: null as string | null,
  lastUsedWorkspaceId: null as string | null,
  focusExistingTab: vi.fn(() => false),
  activeSessionOptions: null as {
    activeSessionId: string | null
    setActiveSessionId: (id: string | null) => void
  } | null,
  setLastUsedAgentId: vi.fn(),
  setLastUsedSessionId: vi.fn(),
  setLastUsedWorkspaceId: vi.fn(),
  setShowSidebar: vi.fn(),
  isActiveTab: false,
  showSidebar: false,
  routeSearch: { sessionId: 'session-initial' } as Record<string, unknown>,
  dataApiGet: vi.fn(),
  dataApiPost: vi.fn(),
  invalidateCache: vi.fn()
}))

const activeSessionMocks = vi.hoisted(() => ({
  session: null as any,
  isLoading: false,
  sessionSource: 'none' as 'query' | 'pending' | 'none'
}))

vi.mock('@data/DataApiService', () => ({
  dataApiService: {
    get: agentPageMocks.dataApiGet,
    post: agentPageMocks.dataApiPost
  }
}))

vi.mock('@renderer/hooks/command', () => ({
  useCommandHandler: vi.fn()
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

vi.mock('@renderer/data/hooks/useCache', async () => {
  const React = await import('react')

  return {
    useSharedCache: () => [null, vi.fn()],
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
      ) {
        return [undefined, vi.fn()]
      }

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
  }) => {
    agentPageMocks.activeSessionOptions = {
      activeSessionId: options.activeSessionId,
      setActiveSessionId: options.setActiveSessionId
    }
    return {
      session: activeSessionMocks.session ?? options.pendingSession ?? undefined,
      isLoading: activeSessionMocks.isLoading,
      sessionSource: activeSessionMocks.session
        ? activeSessionMocks.sessionSource
        : options.pendingSession
          ? 'pending'
          : 'none',
      activeSessionId: options.activeSessionId,
      setActiveSessionId: options.setActiveSessionId
    }
  }
}))

vi.mock('@renderer/data/hooks/useDataApi', () => ({
  useInvalidateCache: () => agentPageMocks.invalidateCache
}))

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => agentPageMocks.routeSearch
}))

vi.mock('@renderer/hooks/useConversationNavigation', () => ({
  useConversationNavigation: () => ({
    focusExistingTab: agentPageMocks.focusExistingTab,
    openConversationTab: vi.fn()
  })
}))

vi.mock('@renderer/context/TabIdContext', () => ({
  useCurrentTab: () => agentPageMocks.currentTab,
  useCurrentTabId: () => 'agent-tab',
  useIsActiveTab: () => agentPageMocks.isActiveTab,
  useTabSelfMetadata: vi.fn()
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
    draftConversation,
    missingAgentDraft,
    onEnsurePersistentSession,
    onMissingAgentDraftAgentChange,
    onStartDraftSession,
    onVisibleAgentChange,
    onVisibleWorkspaceChange,
    onDraftAgentChange,
    onDraftWorkspaceChange,
    locateMessageId,
    pane,
    paneOpen,
    showResourceListControls,
    onPaneCollapse
  }: {
    activeSession?: { id: string } | null
    activeSessionLoading?: boolean
    draftConversation?: {
      agentId: string
      workspaceSource: { type: string; workspaceId?: string }
      workspace?: { id?: string; type: string }
    } | null
    missingAgentDraft?: boolean
    onEnsurePersistentSession?: (initialName?: string) => Promise<unknown>
    onMissingAgentDraftAgentChange?: (agentId: string | null) => void | Promise<void>
    onStartDraftSession?: (defaults: {
      agentId: string
      workspaceId?: string
      workspaceMode?: 'user' | 'system'
    }) => void | Promise<void>
    onVisibleAgentChange?: (agentId: string) => void
    onVisibleWorkspaceChange?: (workspaceId: string) => void
    onDraftAgentChange?: (agentId: string | null) => void | Promise<void>
    onDraftWorkspaceChange?: (workspaceId: string | null) => void | Promise<void>
    locateMessageId?: string
    pane?: ReactNode
    paneOpen?: boolean
    showResourceListControls?: boolean
    onPaneCollapse?: () => void
  }) => (
    <section>
      <output data-testid="active-session">{activeSession?.id ?? ''}</output>
      <output data-testid="active-session-loading">{String(Boolean(activeSessionLoading))}</output>
      <output data-testid="draft-session">{draftConversation?.agentId ?? ''}</output>
      <output data-testid="draft-workspace">
        {draftConversation?.workspaceSource.type === 'user' ? draftConversation.workspaceSource.workspaceId : ''}
      </output>
      <output data-testid="missing-agent-draft">{String(Boolean(missingAgentDraft))}</output>
      <output data-testid="locate-message-id">{locateMessageId ?? ''}</output>
      <output data-testid="pane-open">{String(paneOpen)}</output>
      <output data-testid="show-resource-list-controls">{String(showResourceListControls)}</output>
      <button type="button" onClick={() => void onDraftWorkspaceChange?.('workspace-next')}>
        Select workspace
      </button>
      <button type="button" onClick={() => void onDraftWorkspaceChange?.(null)}>
        Select no project
      </button>
      <button type="button" onClick={() => void onStartDraftSession?.({ agentId: 'agent-a' })}>
        Start draft session
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
      <button type="button" onClick={() => void onDraftAgentChange?.('agent-created')}>
        Select newly created draft agent
      </button>
      <button type="button" onClick={() => void onEnsurePersistentSession?.('hello')}>
        Persist draft session
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
  default: ({
    activeSessionId,
    onStartDraftSession,
    onStartMissingAgentDraft,
    revealRequest,
    setActiveSessionId
  }: any) => {
    return (
      <div
        data-active-session-id={activeSessionId ?? ''}
        data-reveal-request={JSON.stringify(revealRequest ?? null)}
        data-testid="agent-side-panel">
        <button
          type="button"
          onClick={() =>
            setActiveSessionId?.('session-next', {
              id: 'session-next',
              agentId: 'agent-a',
              name: 'Session Next',
              description: '',
              workspaceId: agentPageMocks.workspace.id,
              workspace: agentPageMocks.workspace,
              orderKey: 'next',
              createdAt: '2026-01-02T00:00:00.000Z',
              updatedAt: '2026-01-02T00:00:00.000Z'
            })
          }>
          Select session next
        </button>
        <button type="button" onClick={() => onStartMissingAgentDraft?.()}>
          Start missing agent draft
        </button>
        <button
          type="button"
          onClick={() =>
            onStartDraftSession?.({ agentId: 'agent-a', workspace: { type: AGENT_WORKSPACE_TYPE.SYSTEM } })
          }>
          Start panel draft
        </button>
      </div>
    )
  }
}))

import { useTabSelfMetadata } from '@renderer/context/TabIdContext'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'

import AgentPage from '../AgentPage'

describe('AgentPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    agentPageMocks.routeSearch = { sessionId: 'session-initial' }
    agentPageMocks.agents = [{ id: 'agent-a', model: 'model-a', name: 'Agent A' }]
    agentPageMocks.currentTab = undefined
    agentPageMocks.lastUsedAgentId = null
    agentPageMocks.lastUsedWorkspaceId = null
    agentPageMocks.activeSessionOptions = null
    agentPageMocks.focusExistingTab.mockReturnValue(false)
    agentPageMocks.showSidebar = false
    agentPageMocks.isActiveTab = false
    agentPageMocks.dataApiGet.mockImplementation(async (path: string) => {
      if (path === '/agent-workspaces/workspace-next') return agentPageMocks.workspaceNext
      if (path === '/agent-workspaces/workspace-remembered') {
        return { ...agentPageMocks.workspaceNext, id: 'workspace-remembered' }
      }
      return agentPageMocks.workspace
    })
    agentPageMocks.dataApiPost.mockResolvedValue(agentPageMocks.persistedSession)
    agentPageMocks.invalidateCache.mockResolvedValue(undefined)
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

  it('uses tab metadata as the session entry when the URL is the agents route', () => {
    agentPageMocks.routeSearch = {}
    agentPageMocks.currentTab = { metadata: { instanceAppId: 'agents', instanceKey: 'session-from-metadata' } }

    render(<AgentPage />)

    expect(agentPageMocks.activeSessionOptions?.activeSessionId).toBe('session-from-metadata')
  })

  it('keeps the draft when clearing the tab metadata after starting a new task', async () => {
    agentPageMocks.routeSearch = {}
    agentPageMocks.currentTab = { metadata: { instanceAppId: 'agents', instanceKey: 'session-from-metadata' } }

    const { rerender } = render(<AgentPage />)

    expect(agentPageMocks.activeSessionOptions?.activeSessionId).toBe('session-from-metadata')

    fireEvent.click(screen.getByRole('button', { name: 'Start panel draft' }))

    await waitFor(() => expect(screen.getByTestId('draft-session')).toHaveTextContent('agent-a'))
    expect(agentPageMocks.activeSessionOptions?.activeSessionId).toBeNull()

    agentPageMocks.currentTab = { metadata: { instanceAppId: 'agents' } }
    rerender(<AgentPage />)
    await act(async () => {
      await Promise.resolve()
    })

    expect(screen.getByTestId('draft-session')).toHaveTextContent('agent-a')
    expect(agentPageMocks.activeSessionOptions?.activeSessionId).toBeNull()
  })

  it('keeps the metadata session key while the entry session is loading', () => {
    agentPageMocks.routeSearch = {}
    agentPageMocks.currentTab = { metadata: { instanceAppId: 'agents', instanceKey: 'session-from-metadata' } }
    activeSessionMocks.isLoading = true

    render(<AgentPage />)

    expect(agentPageMocks.activeSessionOptions?.activeSessionId).toBe('session-from-metadata')
    expect(vi.mocked(useTabSelfMetadata)).toHaveBeenLastCalledWith(
      expect.objectContaining({
        instanceAppId: 'agents',
        instanceKey: 'session-from-metadata'
      })
    )
  })

  it('updates the controlled session selection when the active session changes inside the tab', async () => {
    render(<AgentPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Select session next' }))

    await waitFor(() => expect(agentPageMocks.activeSessionOptions?.activeSessionId).toBe('session-next'))
    expect(screen.getByTestId('agent-side-panel')).toHaveAttribute('data-active-session-id', 'session-next')
  })

  it('does not mutate the current tab before focusing an already-open global-search session', () => {
    agentPageMocks.focusExistingTab.mockReturnValue(true)

    render(<AgentPage />)

    const sessionMessageHandler = vi
      .mocked(EventEmitter.on)
      .mock.calls.find(([eventName]) => eventName === EVENT_NAMES.GLOBAL_SEARCH_SELECT_AGENT_SESSION_MESSAGE)?.[1] as
      | ((payload: unknown) => void)
      | undefined

    act(() => {
      sessionMessageHandler?.({ sessionId: 'session-open', messageId: 'message-open' })
    })

    expect(agentPageMocks.focusExistingTab).toHaveBeenCalledWith('session-open', { excludeTabId: 'agent-tab' })
    expect(agentPageMocks.setShowSidebar).not.toHaveBeenCalled()
    expect(screen.getByTestId('locate-message-id')).toHaveTextContent('')
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

  it('removes the session sidebar entirely in a detached agent window, shortcut included', () => {
    agentPageMocks.showSidebar = true

    render(
      <WindowFrameProvider value={{ mode: 'window' }}>
        <AgentPage />
      </WindowFrameProvider>
    )

    expect(screen.getByTestId('pane-open')).toHaveTextContent('false')
    // Detached windows show no sidebar toggle / new-session button in the navbar.
    expect(screen.getByTestId('show-resource-list-controls')).toHaveTextContent('false')

    const shortcutHandler = vi
      .mocked(useCommandHandler)
      .mock.calls.find(([command]) => command === 'app.sidebar.toggle')?.[1]

    act(() => {
      void shortcutHandler?.()
    })

    // The sidebar-toggle shortcut is inert in a detached window — the pane stays closed.
    expect(screen.getByTestId('pane-open')).toHaveTextContent('false')
    expect(agentPageMocks.setShowSidebar).not.toHaveBeenCalled()
  })

  it('uses the compact minimum window width even while the agent sidebar is open', async () => {
    agentPageMocks.showSidebar = true

    render(<AgentPage />)

    await waitFor(() => {
      expect(window.api.window.setMinimumSize).toHaveBeenCalledWith(SECOND_MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT)
    })
  })

  it('shows the missing-agent home composer by default when there are no agents', async () => {
    agentPageMocks.routeSearch = {}
    agentPageMocks.agents = []

    render(<AgentPage />)

    expect(screen.getByTestId('active-session')).toHaveTextContent('')
    await waitFor(() => expect(screen.getByTestId('missing-agent-draft')).toHaveTextContent('true'))
    expect(screen.getByTestId('agent-side-panel')).toBeInTheDocument()
    expect(agentPageMocks.dataApiPost).not.toHaveBeenCalled()
  })

  it('starts a renderer-only missing-agent draft after selecting an agent', async () => {
    agentPageMocks.routeSearch = {}
    agentPageMocks.agents = []

    const { rerender } = render(<AgentPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Start missing agent draft' }))

    expect(screen.getByTestId('missing-agent-draft')).toHaveTextContent('true')
    expect(agentPageMocks.dataApiPost).not.toHaveBeenCalled()

    agentPageMocks.agents = [{ id: 'agent-b', model: 'model-b', name: 'Agent B' }]
    rerender(<AgentPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Select missing draft agent' }))

    await waitFor(() => expect(screen.getByTestId('draft-session')).toHaveTextContent('agent-b'))
    expect(agentPageMocks.activeSessionOptions?.activeSessionId).toBeNull()
  })

  it('keeps the previous visible session metadata while the selected session is loading', async () => {
    agentPageMocks.routeSearch = { sessionId: 'session-1' }
    activeSessionMocks.session = {
      id: 'session-1',
      agentId: 'agent-a',
      name: 'Session 1',
      workspaceId: agentPageMocks.workspace.id,
      workspace: agentPageMocks.workspace
    }
    activeSessionMocks.sessionSource = 'query'

    const { rerender } = render(<AgentPage />)

    expect(screen.getByTestId('active-session')).toHaveTextContent('session-1')
    expect(vi.mocked(useTabSelfMetadata)).toHaveBeenLastCalledWith(
      expect.objectContaining({ instanceAppId: 'agents', instanceKey: 'session-1' })
    )

    agentPageMocks.routeSearch = { sessionId: 'session-2' }
    activeSessionMocks.session = null
    activeSessionMocks.isLoading = true
    rerender(<AgentPage />)

    await waitFor(() => expect(agentPageMocks.activeSessionOptions?.activeSessionId).toBe('session-2'))
    expect(screen.getByTestId('active-session')).toHaveTextContent('session-1')
    expect(screen.getByTestId('active-session-loading')).toHaveTextContent('true')
    expect(vi.mocked(useTabSelfMetadata)).toHaveBeenLastCalledWith(
      expect.objectContaining({ instanceAppId: 'agents', instanceKey: 'session-1' })
    )

    activeSessionMocks.session = {
      id: 'session-2',
      agentId: 'agent-a',
      name: 'Session 2',
      workspaceId: agentPageMocks.workspace.id,
      workspace: agentPageMocks.workspace
    }
    activeSessionMocks.isLoading = false
    rerender(<AgentPage />)

    expect(screen.getByTestId('active-session')).toHaveTextContent('session-2')
    expect(screen.getByTestId('active-session-loading')).toHaveTextContent('false')
    expect(vi.mocked(useTabSelfMetadata)).toHaveBeenLastCalledWith(
      expect.objectContaining({ instanceAppId: 'agents', instanceKey: 'session-2' })
    )
  })

  it('starts a first-launch draft session with the remembered agent and workspace', async () => {
    agentPageMocks.routeSearch = {}
    agentPageMocks.agents = [
      { id: 'agent-a', model: 'model-a', name: 'Agent A' },
      { id: 'agent-b', model: 'model-b', name: 'Agent B' }
    ]
    agentPageMocks.lastUsedAgentId = 'agent-b'
    agentPageMocks.lastUsedWorkspaceId = 'workspace-remembered'

    render(<AgentPage />)

    await waitFor(() => expect(screen.getByTestId('draft-session')).toHaveTextContent('agent-b'))
    expect(agentPageMocks.dataApiGet).toHaveBeenCalledWith('/agent-workspaces/workspace-remembered')
    expect(screen.getByTestId('draft-workspace')).toHaveTextContent('workspace-remembered')
    expect(agentPageMocks.activeSessionOptions?.activeSessionId).toBeNull()
  })

  it('rebuilds the draft session when the draft workspace changes', async () => {
    agentPageMocks.routeSearch = {}

    render(<AgentPage />)

    await waitFor(() => expect(screen.getByTestId('draft-session')).toHaveTextContent('agent-a'))
    fireEvent.click(screen.getByRole('button', { name: 'Select workspace' }))

    await waitFor(() => expect(agentPageMocks.dataApiGet).toHaveBeenCalledWith('/agent-workspaces/workspace-next'))
    expect(screen.getByTestId('draft-workspace')).toHaveTextContent('workspace-next')
    expect(agentPageMocks.setLastUsedWorkspaceId).toHaveBeenCalledWith('workspace-next')
  })

  it('persists the draft session only when the first message is sent', async () => {
    agentPageMocks.routeSearch = {}

    render(<AgentPage />)

    await waitFor(() => expect(screen.getByTestId('draft-session')).toHaveTextContent('agent-a'))
    expect(agentPageMocks.dataApiPost).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Persist draft session' }))

    await waitFor(() =>
      expect(agentPageMocks.dataApiPost).toHaveBeenCalledWith('/agent-sessions', {
        body: {
          agentId: 'agent-a',
          name: 'hello',
          workspace: { type: AGENT_WORKSPACE_TYPE.SYSTEM }
        }
      })
    )
    await waitFor(() => expect(agentPageMocks.activeSessionOptions?.activeSessionId).toBe('session-created'))
    expect(screen.getByTestId('active-session')).toHaveTextContent('session-created')
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
