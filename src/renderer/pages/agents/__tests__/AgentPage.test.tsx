import { WindowFrameProvider } from '@renderer/components/chat/shell/WindowFrameContext'
import { useCommandHandler } from '@renderer/hooks/command'
import { AGENT_WORKSPACE_TYPE } from '@shared/data/api/schemas/agentWorkspaces'
import { DefaultPreferences } from '@shared/data/preference/preferenceSchemas'
import { MIN_WINDOW_HEIGHT, SECOND_MIN_WINDOW_WIDTH } from '@shared/utils/window'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
  agents: [{ id: 'agent-a', model: 'model-a', name: 'Agent A' }] as Array<{
    id: string
    model: string
    name: string
    configuration?: Record<string, unknown>
  }>,
  currentTab: undefined as { metadata?: Record<string, unknown> } | undefined,
  lastUsedAgentId: null as string | null,
  lastUsedSessionId: null as string | null,
  lastUsedWorkspaceId: null as string | null,
  classicLayoutRightPaneOpen: true,
  agentResourceListSessionsSource: undefined as unknown,
  agentSessionsSourceOptions: [] as Array<{ enabled?: boolean } | undefined>,
  agentSidePanelSessionsSource: undefined as unknown,
  activeSessionOptions: null as {
    activeSessionId: string | null
    setActiveSessionId: (id: string | null) => void
  } | null,
  pendingSession: null as any,
  setLastUsedAgentId: vi.fn(),
  setLastUsedSessionId: vi.fn(),
  setLastUsedWorkspaceId: vi.fn(),
  setSessionExpansionAgent: vi.fn(),
  setClassicLayoutRightPaneOpen: vi.fn(),
  setShowSidebar: vi.fn(),
  closeConversationTabs: vi.fn(),
  sessionDisplayMode: 'time' as 'time' | 'workdir' | 'agent',
  sessionPanePosition: 'right' as 'left' | 'right',
  isActiveTab: false,
  showSidebar: false,
  routeSearch: { sessionId: 'session-initial' } as Record<string, unknown>,
  dataApiGet: vi.fn(),
  dataApiPost: vi.fn(),
  dataApiDelete: vi.fn(),
  updateSession: vi.fn(),
  setSessionWorkspace: vi.fn(),
  invalidateCache: vi.fn(),
  createdAgentSessionsSource: undefined as unknown,
  rightPanelSessionsSource: undefined as unknown,
  classicLayoutSessions: [] as Array<{
    id: string
    agentId?: string
    name: string
    isNameManuallyEdited?: boolean
    createdAt?: string
    updatedAt: string
    workspaceId?: string
    workspace?: { type?: string }
  }>,
  sessionsFirstPageLoading: false,
  sessionsLoadingAll: false,
  sessionsFullyLoaded: true,
  isLatestSessionLoading: false,
  // `undefined` → derive the latest from `classicLayoutSessions`; `null` → none; a session → that exact
  // session (used to prove first-entry restore reads the dedicated latest query, not the paged list).
  latestSessionOverride: undefined as { id: string; updatedAt: string } | null | undefined,
  sessionExpansionAgent: [] as string[]
}))

const activeSessionMocks = vi.hoisted(() => ({
  session: null as any,
  isLoading: false,
  sessionSource: 'none' as 'query' | 'pending' | 'none'
}))

const ipcMocks = vi.hoisted(() => ({ request: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: ipcMocks.request }, useIpcOn: vi.fn() }))

vi.mock('@data/DataApiService', () => ({
  dataApiService: {
    delete: agentPageMocks.dataApiDelete,
    get: agentPageMocks.dataApiGet,
    post: agentPageMocks.dataApiPost
  }
}))

vi.mock('@renderer/hooks/resourceViewSources', () => ({
  useAgentSessionsSource: (options?: { enabled?: boolean }) => {
    const source = {
      sessions: options?.enabled === false ? [] : agentPageMocks.classicLayoutSessions,
      isFullyLoaded: agentPageMocks.sessionsFullyLoaded,
      isLoadingAll: agentPageMocks.sessionsLoadingAll,
      isLoading: agentPageMocks.sessionsFirstPageLoading,
      hasMore: false
    }
    agentPageMocks.agentSessionsSourceOptions.push(options)
    agentPageMocks.createdAgentSessionsSource = source
    return source
  }
}))

vi.mock('@renderer/hooks/command', () => ({
  useCommandHandler: vi.fn(),
  useResolvedCommand: () => ({
    enabled: true,
    execute: vi.fn(),
    label: 'Toggle sidebar',
    shortcutLabel: ''
  })
}))

vi.mock('@data/hooks/usePreference', async () => {
  const React = await import('react')

  return {
    usePreference: (key: string) => {
      const [value, setValue] = React.useState<unknown>(
        key === 'topic.tab.show'
          ? agentPageMocks.showSidebar
          : key === 'agent.session.display_mode'
            ? agentPageMocks.sessionDisplayMode
            : key === 'agent.session.position'
              ? agentPageMocks.sessionPanePosition
              : undefined
      )
      const setPreference = vi.fn(async (nextValue: unknown) => {
        if (key === 'topic.tab.show') {
          agentPageMocks.showSidebar = Boolean(nextValue)
          agentPageMocks.setShowSidebar(nextValue)
        } else if (key === 'agent.session.display_mode') {
          agentPageMocks.sessionDisplayMode = nextValue as 'time' | 'workdir' | 'agent'
        } else if (key === 'agent.session.position') {
          agentPageMocks.sessionPanePosition = nextValue as 'left' | 'right'
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
      const initialValue = (() => {
        switch (key) {
          case 'ui.agent.last_used_agent_id':
            return agentPageMocks.lastUsedAgentId
          case 'ui.agent.last_used_session_id':
            return agentPageMocks.lastUsedSessionId
          case 'ui.agent.last_used_workspace_id':
            return agentPageMocks.lastUsedWorkspaceId
          case 'ui.agent.right_pane_open':
            return agentPageMocks.classicLayoutRightPaneOpen
          case 'ui.agent.session.expansion.agent':
            return agentPageMocks.sessionExpansionAgent
          default:
            return undefined
        }
      })()
      const [value, setValue] = React.useState(initialValue)
      if (
        key !== 'ui.agent.last_used_agent_id' &&
        key !== 'ui.agent.last_used_session_id' &&
        key !== 'ui.agent.last_used_workspace_id' &&
        key !== 'ui.agent.right_pane_open' &&
        key !== 'ui.agent.session.expansion.agent'
      ) {
        return [undefined, vi.fn()]
      }

      const setCache = vi.fn((nextValue: string | boolean | string[] | null) => {
        if (key === 'ui.agent.last_used_agent_id') {
          agentPageMocks.lastUsedAgentId = nextValue as string | null
          agentPageMocks.setLastUsedAgentId(nextValue)
        } else if (key === 'ui.agent.last_used_session_id') {
          agentPageMocks.lastUsedSessionId = nextValue as string | null
          agentPageMocks.setLastUsedSessionId(nextValue)
        } else if (key === 'ui.agent.right_pane_open') {
          agentPageMocks.classicLayoutRightPaneOpen = nextValue as boolean
          agentPageMocks.setClassicLayoutRightPaneOpen(nextValue)
        } else if (key === 'ui.agent.session.expansion.agent') {
          agentPageMocks.sessionExpansionAgent = nextValue as string[]
          agentPageMocks.setSessionExpansionAgent(nextValue)
        } else {
          agentPageMocks.lastUsedWorkspaceId = nextValue as string | null
          agentPageMocks.setLastUsedWorkspaceId(nextValue)
        }
        setValue(nextValue)
      })

      return [value, setCache]
    }
  }
})

vi.mock('@renderer/hooks/agent/useAgent', () => ({
  useAgents: () => ({
    agents: agentPageMocks.agents,
    isLoading: false
  }),
  useAgent: (id: string | null) => ({
    agent: id ? agentPageMocks.agents.find((a) => a.id === id) : undefined
  })
}))

vi.mock('@renderer/hooks/agent/useSession', async () => {
  const { findLatestUpdated } = await import('@renderer/utils/resourceEntity')

  return {
    useSession: () => ({
      session: undefined,
      isLoading: false
    }),
    useLatestSession: (options?: { enabled?: boolean }) => {
      const derived = findLatestUpdated(agentPageMocks.classicLayoutSessions)
      const latest =
        agentPageMocks.latestSessionOverride === undefined
          ? derived
          : (agentPageMocks.latestSessionOverride ?? undefined)
      return {
        latestSession: options?.enabled === false ? undefined : latest,
        isLoading: agentPageMocks.isLatestSessionLoading
      }
    },
    useUpdateSession: () => ({
      updateSession: agentPageMocks.updateSession,
      setSessionWorkspace: agentPageMocks.setSessionWorkspace
    }),
    useActiveSession: (options: {
      activeSessionId: string | null
      setActiveSessionId: (id: string | null) => void
    }) => {
      agentPageMocks.activeSessionOptions = {
        activeSessionId: options.activeSessionId,
        setActiveSessionId: options.setActiveSessionId
      }
      // Mirror the real hook: it owns the pending session and writes the id back via setActiveSessionId.
      const selectSession = (sessionId: string | null, entity?: any) => {
        agentPageMocks.pendingSession = entity ?? null
        options.setActiveSessionId(sessionId)
      }
      const pendingSession =
        agentPageMocks.pendingSession && agentPageMocks.pendingSession.id === options.activeSessionId
          ? agentPageMocks.pendingSession
          : null
      return {
        session: pendingSession ?? activeSessionMocks.session ?? undefined,
        isLoading: activeSessionMocks.isLoading,
        sessionSource: pendingSession
          ? 'pending'
          : activeSessionMocks.session
            ? activeSessionMocks.sessionSource
            : 'none',
        activeSessionId: options.activeSessionId,
        setActiveSessionId: options.setActiveSessionId,
        pendingSession: agentPageMocks.pendingSession,
        selectSession,
        setActiveSession: (entity: any) => selectSession(entity.id, entity),
        clearActiveSession: () => selectSession(null, null),
        setPendingSession: (entity: any) => {
          agentPageMocks.pendingSession = entity ?? null
        }
      }
    }
  }
})

vi.mock('@renderer/data/hooks/useDataApi', () => ({
  useInvalidateCache: () => agentPageMocks.invalidateCache
}))

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => agentPageMocks.routeSearch
}))

vi.mock('@renderer/components/chat/shell/ConversationPageShell', () => ({
  default: ({
    center,
    pane,
    paneOpen,
    topBar
  }: {
    center?: { content?: ReactNode }
    pane?: ReactNode
    paneOpen?: boolean
    topBar?: ReactNode
  }) => (
    <section data-testid="agent-conversation-page-shell">
      <output data-testid="resource-pane-open">{String(paneOpen)}</output>
      {topBar}
      {pane}
      {center?.content}
    </section>
  )
}))

vi.mock('@renderer/components/chat/shell/ConversationShell', () => ({
  default: ({ center, pane }: { center?: ReactNode; pane?: ReactNode }) => (
    <section data-testid="agent-conversation-shell">
      {pane}
      {center}
    </section>
  )
}))

vi.mock('@renderer/components/resourceCatalog/catalog', () => ({
  ResourceCatalogView: ({
    resourceType,
    skillAgentId,
    toolbarLeading
  }: {
    resourceType: string
    skillAgentId?: string
    toolbarLeading?: ReactNode
  }) => (
    <div data-skill-agent-id={skillAgentId ?? ''} data-testid={`resource-catalog-${resourceType}`}>
      {toolbarLeading && <div data-testid="resource-toolbar-leading">{toolbarLeading}</div>}
    </div>
  )
}))

vi.mock('@renderer/hooks/tab', () => ({
  useCloseConversationTabs: () => agentPageMocks.closeConversationTabs,
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
    t: (key: string) =>
      ({
        'agent.manage.title': '管理智能体',
        'agent.session.list.title': '任务'
      })[key] ?? key
  })
}))

vi.mock('../AgentChat', () => ({
  default: ({
    activeSession,
    activeSessionLoading,
    missingAgentSelection,
    onCreateEmptySession,
    onMissingAgentSelectionAgentChange,
    onVisibleAgentChange,
    onVisibleWorkspaceChange,
    onSessionWorkspaceChange,
    locateMessageId,
    pane,
    paneOpen,
    panePosition,
    resourcePaneCount,
    resourcePane,
    showResourceListControls,
    onSidebarToggle,
    sessionPaneOpen,
    onSessionPaneOpenChange,
    onPaneCollapse,
    onPaneAutoCollapseChange
  }: {
    activeSession?: { id: string } | null
    activeSessionLoading?: boolean
    missingAgentSelection?: boolean
    onCreateEmptySession?: (defaults?: {
      agentId?: string | null
      workspace?: { type: string; workspaceId?: string }
    }) => void | Promise<unknown>
    onMissingAgentSelectionAgentChange?: (agentId: string | null) => void | Promise<void>
    onVisibleAgentChange?: (agentId: string) => void
    onVisibleWorkspaceChange?: (workspaceId: string) => void
    onSessionWorkspaceChange?: (workspaceId: string | null) => void | Promise<void>
    locateMessageId?: string
    pane?: ReactNode
    paneOpen?: boolean
    panePosition?: string
    resourcePaneCount?: { label: string; count: number }
    resourcePane?: { node?: ReactNode; label?: string } | null
    showResourceListControls?: boolean
    onSidebarToggle?: () => void
    sessionPaneOpen?: boolean
    onSessionPaneOpenChange?: (open: boolean) => void
    onPaneCollapse?: () => void
    onPaneAutoCollapseChange?: (collapsed: boolean) => void
  }) => (
    <section data-testid="agent-chat">
      <output data-testid="active-session">{activeSession?.id ?? ''}</output>
      <output data-testid="active-session-loading">{String(Boolean(activeSessionLoading))}</output>
      <output data-testid="missing-agent-selection">{String(Boolean(missingAgentSelection))}</output>
      <output data-testid="locate-message-id">{locateMessageId ?? ''}</output>
      <output data-testid="pane-open">{String(paneOpen)}</output>
      <output data-testid="pane-position">{panePosition ?? ''}</output>
      <output data-testid="session-pane-open">{String(sessionPaneOpen)}</output>
      <output data-testid="show-resource-list-controls">{String(showResourceListControls)}</output>
      {showResourceListControls && onSidebarToggle && (
        <button type="button" onClick={onSidebarToggle}>
          Toggle sidebar
        </button>
      )}
      {onPaneAutoCollapseChange && (
        <>
          <button type="button" onClick={() => onPaneAutoCollapseChange(true)}>
            Auto collapse pane
          </button>
          <button type="button" onClick={() => onPaneAutoCollapseChange(false)}>
            Auto restore pane
          </button>
        </>
      )}
      {resourcePaneCount && (
        <output data-testid="resource-pane-count">
          {resourcePaneCount.label}:{resourcePaneCount.count}
        </output>
      )}
      <button type="button" onClick={() => void onSessionWorkspaceChange?.('workspace-next')}>
        Select session workspace
      </button>
      <button type="button" onClick={() => void onCreateEmptySession?.({ agentId: 'agent-a' })}>
        Create session for agent
      </button>
      {onCreateEmptySession && (
        <button type="button" onClick={() => void onCreateEmptySession()}>
          Create empty session from composer
        </button>
      )}
      <button type="button" onClick={() => void onMissingAgentSelectionAgentChange?.('agent-b')}>
        Select missing agent
      </button>
      <button type="button" onClick={() => onVisibleAgentChange?.('agent-visible')}>
        Show visible agent
      </button>
      <button type="button" onClick={() => onVisibleWorkspaceChange?.('workspace-visible')}>
        Show visible workspace
      </button>
      {onSessionPaneOpenChange && (
        <button type="button" onClick={() => onSessionPaneOpenChange(false)}>
          Close session pane
        </button>
      )}
      {onPaneCollapse && (
        <button type="button" onClick={onPaneCollapse}>
          Collapse pane
        </button>
      )}
      {pane}
      {resourcePane?.node}
    </section>
  )
}))

vi.mock('../components/AgentChatNavbar', () => ({
  AgentChatNavbar: ({ onSidebarToggle }: { onSidebarToggle?: () => void }) => (
    <div data-testid="agent-chat-navbar">
      {onSidebarToggle && (
        <button type="button" onClick={onSidebarToggle}>
          Toggle sidebar
        </button>
      )}
    </div>
  )
}))

vi.mock('../AgentSidePanel', () => ({
  default: ({
    activeSessionId,
    historyRecordsActive,
    agentSessionsSource,
    onAddAgent,
    onOpenHistoryRecords,
    onSetPanePosition,
    onCreateSession,
    onShowMissingAgentSelection,
    revealRequest,
    resourceMenuItems,
    setActiveSessionId
  }: any) => {
    agentPageMocks.agentSidePanelSessionsSource = agentSessionsSource

    return (
      <div
        data-active-session-id={activeSessionId ?? ''}
        data-history-active={String(Boolean(historyRecordsActive))}
        data-reveal-request={JSON.stringify(revealRequest ?? null)}
        data-testid="agent-side-panel">
        <button
          type="button"
          onClick={() => {
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
          }}>
          Select session next
        </button>
        {onOpenHistoryRecords && (
          <button type="button" onClick={onOpenHistoryRecords}>
            Open history records
          </button>
        )}
        {onSetPanePosition && (
          <button type="button" onClick={() => void onSetPanePosition('right')}>
            Move sessions right
          </button>
        )}
        <button type="button" onClick={() => void onAddAgent?.()}>
          Open agent picker
        </button>
        <button type="button" onClick={() => onShowMissingAgentSelection?.()}>
          Show missing agent selection
        </button>
        <button
          type="button"
          onClick={() => onCreateSession?.({ agentId: 'agent-a', workspace: { type: AGENT_WORKSPACE_TYPE.SYSTEM } })}>
          Create panel session
        </button>
        <button
          type="button"
          onClick={() =>
            onCreateSession?.({
              agentId: 'agent-a',
              workspace: { type: AGENT_WORKSPACE_TYPE.SYSTEM },
              excludeReuseSessionId: 'session-empty-system-a'
            })
          }>
          Replace deleted panel session
        </button>
        {resourceMenuItems?.map((item: { id: string; label: ReactNode; onSelect: () => void | Promise<void> }) => (
          <button key={item.id} type="button" onClick={() => void item.onSelect()}>
            {item.id === 'agent-resource-view' ? 'agent.manage.title' : item.label}
          </button>
        ))}
      </div>
    )
  }
}))

vi.mock('@renderer/components/chat/resourceList/AgentResourceList', () => ({
  AgentResourceList: ({
    activeAgentId,
    historyRecordsActive,
    agentSessionsSource,
    onAddAgent,
    onActiveAgentDeleted,
    onOpenHistoryRecords,
    onSelectedAgentClick
  }: {
    activeAgentId?: string | null
    historyRecordsActive?: boolean
    agentSessionsSource?: unknown
    onAddAgent?: () => void | Promise<void>
    onActiveAgentDeleted?: (agentId: string) => void | Promise<void>
    onOpenHistoryRecords?: () => void | Promise<void>
    onSelectedAgentClick?: () => void | Promise<void>
    resourceMenuItems?: Array<{ id: string; label: ReactNode; onSelect: () => void | Promise<void> }>
  }) => {
    agentPageMocks.agentResourceListSessionsSource = agentSessionsSource

    return (
      <div
        data-active-agent-id={activeAgentId ?? ''}
        data-history-active={String(Boolean(historyRecordsActive))}
        data-testid="agent-resource-list">
        <button type="button" onClick={() => void onAddAgent?.()}>
          Open agent picker
        </button>
        <button type="button" onClick={() => void onOpenHistoryRecords?.()}>
          Open history records
        </button>
        <button type="button" onClick={() => void onActiveAgentDeleted?.(activeAgentId ?? '')}>
          Delete active agent
        </button>
        <button type="button" onClick={() => void onSelectedAgentClick?.()}>
          Toggle selected agent pane
        </button>
      </div>
    )
  }
}))

vi.mock('../components/AgentCreateDialog', () => ({
  AgentCreateDialog: ({ open, onCreated }: { open?: boolean; onCreated?: (agentId: string) => void }) =>
    open ? (
      <div data-testid="agent-create-dialog">
        <button type="button" onClick={() => onCreated?.('agent-b')}>
          Create resource agent
        </button>
      </div>
    ) : null
}))

vi.mock('../components/Sessions', () => ({
  default: ({
    agentSessionsSource,
    agentIdFilter,
    onSetPanePosition,
    presentation
  }: {
    agentSessionsSource?: unknown
    agentIdFilter?: string | null
    onSetPanePosition?: (position: 'left' | 'right') => void | Promise<void>
    presentation?: string
  }) => {
    agentPageMocks.rightPanelSessionsSource = agentSessionsSource

    return (
      <div
        data-agent-id={agentIdFilter ?? ''}
        data-presentation={presentation ?? ''}
        data-testid="session-resource-panel">
        <button type="button" onClick={() => void onSetPanePosition?.('left')}>
          Move sessions left
        </button>
      </div>
    )
  }
}))

vi.mock('@renderer/components/history/HistoryRecordsView', () => ({
  default: ({ open, onRecordSelect }: { open?: boolean; onRecordSelect?: (sessionId: string | null) => void }) =>
    open ? (
      <div data-testid="history-records-view">
        <button type="button" onClick={() => onRecordSelect?.(null)}>
          Clear history session
        </button>
      </div>
    ) : null
}))

import { useTabSelfMetadata } from '@renderer/hooks/tab'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { toast } from '@renderer/services/toast'

import AgentPage from '../AgentPage'

describe('AgentPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    agentPageMocks.routeSearch = { sessionId: 'session-initial' }
    agentPageMocks.agents = [{ id: 'agent-a', model: 'model-a', name: 'Agent A' }]
    agentPageMocks.classicLayoutSessions = []
    agentPageMocks.sessionsFirstPageLoading = false
    agentPageMocks.sessionsLoadingAll = false
    agentPageMocks.sessionsFullyLoaded = true
    agentPageMocks.isLatestSessionLoading = false
    agentPageMocks.latestSessionOverride = undefined
    agentPageMocks.agentResourceListSessionsSource = undefined
    agentPageMocks.agentSessionsSourceOptions = []
    agentPageMocks.agentSidePanelSessionsSource = undefined
    agentPageMocks.createdAgentSessionsSource = undefined
    agentPageMocks.rightPanelSessionsSource = undefined
    agentPageMocks.currentTab = undefined
    agentPageMocks.lastUsedAgentId = null
    agentPageMocks.lastUsedWorkspaceId = null
    agentPageMocks.sessionExpansionAgent = []
    agentPageMocks.classicLayoutRightPaneOpen = true
    agentPageMocks.activeSessionOptions = null
    agentPageMocks.pendingSession = null
    agentPageMocks.sessionDisplayMode = 'time'
    agentPageMocks.sessionPanePosition = 'right'
    agentPageMocks.showSidebar = false
    agentPageMocks.isActiveTab = false
    agentPageMocks.dataApiGet.mockImplementation(async (path: string) => {
      if (path.startsWith('/agent-sessions/') && path.endsWith('/messages')) {
        return { items: [{ id: 'message-existing' }], nextCursor: undefined }
      }
      if (path === '/agent-workspaces/workspace-next') return agentPageMocks.workspaceNext
      if (path === '/agent-workspaces/workspace-remembered') {
        return { ...agentPageMocks.workspaceNext, id: 'workspace-remembered' }
      }
      return agentPageMocks.workspace
    })
    agentPageMocks.dataApiPost.mockResolvedValue(agentPageMocks.persistedSession)
    agentPageMocks.dataApiDelete.mockResolvedValue({ deletedIds: [] })
    agentPageMocks.updateSession.mockResolvedValue(agentPageMocks.persistedSession)
    agentPageMocks.setSessionWorkspace.mockResolvedValue(agentPageMocks.persistedSession)
    agentPageMocks.invalidateCache.mockResolvedValue(undefined)
    activeSessionMocks.session = null
    activeSessionMocks.isLoading = false
    activeSessionMocks.sessionSource = 'none'

    ipcMocks.request.mockClear()
  })

  it('renders the agent resource list in the left pane', () => {
    agentPageMocks.sessionDisplayMode = 'agent'
    activeSessionMocks.session = { ...agentPageMocks.persistedSession, agentId: 'agent-a' }
    activeSessionMocks.sessionSource = 'query'

    render(<AgentPage />)

    expect(screen.getByTestId('agent-resource-list')).toHaveAttribute('data-active-agent-id', 'agent-a')
    expect(screen.getByTestId('session-resource-panel')).toHaveAttribute('data-agent-id', 'agent-a')
    expect(screen.getByTestId('session-resource-panel')).toHaveAttribute('data-presentation', 'right-panel')
    expect(screen.getByTestId('session-pane-open')).toHaveTextContent('true')
    expect(screen.queryByTestId('agent-side-panel')).not.toBeInTheDocument()
  })

  it('renders the classic agent layout for the new-user display default', () => {
    agentPageMocks.sessionDisplayMode = DefaultPreferences.default['agent.session.display_mode']
    activeSessionMocks.session = { ...agentPageMocks.persistedSession, agentId: 'agent-a' }
    activeSessionMocks.sessionSource = 'query'

    render(<AgentPage />)

    expect(DefaultPreferences.default['agent.session.display_mode']).toBe('agent')
    expect(screen.getByTestId('agent-resource-list')).toBeInTheDocument()
    expect(screen.getByTestId('session-resource-panel')).toHaveAttribute('data-presentation', 'right-panel')
    expect(screen.queryByTestId('agent-side-panel')).not.toBeInTheDocument()
  })

  it('passes the same agent session source to the classic rail and right panel', () => {
    agentPageMocks.sessionDisplayMode = 'agent'
    activeSessionMocks.session = { ...agentPageMocks.persistedSession, agentId: 'agent-a' }
    activeSessionMocks.sessionSource = 'query'

    render(<AgentPage />)

    expect(agentPageMocks.agentSessionsSourceOptions).toEqual([{ enabled: true }])
    expect(agentPageMocks.agentResourceListSessionsSource).toBe(agentPageMocks.createdAgentSessionsSource)
    expect(agentPageMocks.rightPanelSessionsSource).toBe(agentPageMocks.createdAgentSessionsSource)
  })

  it('hides resource management entries from the left rail when sessions are on the right', () => {
    agentPageMocks.sessionDisplayMode = 'agent'
    agentPageMocks.sessionPanePosition = 'right'
    activeSessionMocks.session = { ...agentPageMocks.persistedSession, agentId: 'agent-a' }
    activeSessionMocks.sessionSource = 'query'

    render(<AgentPage />)

    expect(screen.getByTestId('agent-resource-list')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'agent.manage.title' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'chat.resource_view.menu.skill' })).not.toBeInTheDocument()
  })

  it('does not render the session resource pane when the classic session position is left', () => {
    agentPageMocks.sessionDisplayMode = 'agent'
    agentPageMocks.sessionPanePosition = 'left'
    agentPageMocks.classicLayoutRightPaneOpen = true
    activeSessionMocks.session = { ...agentPageMocks.persistedSession, agentId: 'agent-a' }
    activeSessionMocks.sessionSource = 'query'

    render(<AgentPage />)

    expect(screen.getByTestId('agent-side-panel')).toBeInTheDocument()
    expect(screen.queryByTestId('agent-resource-list')).not.toBeInTheDocument()
    expect(screen.queryByTestId('session-resource-panel')).not.toBeInTheDocument()
    expect(screen.queryByTestId('resource-pane-count')).not.toBeInTheDocument()
  })

  it('does not auto-open the session right pane when switching to agent display mode with left session position', () => {
    agentPageMocks.sessionDisplayMode = 'agent'
    agentPageMocks.sessionPanePosition = 'left'
    agentPageMocks.classicLayoutRightPaneOpen = false
    activeSessionMocks.session = { ...agentPageMocks.persistedSession, agentId: 'agent-a' }
    activeSessionMocks.sessionSource = 'query'

    render(<AgentPage />)

    expect(screen.getByTestId('session-pane-open')).toHaveTextContent('false')
    expect(agentPageMocks.setClassicLayoutRightPaneOpen).not.toHaveBeenCalledWith(true)
  })

  it('toggles the classic session pane when the selected agent is clicked again', () => {
    agentPageMocks.sessionDisplayMode = 'agent'
    agentPageMocks.classicLayoutRightPaneOpen = true
    activeSessionMocks.session = { ...agentPageMocks.persistedSession, agentId: 'agent-a' }
    activeSessionMocks.sessionSource = 'query'

    render(<AgentPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Toggle selected agent pane' }))

    expect(agentPageMocks.setClassicLayoutRightPaneOpen).toHaveBeenCalledWith(false)
  })

  it('closes classic-layout history records when the active agent is clicked', () => {
    agentPageMocks.sessionDisplayMode = 'agent'
    agentPageMocks.sessionPanePosition = 'right'
    activeSessionMocks.session = { ...agentPageMocks.persistedSession, agentId: 'agent-a' }
    activeSessionMocks.sessionSource = 'query'

    render(<AgentPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Open history records' }))
    expect(screen.getByTestId('history-records-view')).toBeInTheDocument()
    expect(screen.getByTestId('agent-resource-list')).toHaveAttribute('data-history-active', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'Toggle selected agent pane' }))

    expect(screen.queryByTestId('history-records-view')).not.toBeInTheDocument()
    expect(screen.getByTestId('agent-resource-list')).toHaveAttribute('data-history-active', 'false')
  })

  it('renders the modern session sidebar when session display mode is time', () => {
    agentPageMocks.sessionDisplayMode = 'time'
    agentPageMocks.sessionPanePosition = 'right'
    activeSessionMocks.session = { ...agentPageMocks.persistedSession, agentId: 'agent-a' }
    activeSessionMocks.sessionSource = 'query'

    render(<AgentPage />)

    expect(screen.getByTestId('agent-side-panel')).toBeInTheDocument()
    expect(screen.queryByTestId('agent-resource-list')).not.toBeInTheDocument()
    expect(screen.queryByTestId('session-resource-panel')).not.toBeInTheDocument()
    expect(screen.getByTestId('pane-position')).toHaveTextContent('left')
    expect(agentPageMocks.agentSidePanelSessionsSource).toBe(agentPageMocks.createdAgentSessionsSource)
  })

  it('opens the agent create dialog from the modern add entry', () => {
    agentPageMocks.sessionDisplayMode = 'time'

    render(<AgentPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Open agent picker' }))

    expect(screen.getByTestId('agent-create-dialog')).toBeInTheDocument()
  })

  it('disables the agent session source in message-only view', () => {
    agentPageMocks.routeSearch = { sessionId: 'session-message', view: 'message' }

    render(<AgentPage />)

    expect(agentPageMocks.agentSessionsSourceOptions).toEqual([{ enabled: false }])
  })

  it('switches to agent grouping when changing session position from the left sidebar', async () => {
    agentPageMocks.sessionDisplayMode = 'workdir'
    agentPageMocks.sessionPanePosition = 'left'
    activeSessionMocks.session = { ...agentPageMocks.persistedSession, agentId: 'agent-a' }
    activeSessionMocks.sessionSource = 'query'

    render(<AgentPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Move sessions right' }))

    await waitFor(() => expect(agentPageMocks.sessionDisplayMode).toBe('agent'))
    expect(agentPageMocks.sessionPanePosition).toBe('right')
    expect(agentPageMocks.setClassicLayoutRightPaneOpen).toHaveBeenCalledWith(true)
  })

  it('expands only the active session agent when changing session position to the left sidebar', async () => {
    agentPageMocks.sessionDisplayMode = 'agent'
    agentPageMocks.sessionPanePosition = 'right'
    activeSessionMocks.session = { ...agentPageMocks.persistedSession, id: 'session-a', agentId: 'agent-a' }
    activeSessionMocks.sessionSource = 'query'
    agentPageMocks.classicLayoutSessions = [
      { ...agentPageMocks.persistedSession, id: 'session-a', agentId: 'agent-a' },
      { ...agentPageMocks.persistedSession, id: 'session-b', agentId: 'agent-b' },
      { ...agentPageMocks.persistedSession, id: 'session-c', agentId: 'agent-c' }
    ]

    render(<AgentPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Move sessions left' }))

    await waitFor(() => expect(agentPageMocks.sessionPanePosition).toBe('left'))
    expect(agentPageMocks.sessionExpansionAgent).toEqual(['session:agent:agent-b', 'session:agent:agent-c'])
  })

  it('renders the agent resource view outside AgentChat runtime', () => {
    activeSessionMocks.session = { ...agentPageMocks.persistedSession, agentId: 'agent-a' }
    activeSessionMocks.sessionSource = 'query'

    render(<AgentPage />)
    fireEvent.click(screen.getByRole('button', { name: 'agent.manage.title' }))

    expect(screen.getByTestId('resource-catalog-agent')).toBeInTheDocument()
    expect(screen.getByTestId('agent-conversation-page-shell')).toBeInTheDocument()
    expect(screen.queryByTestId('agent-chat')).not.toBeInTheDocument()
  })

  it('keeps system skill management available for the built-in Assistant', () => {
    agentPageMocks.agents = [
      {
        id: 'agent-a',
        model: 'model-a',
        name: 'Cherry Assistant',
        configuration: { builtin_role: 'assistant' }
      }
    ]
    activeSessionMocks.session = { ...agentPageMocks.persistedSession, agentId: 'agent-a' }
    activeSessionMocks.sessionSource = 'query'

    render(<AgentPage />)
    fireEvent.click(screen.getByRole('button', { name: 'chat.resource_view.menu.skill' }))

    expect(screen.getByTestId('resource-catalog-skill')).toHaveAttribute('data-skill-agent-id', 'agent-a')
  })

  it('renders history records outside AgentChat runtime and toggles them from the sidebar', () => {
    activeSessionMocks.session = { ...agentPageMocks.persistedSession, agentId: 'agent-a' }
    activeSessionMocks.sessionSource = 'query'

    render(<AgentPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Open history records' }))

    expect(screen.getByTestId('history-records-view')).toBeInTheDocument()
    expect(screen.getByTestId('agent-conversation-page-shell')).toBeInTheDocument()
    expect(screen.getByTestId('agent-side-panel')).toHaveAttribute('data-history-active', 'true')
    expect(screen.queryByTestId('agent-chat')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Open history records' }))

    expect(screen.queryByTestId('history-records-view')).not.toBeInTheDocument()
    expect(screen.getByTestId('agent-chat')).toBeInTheDocument()
    expect(screen.getByTestId('agent-side-panel')).toHaveAttribute('data-history-active', 'false')
  })

  it('replaces the history center surface when opening agent management', () => {
    activeSessionMocks.session = { ...agentPageMocks.persistedSession, agentId: 'agent-a' }
    activeSessionMocks.sessionSource = 'query'

    render(<AgentPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Open history records' }))
    fireEvent.click(screen.getByRole('button', { name: 'agent.manage.title' }))

    expect(screen.queryByTestId('history-records-view')).not.toBeInTheDocument()
    expect(screen.getByTestId('resource-catalog-agent')).toBeInTheDocument()
    expect(screen.queryByTestId('agent-chat')).not.toBeInTheDocument()
  })

  it('keeps the agent resource view open while opening the classic-layout agent create dialog', () => {
    agentPageMocks.sessionDisplayMode = 'agent'
    agentPageMocks.sessionPanePosition = 'left'
    activeSessionMocks.session = { ...agentPageMocks.persistedSession, agentId: 'agent-a' }
    activeSessionMocks.sessionSource = 'query'

    render(<AgentPage />)

    fireEvent.click(screen.getByRole('button', { name: 'agent.manage.title' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open agent picker' }))

    expect(screen.getByTestId('agent-create-dialog')).toBeInTheDocument()
    expect(screen.getByTestId('resource-catalog-agent')).toBeInTheDocument()
    expect(screen.queryByTestId('agent-chat')).not.toBeInTheDocument()
  })

  it('keeps the agent resource view open until the created agent session is ready', async () => {
    agentPageMocks.sessionDisplayMode = 'agent'
    agentPageMocks.sessionPanePosition = 'left'
    agentPageMocks.routeSearch = { sessionId: 'session-created' }
    agentPageMocks.agents = [
      { id: 'agent-a', model: 'model-a', name: 'Agent A' },
      { id: 'agent-b', model: 'model-b', name: 'Agent B' }
    ]
    activeSessionMocks.session = { ...agentPageMocks.persistedSession, agentId: 'agent-a' }
    activeSessionMocks.sessionSource = 'query'
    let resolveSession!: (session: unknown) => void
    agentPageMocks.dataApiPost.mockReturnValue(
      new Promise<unknown>((resolve) => {
        resolveSession = resolve
      })
    )

    render(<AgentPage />)

    fireEvent.click(screen.getByRole('button', { name: 'agent.manage.title' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open agent picker' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create resource agent' }))

    await waitFor(() =>
      expect(agentPageMocks.dataApiPost).toHaveBeenCalledWith('/agent-sessions', {
        body: {
          agentId: 'agent-b',
          name: '',
          workspace: { type: AGENT_WORKSPACE_TYPE.SYSTEM }
        }
      })
    )
    expect(screen.queryByTestId('agent-create-dialog')).not.toBeInTheDocument()
    expect(screen.getByTestId('resource-catalog-agent')).toBeInTheDocument()
    expect(screen.queryByTestId('agent-chat')).not.toBeInTheDocument()

    await act(async () => {
      resolveSession({
        ...agentPageMocks.persistedSession,
        id: 'session-picker',
        agentId: 'agent-b',
        workspaceId: undefined,
        workspace: {
          type: 'system',
          name: 'No project',
          path: ''
        }
      })
      await Promise.resolve()
    })

    await waitFor(() => expect(screen.getByTestId('active-session')).toHaveTextContent('session-picker'))
    expect(screen.queryByTestId('resource-catalog-agent')).not.toBeInTheDocument()
  })

  it('prevents duplicate empty session creation from rapid classic-layout agent creation callback', async () => {
    agentPageMocks.sessionDisplayMode = 'agent'
    agentPageMocks.sessionPanePosition = 'left'
    agentPageMocks.routeSearch = { sessionId: 'session-created' }
    agentPageMocks.agents = [
      { id: 'agent-a', model: 'model-a', name: 'Agent A' },
      { id: 'agent-b', model: 'model-b', name: 'Agent B' }
    ]
    activeSessionMocks.session = { ...agentPageMocks.persistedSession, agentId: 'agent-a' }
    activeSessionMocks.sessionSource = 'query'
    let resolveSession!: (session: unknown) => void
    agentPageMocks.dataApiPost.mockReturnValue(
      new Promise<unknown>((resolve) => {
        resolveSession = resolve
      })
    )

    render(<AgentPage />)

    fireEvent.click(screen.getByRole('button', { name: 'agent.manage.title' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open agent picker' }))
    const selectAgentButton = screen.getByRole('button', { name: 'Create resource agent' })
    fireEvent.click(selectAgentButton)
    fireEvent.click(selectAgentButton)

    await waitFor(() => expect(agentPageMocks.dataApiPost).toHaveBeenCalledTimes(1))

    await act(async () => {
      resolveSession({
        ...agentPageMocks.persistedSession,
        id: 'session-picker',
        agentId: 'agent-b',
        workspaceId: undefined,
        workspace: {
          type: 'system',
          name: 'No project',
          path: ''
        }
      })
      await Promise.resolve()
    })
  })

  it('keeps a sidebar toggle beside agent resource search so a collapsed pane can be reopened', async () => {
    agentPageMocks.showSidebar = true
    activeSessionMocks.session = { ...agentPageMocks.persistedSession, agentId: 'agent-a' }
    activeSessionMocks.sessionSource = 'query'

    render(<AgentPage />)
    fireEvent.click(screen.getByRole('button', { name: 'agent.manage.title' }))

    const shell = screen.getByTestId('agent-conversation-page-shell')
    expect(within(shell).getByTestId('resource-pane-open')).toHaveTextContent('true')

    const toolbarLeading = within(shell).getByTestId('resource-toolbar-leading')

    // Collapse the pane from the resource toolbar toggle, then confirm the toggle survives the collapse.
    fireEvent.click(within(toolbarLeading).getByRole('button'))
    await waitFor(() => expect(within(shell).getByTestId('resource-pane-open')).toHaveTextContent('false'))

    fireEvent.click(within(toolbarLeading).getByRole('button'))
    await waitFor(() => expect(within(shell).getByTestId('resource-pane-open')).toHaveTextContent('true'))
  })

  it('preserves a manually closed classic-layout agent right pane across remounts', async () => {
    agentPageMocks.sessionDisplayMode = 'agent'
    agentPageMocks.classicLayoutRightPaneOpen = false
    activeSessionMocks.session = { ...agentPageMocks.persistedSession, agentId: 'agent-a' }
    activeSessionMocks.sessionSource = 'query'

    render(<AgentPage />)

    expect(screen.getByTestId('session-pane-open')).toHaveTextContent('false')
    expect(agentPageMocks.setClassicLayoutRightPaneOpen).not.toHaveBeenCalledWith(true)

    fireEvent.click(screen.getByRole('button', { name: 'Close session pane' }))

    expect(agentPageMocks.setClassicLayoutRightPaneOpen).toHaveBeenCalledWith(false)
  })

  it('passes the current agent task count to the classic-layout top button', () => {
    agentPageMocks.sessionDisplayMode = 'agent'
    activeSessionMocks.session = { ...agentPageMocks.persistedSession, agentId: 'agent-a' }
    activeSessionMocks.sessionSource = 'query'
    agentPageMocks.classicLayoutSessions = [
      { ...agentPageMocks.persistedSession, id: 'session-a' },
      { ...agentPageMocks.persistedSession, id: 'session-b' },
      { ...agentPageMocks.persistedSession, id: 'session-other', agentId: 'agent-b' }
    ]

    render(<AgentPage />)

    expect(screen.getByTestId('resource-pane-count')).toHaveTextContent('任务:2')
    expect(screen.getByTestId('session-resource-panel')).toHaveAttribute('data-agent-id', 'agent-a')
    expect(screen.getByTestId('session-resource-panel')).toHaveAttribute('data-presentation', 'right-panel')
  })

  it('selects the latest historical session by default when entering classic layout without a route session', async () => {
    agentPageMocks.sessionDisplayMode = 'agent'
    agentPageMocks.routeSearch = {}
    agentPageMocks.classicLayoutSessions = [
      {
        ...agentPageMocks.persistedSession,
        id: 'session-older',
        updatedAt: '2026-01-01T00:00:00.000Z'
      },
      {
        ...agentPageMocks.persistedSession,
        id: 'session-latest',
        updatedAt: '2026-01-03T00:00:00.000Z'
      }
    ]

    render(<AgentPage />)

    await waitFor(() => expect(agentPageMocks.activeSessionOptions?.activeSessionId).toBe('session-latest'))
    expect(screen.getByTestId('active-session')).toHaveTextContent('session-latest')
    expect(screen.getByTestId('missing-agent-selection')).toHaveTextContent('false')
    expect(agentPageMocks.dataApiPost).not.toHaveBeenCalled()
  })

  it('selects the latest historical session by default when entering modern layout without a route session', async () => {
    agentPageMocks.sessionDisplayMode = 'time'
    agentPageMocks.routeSearch = {}
    agentPageMocks.classicLayoutSessions = [
      { ...agentPageMocks.persistedSession, id: 'session-older', updatedAt: '2026-01-01T00:00:00.000Z' },
      { ...agentPageMocks.persistedSession, id: 'session-latest', updatedAt: '2026-01-03T00:00:00.000Z' }
    ]

    render(<AgentPage />)

    await waitFor(() => expect(agentPageMocks.activeSessionOptions?.activeSessionId).toBe('session-latest'))
    expect(screen.getByTestId('active-session')).toHaveTextContent('session-latest')
    expect(agentPageMocks.dataApiPost).not.toHaveBeenCalled()
  })

  it('resumes the latest session in modern layout from the dedicated latest query, without waiting for full history', async () => {
    agentPageMocks.sessionDisplayMode = 'time'
    agentPageMocks.routeSearch = {}
    // The paged history is still loading in the background; the dedicated latest query has resolved.
    agentPageMocks.sessionsFirstPageLoading = true
    agentPageMocks.sessionsLoadingAll = true
    agentPageMocks.sessionsFullyLoaded = false
    agentPageMocks.classicLayoutSessions = [
      { ...agentPageMocks.persistedSession, id: 'session-older', updatedAt: '2026-01-01T00:00:00.000Z' },
      { ...agentPageMocks.persistedSession, id: 'session-latest', updatedAt: '2026-01-03T00:00:00.000Z' }
    ]

    render(<AgentPage />)

    await waitFor(() => expect(agentPageMocks.activeSessionOptions?.activeSessionId).toBe('session-latest'))
    expect(agentPageMocks.dataApiPost).not.toHaveBeenCalled()
  })

  it('restores the session reported by the latest query even when it is outside the loaded first page', async () => {
    agentPageMocks.sessionDisplayMode = 'time'
    agentPageMocks.routeSearch = {}
    // The loaded page holds only other sessions; the dedicated latest query surfaces the true latest,
    // proving first-entry restore reads the query, not `findLatestUpdated` over the paged list.
    agentPageMocks.classicLayoutSessions = [
      { ...agentPageMocks.persistedSession, id: 'session-on-page', updatedAt: '2026-01-01T00:00:00.000Z' }
    ]
    agentPageMocks.latestSessionOverride = {
      ...agentPageMocks.persistedSession,
      id: 'session-off-page',
      updatedAt: '2026-01-09T00:00:00.000Z'
    }

    render(<AgentPage />)

    await waitFor(() => expect(agentPageMocks.activeSessionOptions?.activeSessionId).toBe('session-off-page'))
    expect(agentPageMocks.dataApiPost).not.toHaveBeenCalled()
  })

  it('creates an empty session on modern first entry only when there are no sessions', async () => {
    agentPageMocks.sessionDisplayMode = 'time'
    agentPageMocks.routeSearch = {}
    agentPageMocks.classicLayoutSessions = []
    agentPageMocks.dataApiPost.mockResolvedValue({
      ...agentPageMocks.persistedSession,
      id: 'session-new',
      agentId: 'agent-a'
    })

    render(<AgentPage />)

    await waitFor(() =>
      expect(agentPageMocks.dataApiPost).toHaveBeenCalledWith(
        '/agent-sessions',
        expect.objectContaining({ body: expect.objectContaining({ agentId: 'agent-a' }) })
      )
    )
  })

  it('does not create a session on modern first entry while the latest query is still loading', async () => {
    agentPageMocks.sessionDisplayMode = 'time'
    agentPageMocks.routeSearch = {}
    agentPageMocks.isLatestSessionLoading = true
    agentPageMocks.classicLayoutSessions = []

    render(<AgentPage />)

    await Promise.resolve()
    expect(agentPageMocks.dataApiPost).not.toHaveBeenCalled()
  })

  it('selects the latest remaining session after deleting the active agent in classic layout', async () => {
    agentPageMocks.sessionDisplayMode = 'agent'
    // Pin the active session via the route so the load-time auto-select effect stays out of the way.
    agentPageMocks.routeSearch = { sessionId: 'session-a' }
    activeSessionMocks.session = { ...agentPageMocks.persistedSession, id: 'session-a', agentId: 'agent-a' }
    activeSessionMocks.sessionSource = 'query'
    agentPageMocks.classicLayoutSessions = [
      {
        ...agentPageMocks.persistedSession,
        id: 'session-a',
        agentId: 'agent-a',
        updatedAt: '2026-01-02T00:00:00.000Z'
      },
      {
        ...agentPageMocks.persistedSession,
        id: 'session-b-old',
        agentId: 'agent-b',
        updatedAt: '2026-01-01T00:00:00.000Z'
      },
      {
        ...agentPageMocks.persistedSession,
        id: 'session-b-new',
        agentId: 'agent-b',
        updatedAt: '2026-01-03T00:00:00.000Z'
      }
    ]

    render(<AgentPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete active agent' }))

    // Classic layout settles on the latest session of a remaining agent.
    await waitFor(() => expect(screen.getByTestId('active-session')).toHaveTextContent('session-b-new'))
    expect(screen.getByTestId('missing-agent-selection')).toHaveTextContent('false')
  })

  it('clears the active session when the fallback create fails after deleting the active agent', async () => {
    // The deleted agent's last session is the active one; if the replacement create rejects, the active
    // session id must be cleared rather than left pointing at a session of the just-deleted agent.
    agentPageMocks.sessionDisplayMode = 'agent'
    agentPageMocks.routeSearch = { sessionId: 'session-a' }
    agentPageMocks.agents = [
      { id: 'agent-a', model: 'model-a', name: 'Agent A' },
      { id: 'agent-b', model: 'model-b', name: 'Agent B' }
    ]
    activeSessionMocks.session = { ...agentPageMocks.persistedSession, id: 'session-a', agentId: 'agent-a' }
    activeSessionMocks.sessionSource = 'query'
    // Only agent-a has a session, so deleting agent-a leaves no neighbour and forces a fallback create.
    agentPageMocks.classicLayoutSessions = [
      { ...agentPageMocks.persistedSession, id: 'session-a', agentId: 'agent-a', updatedAt: '2026-01-02T00:00:00.000Z' }
    ]
    agentPageMocks.dataApiPost.mockRejectedValue(new Error('create failed'))

    render(<AgentPage />)
    await waitFor(() => expect(agentPageMocks.activeSessionOptions?.activeSessionId).toBe('session-a'))

    fireEvent.click(screen.getByRole('button', { name: 'Delete active agent' }))

    await waitFor(() => expect(agentPageMocks.dataApiPost).toHaveBeenCalled())
    await waitFor(() => expect(agentPageMocks.activeSessionOptions?.activeSessionId).toBeNull())
  })

  it('creates and activates an empty session after creating an agent from the classic-layout add entry', async () => {
    agentPageMocks.sessionDisplayMode = 'agent'
    agentPageMocks.routeSearch = { sessionId: 'session-existing' }
    agentPageMocks.agents = [
      { id: 'agent-a', model: 'model-a', name: 'Agent A' },
      { id: 'agent-b', model: 'model-b', name: 'Agent B' }
    ]
    agentPageMocks.dataApiPost.mockResolvedValue({
      ...agentPageMocks.persistedSession,
      id: 'session-picker',
      agentId: 'agent-b',
      workspaceId: undefined,
      workspace: {
        type: 'system',
        name: 'No project',
        path: ''
      }
    })

    render(<AgentPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Open agent picker' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create resource agent' }))

    await waitFor(() =>
      expect(agentPageMocks.dataApiPost).toHaveBeenCalledWith('/agent-sessions', {
        body: {
          agentId: 'agent-b',
          name: '',
          workspace: { type: AGENT_WORKSPACE_TYPE.SYSTEM }
        }
      })
    )
    expect(agentPageMocks.activeSessionOptions?.activeSessionId).toBe('session-picker')
    expect(screen.getByTestId('active-session')).toHaveTextContent('session-picker')
    expect(screen.getByTestId('missing-agent-selection')).toHaveTextContent('false')
  })

  it('uses the remembered workspace when creating an empty session from the classic-layout agent create dialog', async () => {
    agentPageMocks.sessionDisplayMode = 'agent'
    agentPageMocks.routeSearch = { sessionId: 'session-existing' }
    agentPageMocks.lastUsedWorkspaceId = 'workspace-remembered'
    agentPageMocks.agents = [
      { id: 'agent-a', model: 'model-a', name: 'Agent A' },
      { id: 'agent-b', model: 'model-b', name: 'Agent B' }
    ]
    agentPageMocks.dataApiPost.mockResolvedValue({
      ...agentPageMocks.persistedSession,
      id: 'session-picker-workspace',
      agentId: 'agent-b',
      workspaceId: 'workspace-remembered',
      workspace: { ...agentPageMocks.workspaceNext, id: 'workspace-remembered' }
    })

    render(<AgentPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Open agent picker' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create resource agent' }))

    await waitFor(() =>
      expect(agentPageMocks.dataApiGet).toHaveBeenCalledWith('/agent-workspaces/workspace-remembered')
    )
    expect(agentPageMocks.dataApiPost).toHaveBeenCalledWith('/agent-sessions', {
      body: {
        agentId: 'agent-b',
        name: '',
        workspace: { type: AGENT_WORKSPACE_TYPE.USER, workspaceId: 'workspace-remembered' }
      }
    })
    expect(agentPageMocks.setLastUsedWorkspaceId).toHaveBeenCalledWith('workspace-remembered')
  })

  it('reuses the agent latest empty session instead of creating another one from the classic-layout agent create dialog', async () => {
    agentPageMocks.sessionDisplayMode = 'agent'
    agentPageMocks.routeSearch = {}
    agentPageMocks.agents = [
      { id: 'agent-a', model: 'model-a', name: 'Agent A' },
      { id: 'agent-b', model: 'model-b', name: 'Agent B' }
    ]
    agentPageMocks.classicLayoutSessions = [
      {
        id: 'session-empty-latest',
        agentId: 'agent-b',
        name: '',
        createdAt: '2026-01-03T00:00:00.000Z',
        updatedAt: '2026-01-03T00:00:00.000Z',
        workspace: { type: 'system' }
      },
      // Named real session -> not an untitled placeholder, so it is never reused.
      {
        id: 'session-real-older',
        agentId: 'agent-b',
        name: 'Real session',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T01:00:00.000Z',
        workspace: { type: 'system' }
      }
    ]

    render(<AgentPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Open agent picker' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create resource agent' }))

    await waitFor(() => expect(agentPageMocks.activeSessionOptions?.activeSessionId).toBe('session-empty-latest'))
    expect(agentPageMocks.dataApiPost).not.toHaveBeenCalled()
  })

  it('reuses the latest empty system session and deletes duplicate empty system sessions from the classic-layout agent create dialog', async () => {
    agentPageMocks.sessionDisplayMode = 'agent'
    agentPageMocks.routeSearch = {}
    agentPageMocks.agents = [
      { id: 'agent-a', model: 'model-a', name: 'Agent A' },
      { id: 'agent-b', model: 'model-b', name: 'Agent B' }
    ]
    agentPageMocks.classicLayoutSessions = [
      {
        id: 'session-empty-system-latest',
        agentId: 'agent-b',
        name: '',
        isNameManuallyEdited: false,
        createdAt: '2026-01-03T03:00:00.000Z',
        updatedAt: '2026-01-03T03:00:00.000Z',
        workspace: { type: 'system' }
      },
      {
        id: 'session-empty-system-old',
        agentId: 'agent-b',
        name: '',
        isNameManuallyEdited: false,
        createdAt: '2026-01-03T02:00:00.000Z',
        updatedAt: '2026-01-03T02:00:00.000Z',
        workspace: { type: 'system' }
      },
      {
        id: 'session-empty-user-workspace',
        agentId: 'agent-b',
        name: '',
        isNameManuallyEdited: false,
        createdAt: '2026-01-03T01:00:00.000Z',
        updatedAt: '2026-01-03T01:00:00.000Z',
        workspaceId: 'workspace-b',
        workspace: { type: 'user' }
      }
    ]

    render(<AgentPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Open agent picker' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create resource agent' }))

    await waitFor(() =>
      expect(agentPageMocks.activeSessionOptions?.activeSessionId).toBe('session-empty-system-latest')
    )
    expect(agentPageMocks.dataApiPost).not.toHaveBeenCalled()
    await waitFor(() =>
      expect(agentPageMocks.dataApiDelete).toHaveBeenCalledWith('/agent-sessions', {
        query: { ids: 'session-empty-system-old' }
      })
    )
    expect(agentPageMocks.closeConversationTabs).toHaveBeenCalledWith('agents', ['session-empty-system-old'])
  })

  it('reuses the latest empty session when an older candidate has an invalid timestamp', async () => {
    agentPageMocks.sessionDisplayMode = 'agent'
    agentPageMocks.routeSearch = {}
    agentPageMocks.agents = [
      { id: 'agent-a', model: 'model-a', name: 'Agent A' },
      { id: 'agent-b', model: 'model-b', name: 'Agent B' }
    ]
    agentPageMocks.classicLayoutSessions = [
      {
        id: 'session-empty-invalid',
        agentId: 'agent-b',
        name: '',
        createdAt: 'not-a-date',
        updatedAt: 'not-a-date',
        workspace: { type: 'system' }
      },
      {
        id: 'session-empty-latest',
        agentId: 'agent-b',
        name: '',
        createdAt: '2026-01-03T00:00:00.000Z',
        updatedAt: '2026-01-03T00:00:00.000Z',
        workspace: { type: 'system' }
      }
    ]

    render(<AgentPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Open agent picker' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create resource agent' }))

    await waitFor(() => expect(agentPageMocks.activeSessionOptions?.activeSessionId).toBe('session-empty-latest'))
    expect(agentPageMocks.dataApiPost).not.toHaveBeenCalled()
  })

  it('reuses the current agent empty session from the classic-layout composer button', async () => {
    agentPageMocks.sessionDisplayMode = 'agent'
    activeSessionMocks.session = {
      ...agentPageMocks.persistedSession,
      id: 'session-active',
      agentId: 'agent-a',
      updatedAt: '2026-01-03T01:00:00.000Z',
      workspaceId: 'workspace-a',
      workspace: agentPageMocks.workspace
    }
    activeSessionMocks.sessionSource = 'query'
    agentPageMocks.classicLayoutSessions = [
      {
        id: 'session-empty-latest',
        agentId: 'agent-a',
        name: '',
        createdAt: '2026-01-03T00:00:00.000Z',
        updatedAt: '2026-01-03T00:00:00.000Z',
        workspaceId: 'workspace-a',
        workspace: { type: 'user' }
      }
    ]

    render(<AgentPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Create empty session from composer' }))

    await waitFor(() => expect(agentPageMocks.activeSessionOptions?.activeSessionId).toBe('session-empty-latest'))
    expect(agentPageMocks.dataApiPost).not.toHaveBeenCalled()
    expect(agentPageMocks.invalidateCache).not.toHaveBeenCalled()
  })

  it('excludes the just-deleted session from reuse so the post-delete replacement creates a fresh one', async () => {
    // Regression: after deleting the last session of an agent, the stale candidate list still holds
    // the deleted empty (untouched) session — reused without a DB re-check. Without the exclusion the
    // fallback would reactivate the deleted id instead of creating a replacement.
    agentPageMocks.agents = [{ id: 'agent-a', model: 'model-a', name: 'Agent A' }]
    agentPageMocks.classicLayoutSessions = [
      {
        id: 'session-empty-system-a',
        agentId: 'agent-a',
        name: '',
        isNameManuallyEdited: false,
        createdAt: '2026-01-03T03:00:00.000Z',
        updatedAt: '2026-01-03T03:00:00.000Z',
        workspace: { type: 'system' }
      }
    ]

    render(<AgentPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Replace deleted panel session' }))

    await waitFor(() =>
      expect(agentPageMocks.dataApiPost).toHaveBeenCalledWith('/agent-sessions', {
        body: { agentId: 'agent-a', name: '', workspace: { type: AGENT_WORKSPACE_TYPE.SYSTEM } }
      })
    )
    await waitFor(() => expect(agentPageMocks.activeSessionOptions?.activeSessionId).toBe('session-created'))
  })

  it('reuses the latest empty system session and deletes duplicate empty system sessions from the composer button', async () => {
    agentPageMocks.sessionDisplayMode = 'agent'
    activeSessionMocks.session = {
      ...agentPageMocks.persistedSession,
      id: 'session-active',
      agentId: 'agent-a',
      name: '',
      isNameManuallyEdited: false,
      createdAt: '2026-01-03T00:00:00.000Z',
      updatedAt: '2026-01-03T03:00:00.000Z',
      workspaceId: undefined,
      workspace: { type: 'system', name: 'No project', path: '' }
    }
    activeSessionMocks.sessionSource = 'query'
    agentPageMocks.classicLayoutSessions = [
      {
        id: 'session-empty-system-middle',
        agentId: 'agent-a',
        name: '',
        isNameManuallyEdited: false,
        createdAt: '2026-01-03T00:00:00.000Z',
        updatedAt: '2026-01-03T02:00:00.000Z',
        workspaceId: undefined,
        workspace: undefined
      },
      {
        id: 'session-empty-system-oldest',
        agentId: 'agent-a',
        name: '',
        isNameManuallyEdited: false,
        createdAt: '2026-01-03T00:00:00.000Z',
        updatedAt: '2026-01-03T01:00:00.000Z',
        workspaceId: undefined,
        workspace: undefined
      }
    ]
    agentPageMocks.dataApiGet.mockImplementation(async (path: string) => {
      if (path.startsWith('/agent-sessions/') && path.endsWith('/messages')) {
        return { items: [], nextCursor: undefined }
      }
      return agentPageMocks.workspace
    })

    render(<AgentPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Create empty session from composer' }))

    await waitFor(() => expect(agentPageMocks.activeSessionOptions?.activeSessionId).toBe('session-active'))
    expect(agentPageMocks.dataApiPost).not.toHaveBeenCalled()
    await waitFor(() =>
      expect(agentPageMocks.dataApiDelete).toHaveBeenCalledWith('/agent-sessions', {
        query: { ids: 'session-empty-system-middle,session-empty-system-oldest' }
      })
    )
    expect(agentPageMocks.closeConversationTabs).toHaveBeenCalledWith('agents', [
      'session-empty-system-middle',
      'session-empty-system-oldest'
    ])
  })

  it('does not reuse an empty session from a different workspace from the classic-layout composer button', async () => {
    agentPageMocks.sessionDisplayMode = 'agent'
    activeSessionMocks.session = {
      ...agentPageMocks.persistedSession,
      id: 'session-active',
      agentId: 'agent-a',
      updatedAt: '2026-01-03T01:00:00.000Z',
      workspaceId: 'workspace-a',
      workspace: agentPageMocks.workspace
    }
    activeSessionMocks.sessionSource = 'query'
    agentPageMocks.classicLayoutSessions = [
      // Untouched placeholder, but a different workspace → blocked by workspace match, not touched-ness.
      {
        id: 'session-empty-other-workspace',
        agentId: 'agent-a',
        name: '',
        createdAt: '2026-01-03T00:00:00.000Z',
        updatedAt: '2026-01-03T00:00:00.000Z',
        workspaceId: 'workspace-b',
        workspace: { type: 'user' }
      }
    ]
    agentPageMocks.dataApiPost.mockResolvedValue({
      ...agentPageMocks.persistedSession,
      id: 'session-composer-empty',
      agentId: 'agent-a',
      name: '',
      workspaceId: 'workspace-a',
      workspace: agentPageMocks.workspace
    })

    render(<AgentPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Create empty session from composer' }))

    await waitFor(() =>
      expect(agentPageMocks.dataApiPost).toHaveBeenCalledWith('/agent-sessions', {
        body: {
          agentId: 'agent-a',
          name: '',
          workspace: { type: AGENT_WORKSPACE_TYPE.USER, workspaceId: 'workspace-a' }
        }
      })
    )
    expect(agentPageMocks.activeSessionOptions?.activeSessionId).toBe('session-composer-empty')
  })

  it('prevents duplicate empty session creation from rapid classic-layout composer clicks', async () => {
    agentPageMocks.sessionDisplayMode = 'agent'
    activeSessionMocks.session = {
      ...agentPageMocks.persistedSession,
      id: 'session-active',
      agentId: 'agent-a',
      updatedAt: '2026-01-03T01:00:00.000Z',
      workspaceId: 'workspace-a',
      workspace: agentPageMocks.workspace
    }
    activeSessionMocks.sessionSource = 'query'
    let resolveSession!: (session: unknown) => void
    agentPageMocks.dataApiPost.mockReturnValue(
      new Promise<unknown>((resolve) => {
        resolveSession = resolve
      })
    )

    render(<AgentPage />)

    const createSessionButton = screen.getByRole('button', { name: 'Create empty session from composer' })
    fireEvent.click(createSessionButton)
    fireEvent.click(createSessionButton)

    await waitFor(() => expect(agentPageMocks.dataApiPost).toHaveBeenCalledTimes(1))

    await act(async () => {
      resolveSession({
        ...agentPageMocks.persistedSession,
        id: 'session-composer-empty',
        agentId: 'agent-a',
        name: '',
        workspaceId: 'workspace-a',
        workspace: agentPageMocks.workspace
      })
      await Promise.resolve()
    })
  })

  it('creates a fresh session from the classic-layout composer button when the latest is chatted-in with a blank name (auto-naming off)', async () => {
    agentPageMocks.sessionDisplayMode = 'agent'
    activeSessionMocks.session = {
      ...agentPageMocks.persistedSession,
      id: 'session-active',
      agentId: 'agent-a',
      updatedAt: '2026-01-03T01:00:00.000Z',
      workspaceId: 'workspace-a',
      workspace: agentPageMocks.workspace
    }
    activeSessionMocks.sessionSource = 'query'
    // Auto-naming off keeps the name blank, but the message probe finds content — a real
    // conversation that must NOT be reused as an empty placeholder (#16434).
    agentPageMocks.classicLayoutSessions = [
      {
        id: 'session-chatted-blank',
        agentId: 'agent-a',
        name: '',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-03T00:00:00.000Z',
        workspaceId: 'workspace-a',
        workspace: { type: 'user' }
      }
    ]
    agentPageMocks.dataApiPost.mockResolvedValue({
      ...agentPageMocks.persistedSession,
      id: 'session-composer-empty',
      agentId: 'agent-a',
      name: '',
      workspaceId: 'workspace-a',
      workspace: agentPageMocks.workspace
    })

    render(<AgentPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Create empty session from composer' }))

    await waitFor(() =>
      expect(agentPageMocks.dataApiPost).toHaveBeenCalledWith('/agent-sessions', {
        body: {
          agentId: 'agent-a',
          name: '',
          workspace: { type: AGENT_WORKSPACE_TYPE.USER, workspaceId: 'workspace-a' }
        }
      })
    )
    await waitFor(() => expect(agentPageMocks.activeSessionOptions?.activeSessionId).toBe('session-composer-empty'))
    expect(screen.getByTestId('active-session')).toHaveTextContent('session-composer-empty')
    expect(agentPageMocks.invalidateCache).toHaveBeenCalledWith([
      '/agent-sessions',
      '/agent-workspaces',
      '/agent-sessions/session-composer-empty'
    ])
  })

  it('bounds message probes for touched blank session reuse candidates', async () => {
    agentPageMocks.sessionDisplayMode = 'agent'
    activeSessionMocks.session = {
      ...agentPageMocks.persistedSession,
      id: 'session-active',
      agentId: 'agent-a',
      workspaceId: 'workspace-a',
      workspace: agentPageMocks.workspace
    }
    activeSessionMocks.sessionSource = 'query'
    agentPageMocks.classicLayoutSessions = Array.from({ length: 12 }, (_, index) => ({
      id: `session-blank-touched-${index}`,
      agentId: 'agent-a',
      name: '',
      isNameManuallyEdited: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: `2026-01-03T00:00:${String(index).padStart(2, '0')}.000Z`,
      workspaceId: 'workspace-a',
      workspace: { type: 'user' }
    }))
    agentPageMocks.dataApiPost.mockResolvedValue({
      ...agentPageMocks.persistedSession,
      id: 'session-composer-empty',
      agentId: 'agent-a',
      name: '',
      workspaceId: 'workspace-a',
      workspace: agentPageMocks.workspace
    })

    render(<AgentPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Create empty session from composer' }))

    await waitFor(() => expect(agentPageMocks.dataApiPost).toHaveBeenCalled())
    const messageProbeCalls = agentPageMocks.dataApiGet.mock.calls.filter(
      ([path]) => typeof path === 'string' && path.startsWith('/agent-sessions/') && path.endsWith('/messages')
    )
    expect(messageProbeCalls).toHaveLength(8)
    expect(messageProbeCalls).toEqual(
      Array.from({ length: 8 }, (_, index) => [
        `/agent-sessions/session-blank-touched-${11 - index}/messages`,
        { query: { limit: 1 } }
      ])
    )
    expect(agentPageMocks.dataApiGet).not.toHaveBeenCalledWith('/agent-sessions', expect.anything())
  })

  it('toasts when the classic-layout composer empty-session creation fails', async () => {
    agentPageMocks.sessionDisplayMode = 'agent'
    activeSessionMocks.session = {
      ...agentPageMocks.persistedSession,
      id: 'session-active',
      agentId: 'agent-a',
      updatedAt: '2026-01-03T01:00:00.000Z',
      workspaceId: 'workspace-a',
      workspace: agentPageMocks.workspace
    }
    activeSessionMocks.sessionSource = 'query'
    agentPageMocks.classicLayoutSessions = []
    agentPageMocks.dataApiPost.mockRejectedValue(new Error('create failed'))

    render(<AgentPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Create empty session from composer' }))

    await waitFor(() => expect(agentPageMocks.dataApiPost).toHaveBeenCalled())
    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    // The active session is unchanged — no new session was activated.
    expect(agentPageMocks.activeSessionOptions?.activeSessionId).not.toBe('session-composer-empty')
  })

  it('updates the active classic-layout session workspace through the composer control', async () => {
    agentPageMocks.sessionDisplayMode = 'agent'
    activeSessionMocks.session = {
      ...agentPageMocks.persistedSession,
      id: 'session-active',
      agentId: 'agent-a',
      workspaceId: 'workspace-a',
      workspace: agentPageMocks.workspace
    }
    activeSessionMocks.sessionSource = 'query'
    agentPageMocks.setSessionWorkspace.mockResolvedValue({
      ...agentPageMocks.persistedSession,
      id: 'session-active',
      workspaceId: 'workspace-next',
      workspace: agentPageMocks.workspaceNext
    })

    render(<AgentPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Select session workspace' }))

    await waitFor(() =>
      expect(agentPageMocks.setSessionWorkspace).toHaveBeenCalledWith('session-active', {
        type: AGENT_WORKSPACE_TYPE.USER,
        workspaceId: 'workspace-next'
      })
    )
    expect(agentPageMocks.setLastUsedWorkspaceId).toHaveBeenCalledWith('workspace-next')
  })

  it('updates the active modern-layout session workspace through the composer control', async () => {
    agentPageMocks.sessionDisplayMode = 'workdir'
    activeSessionMocks.session = {
      ...agentPageMocks.persistedSession,
      id: 'session-active',
      agentId: 'agent-a',
      workspaceId: undefined,
      workspace: { type: 'system', name: 'No project', path: '' }
    }
    activeSessionMocks.sessionSource = 'query'
    agentPageMocks.setSessionWorkspace.mockResolvedValue({
      ...agentPageMocks.persistedSession,
      id: 'session-active',
      workspaceId: 'workspace-next',
      workspace: agentPageMocks.workspaceNext
    })

    render(<AgentPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Select session workspace' }))

    await waitFor(() =>
      expect(agentPageMocks.setSessionWorkspace).toHaveBeenCalledWith('session-active', {
        type: AGENT_WORKSPACE_TYPE.USER,
        workspaceId: 'workspace-next'
      })
    )
    expect(agentPageMocks.setLastUsedWorkspaceId).toHaveBeenCalledWith('workspace-next')
  })

  it('creates a new session when the agent latest session is not empty from the classic-layout agent create dialog', async () => {
    agentPageMocks.sessionDisplayMode = 'agent'
    agentPageMocks.routeSearch = {}
    agentPageMocks.agents = [
      { id: 'agent-a', model: 'model-a', name: 'Agent A' },
      { id: 'agent-b', model: 'model-b', name: 'Agent B' }
    ]
    agentPageMocks.classicLayoutSessions = [
      {
        id: 'session-real-latest',
        agentId: 'agent-b',
        name: 'Real session',
        updatedAt: '2026-01-03T00:00:00.000Z',
        workspace: { type: 'system' }
      }
    ]
    agentPageMocks.dataApiPost.mockResolvedValue({
      ...agentPageMocks.persistedSession,
      id: 'session-created',
      agentId: 'agent-b',
      workspaceId: undefined,
      workspace: { type: 'system', name: 'No project', path: '' }
    })

    render(<AgentPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Open agent picker' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create resource agent' }))

    await waitFor(() =>
      expect(agentPageMocks.dataApiPost).toHaveBeenCalledWith(
        '/agent-sessions',
        expect.objectContaining({ body: expect.objectContaining({ agentId: 'agent-b' }) })
      )
    )
  })

  it('uses tab metadata as the session entry when the URL is the agents route', () => {
    agentPageMocks.routeSearch = {}
    agentPageMocks.currentTab = { metadata: { instanceAppId: 'agents', instanceKey: 'session-from-metadata' } }

    render(<AgentPage />)

    expect(agentPageMocks.activeSessionOptions?.activeSessionId).toBe('session-from-metadata')
  })

  it('keeps the created session when clearing the tab metadata after starting a new task', async () => {
    agentPageMocks.routeSearch = {}
    agentPageMocks.currentTab = { metadata: { instanceAppId: 'agents', instanceKey: 'session-from-metadata' } }

    const { rerender } = render(<AgentPage />)

    expect(agentPageMocks.activeSessionOptions?.activeSessionId).toBe('session-from-metadata')

    fireEvent.click(screen.getByRole('button', { name: 'Create panel session' }))

    await waitFor(() => expect(agentPageMocks.activeSessionOptions?.activeSessionId).toBe('session-created'))
    expect(screen.getByTestId('active-session')).toHaveTextContent('session-created')

    agentPageMocks.currentTab = { metadata: { instanceAppId: 'agents' } }
    rerender(<AgentPage />)
    await act(async () => {
      await Promise.resolve()
    })

    expect(agentPageMocks.activeSessionOptions?.activeSessionId).toBe('session-created')
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

  it('creates a default empty session when history clears the active session', async () => {
    render(<AgentPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Open history records' }))
    fireEvent.click(screen.getByRole('button', { name: 'Clear history session' }))

    await waitFor(() =>
      expect(agentPageMocks.dataApiPost).toHaveBeenCalledWith('/agent-sessions', {
        body: {
          agentId: 'agent-a',
          name: '',
          workspace: { type: AGENT_WORKSPACE_TYPE.SYSTEM }
        }
      })
    )
    await waitFor(() => expect(agentPageMocks.activeSessionOptions?.activeSessionId).toBe('session-created'))
  })

  it('writes locate state into the current tab for a global-search session message', async () => {
    render(<AgentPage />)

    const sessionMessageHandler = vi
      .mocked(EventEmitter.on)
      .mock.calls.find(([eventName]) => eventName === EVENT_NAMES.GLOBAL_SEARCH_SELECT_AGENT_SESSION_MESSAGE)?.[1] as
      | ((payload: unknown) => void)
      | undefined

    act(() => {
      sessionMessageHandler?.({ sessionId: 'session-open', messageId: 'message-open', targetTabId: 'agent-tab' })
    })

    await waitFor(() => expect(agentPageMocks.activeSessionOptions?.activeSessionId).toBe('session-open'))
    expect(screen.getByTestId('locate-message-id')).toHaveTextContent('message-open')
  })

  it('opens the session pane when a global-search locate targets a session in the current tab', async () => {
    agentPageMocks.sessionDisplayMode = 'agent'
    agentPageMocks.classicLayoutRightPaneOpen = false

    render(<AgentPage />)

    expect(screen.getByTestId('session-pane-open')).toHaveTextContent('false')
    expect(agentPageMocks.setClassicLayoutRightPaneOpen).not.toHaveBeenCalledWith(true)

    const sessionMessageHandler = vi
      .mocked(EventEmitter.on)
      .mock.calls.find(([eventName]) => eventName === EVENT_NAMES.GLOBAL_SEARCH_SELECT_AGENT_SESSION_MESSAGE)?.[1] as
      | ((payload: unknown) => void)
      | undefined

    act(() => {
      sessionMessageHandler?.({ sessionId: 'session-locate', messageId: 'message-locate', targetTabId: 'agent-tab' })
    })

    expect(screen.getByTestId('session-pane-open')).toHaveTextContent('true')
  })

  it('ignores a global-search session message targeted at another tab', async () => {
    render(<AgentPage />)

    const sessionMessageHandler = vi
      .mocked(EventEmitter.on)
      .mock.calls.find(([eventName]) => eventName === EVENT_NAMES.GLOBAL_SEARCH_SELECT_AGENT_SESSION_MESSAGE)?.[1] as
      | ((payload: unknown) => void)
      | undefined

    act(() => {
      sessionMessageHandler?.({
        sessionId: 'session-open',
        messageId: 'message-open',
        targetTabId: 'other-agent-tab'
      })
    })

    await waitFor(() => expect(agentPageMocks.activeSessionOptions?.activeSessionId).toBe('session-initial'))
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
  it('temporarily hides and restores the agent sidebar for responsive auto-collapse without changing the user preference', async () => {
    agentPageMocks.showSidebar = true

    render(<AgentPage />)

    expect(screen.getByTestId('pane-open')).toHaveTextContent('true')

    fireEvent.click(screen.getByRole('button', { name: 'Auto collapse pane' }))

    await waitFor(() => expect(screen.getByTestId('pane-open')).toHaveTextContent('false'))
    expect(agentPageMocks.setShowSidebar).not.toHaveBeenCalled()
    expect(agentPageMocks.showSidebar).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Auto restore pane' }))

    await waitFor(() => expect(screen.getByTestId('pane-open')).toHaveTextContent('true'))
    expect(agentPageMocks.setShowSidebar).not.toHaveBeenCalled()
    expect(agentPageMocks.showSidebar).toBe(true)
  })

  it('keeps the agent sidebar open after selecting a session from the sidebar', async () => {
    agentPageMocks.showSidebar = true

    render(<AgentPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Select session next' }))

    await waitFor(() => expect(agentPageMocks.activeSessionOptions?.activeSessionId).toBe('session-next'))
    expect(agentPageMocks.setShowSidebar).not.toHaveBeenCalledWith(false)
    expect(screen.getByTestId('pane-open')).toHaveTextContent('true')
  })

  it('keeps detached session sidebar state local, default-closed, and fixed on the left', async () => {
    agentPageMocks.showSidebar = true
    agentPageMocks.sessionDisplayMode = 'agent'
    agentPageMocks.sessionPanePosition = 'right'

    const { unmount } = render(
      <WindowFrameProvider value={{ mode: 'window' }}>
        <AgentPage />
      </WindowFrameProvider>
    )

    expect(screen.getByTestId('pane-open')).toHaveTextContent('false')
    expect(screen.getByTestId('show-resource-list-controls')).toHaveTextContent('true')
    expect(screen.getByTestId('agent-side-panel')).toBeInTheDocument()
    expect(screen.queryByTestId('agent-resource-list')).not.toBeInTheDocument()
    expect(screen.queryByTestId('session-resource-panel')).not.toBeInTheDocument()
    expect(screen.queryByTestId('resource-pane-count')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Move sessions right' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open history records' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'agent.manage.title' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'chat.resource_view.menu.skill' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Toggle sidebar' }))
    expect(screen.getByTestId('pane-open')).toHaveTextContent('true')

    fireEvent.click(screen.getByRole('button', { name: 'Select session next' }))
    await waitFor(() => expect(agentPageMocks.activeSessionOptions?.activeSessionId).toBe('session-next'))
    expect(screen.getByTestId('pane-open')).toHaveTextContent('true')

    const shortcutHandler = vi
      .mocked(useCommandHandler)
      .mock.calls.filter(([command]) => command === 'app.sidebar.toggle')
      .at(-1)?.[1]

    act(() => {
      void shortcutHandler?.()
    })

    expect(screen.getByTestId('pane-open')).toHaveTextContent('false')
    expect(agentPageMocks.setShowSidebar).not.toHaveBeenCalled()

    unmount()
    render(
      <WindowFrameProvider value={{ mode: 'window' }}>
        <AgentPage />
      </WindowFrameProvider>
    )
    expect(screen.getByTestId('pane-open')).toHaveTextContent('false')
  })

  it('uses the compact minimum window width even while the agent sidebar is open', async () => {
    agentPageMocks.showSidebar = true

    render(<AgentPage />)

    await waitFor(() => {
      expect(ipcMocks.request).toHaveBeenCalledWith('window.main.set_minimum_size', {
        width: SECOND_MIN_WINDOW_WIDTH,
        height: MIN_WINDOW_HEIGHT
      })
    })
  })

  it('shows the missing-agent home composer by default when there are no agents', async () => {
    agentPageMocks.routeSearch = {}
    agentPageMocks.agents = []

    render(<AgentPage />)

    expect(screen.getByTestId('active-session')).toHaveTextContent('')
    await waitFor(() => expect(screen.getByTestId('missing-agent-selection')).toHaveTextContent('true'))
    expect(screen.getByTestId('agent-side-panel')).toBeInTheDocument()
    expect(agentPageMocks.dataApiPost).not.toHaveBeenCalled()
  })

  it('creates a real empty session after selecting an agent from missing-agent selection', async () => {
    agentPageMocks.routeSearch = {}
    agentPageMocks.agents = []
    agentPageMocks.dataApiPost.mockResolvedValue({
      ...agentPageMocks.persistedSession,
      id: 'session-missing-agent',
      agentId: 'agent-b',
      name: '',
      workspaceId: undefined,
      workspace: { type: 'system', name: 'No project', path: '' }
    })

    const { rerender } = render(<AgentPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Show missing agent selection' }))

    expect(screen.getByTestId('missing-agent-selection')).toHaveTextContent('true')
    expect(agentPageMocks.dataApiPost).not.toHaveBeenCalled()

    agentPageMocks.agents = [{ id: 'agent-b', model: 'model-b', name: 'Agent B' }]
    rerender(<AgentPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Select missing agent' }))

    await waitFor(() =>
      expect(agentPageMocks.dataApiPost).toHaveBeenCalledWith('/agent-sessions', {
        body: {
          agentId: 'agent-b',
          name: '',
          workspace: { type: AGENT_WORKSPACE_TYPE.SYSTEM }
        }
      })
    )
    await waitFor(() => expect(agentPageMocks.activeSessionOptions?.activeSessionId).toBe('session-missing-agent'))
    expect(screen.getByTestId('missing-agent-selection')).toHaveTextContent('false')
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

  it('creates a first-launch empty session with the remembered agent and workspace', async () => {
    agentPageMocks.routeSearch = {}
    agentPageMocks.agents = [
      { id: 'agent-a', model: 'model-a', name: 'Agent A' },
      { id: 'agent-b', model: 'model-b', name: 'Agent B' }
    ]
    agentPageMocks.lastUsedAgentId = 'agent-b'
    agentPageMocks.lastUsedWorkspaceId = 'workspace-remembered'
    agentPageMocks.dataApiPost.mockResolvedValue({
      ...agentPageMocks.persistedSession,
      id: 'session-remembered',
      agentId: 'agent-b',
      name: '',
      workspaceId: 'workspace-remembered',
      workspace: { ...agentPageMocks.workspaceNext, id: 'workspace-remembered' }
    })

    render(<AgentPage />)

    await waitFor(() =>
      expect(agentPageMocks.dataApiPost).toHaveBeenCalledWith('/agent-sessions', {
        body: {
          agentId: 'agent-b',
          name: '',
          workspace: { type: AGENT_WORKSPACE_TYPE.USER, workspaceId: 'workspace-remembered' }
        }
      })
    )
    expect(agentPageMocks.dataApiGet).toHaveBeenCalledWith('/agent-workspaces/workspace-remembered')
    await waitFor(() => expect(agentPageMocks.activeSessionOptions?.activeSessionId).toBe('session-remembered'))
    expect(screen.getByTestId('active-session')).toHaveTextContent('session-remembered')
    expect(agentPageMocks.setLastUsedWorkspaceId).toHaveBeenCalledWith('workspace-remembered')
  })

  it('reuses a first-launch empty session from the shared session source', async () => {
    agentPageMocks.routeSearch = {}
    agentPageMocks.agents = [
      { id: 'agent-a', model: 'model-a', name: 'Agent A' },
      { id: 'agent-b', model: 'model-b', name: 'Agent B' }
    ]
    agentPageMocks.lastUsedAgentId = 'agent-b'
    agentPageMocks.classicLayoutSessions = [
      {
        id: 'session-empty-first-launch',
        agentId: 'agent-b',
        name: '',
        isNameManuallyEdited: false,
        createdAt: '2026-01-04T00:00:00.000Z',
        updatedAt: '2026-01-04T00:00:00.000Z',
        workspace: { type: 'system' }
      }
    ]

    render(<AgentPage />)

    await waitFor(() => expect(agentPageMocks.activeSessionOptions?.activeSessionId).toBe('session-empty-first-launch'))
    expect(screen.getByTestId('active-session')).toHaveTextContent('session-empty-first-launch')
    expect(agentPageMocks.dataApiPost).not.toHaveBeenCalled()
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
