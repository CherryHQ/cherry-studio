import { cacheService } from '@renderer/data/CacheService'
import type * as UseCacheModule from '@renderer/data/hooks/useCache'
import type { AgentSessionEntity, AgentSessionListItem } from '@shared/data/api/schemas/agentSessions'
import type { AgentEntity } from '@shared/data/types/agent'
import { MockCacheUtils } from '@test-mocks/renderer/CacheService'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type VirtualListRenderRow = (item: unknown, index: number) => ReactNode

const hookMocks = vi.hoisted(() => ({
  deleteSession: vi.fn(),
  deleteSessions: vi.fn(),
  loadMore: vi.fn(),
  refetch: vi.fn(),
  reload: vi.fn(),
  promptShow: vi.fn(),
  togglePin: vi.fn(),
  updateSession: vi.fn(),
  openConversationTab: vi.fn(),
  useAgents: vi.fn(),
  useAgentSessionStats: vi.fn(),
  useAgentSessionsByIds: vi.fn(),
  useTopics: vi.fn(),
  useAssistants: vi.fn(),
  useDataApiQuery: vi.fn(),
  useMultiplePreferences: vi.fn(),
  usePins: vi.fn(),
  useSessions: vi.fn(),
  useUpdateSession: vi.fn(),
  virtualListRenderRows: [] as VirtualListRenderRow[]
}))

vi.mock('@cherrystudio/ui', async () => {
  const { MockCherrystudioUI } = await import('@test-mocks/renderer/CherrystudioUI')
  return MockCherrystudioUI
})

vi.mock('@renderer/data/CacheService', async () => {
  const { MockCacheService } = await import('@test-mocks/renderer/CacheService')
  return MockCacheService
})

vi.mock('@renderer/data/hooks/useCache', async (importOriginal) => {
  const { MockUseCache } = await import('@test-mocks/renderer/useCache')
  const actual = await importOriginal<typeof UseCacheModule>()
  return {
    ...MockUseCache,
    // Stream statuses are seeded into (and updated through) this suite's
    // CacheService mock — run the real selector over that store so status
    // updates stay reactive.
    useSharedCacheSelector: actual.useSharedCacheSelector
  }
})

vi.mock('@renderer/components/VirtualList', () => ({
  DynamicVirtualList: <T,>({
    children,
    header,
    list,
    role
  }: {
    children: (item: T, index: number) => ReactNode
    header?: ReactNode
    list: T[]
    role?: string
  }) => {
    hookMocks.virtualListRenderRows.push(children as VirtualListRenderRow)

    return (
      <div data-testid="history-virtual-list" role={role}>
        {header}
        {list.map((item, index) => (
          <div key={(item as { id?: string }).id ?? index}>{children(item, index)}</div>
        ))}
      </div>
    )
  }
}))

vi.mock('@renderer/components/resourceCatalog/dialogs/edit', () => ({
  ResourceEditDialogHost: ({ target }: { target: { kind: string; id: string } | null }) =>
    target ? <div data-testid="resource-edit-dialog-host" data-kind={target.kind} data-id={target.id} /> : null
}))

vi.mock('@renderer/components/resourceCatalog/selectors', () => ({
  AgentSelector: ({ additionalItems = [], onChange, trigger, value }: any) => {
    const agents = hookMocks.useAgents()?.agents ?? []
    const items = [...agents.map((agent: AgentEntity) => ({ id: agent.id, name: agent.name })), ...additionalItems]

    return (
      <div>
        {trigger}
        {items.map((item: { id: string; name: string }) => (
          <button type="button" key={item.id} aria-pressed={item.id === value} onClick={() => onChange(item.id)}>
            {item.name}
          </button>
        ))}
      </div>
    )
  },
  AssistantSelector: ({ additionalItems = [], onChange, trigger, value }: any) => {
    const assistants = hookMocks.useAssistants()?.assistants ?? []
    const items = [
      ...assistants.map((assistant: { id: string; name: string }) => ({ id: assistant.id, name: assistant.name })),
      ...additionalItems
    ]

    return (
      <div>
        {trigger}
        {items.map((item: { id: string; name: string }) => (
          <button type="button" key={item.id} aria-pressed={item.id === value} onClick={() => onChange(item.id)}>
            {item.name}
          </button>
        ))}
      </div>
    )
  }
}))

vi.mock('@renderer/data/hooks/usePreference', () => ({
  usePreference: () => ['cherry', () => {}],
  useMultiplePreferences: hookMocks.useMultiplePreferences
}))

vi.mock('@renderer/data/hooks/useDataApi', () => ({
  useQuery: hookMocks.useDataApiQuery
}))

vi.mock('@renderer/hooks/agent/useAgent', () => ({
  useAgents: hookMocks.useAgents
}))

vi.mock('@renderer/hooks/agent/useSession', () => ({
  useAgentSessionStats: hookMocks.useAgentSessionStats,
  useAgentSessionsByIds: hookMocks.useAgentSessionsByIds,
  useSessions: hookMocks.useSessions,
  useUpdateSession: hookMocks.useUpdateSession
}))

vi.mock('@renderer/hooks/useDebouncedValue', () => ({
  useDebouncedValue: (value: unknown) => value
}))

vi.mock('@renderer/hooks/useAssistant', () => ({
  useAssistants: hookMocks.useAssistants
}))

vi.mock('@renderer/hooks/useConversationNavigation', () => {
  const navigation = { openConversationTab: hookMocks.openConversationTab }
  return { useConversationNavigation: () => navigation }
})

vi.mock('@renderer/hooks/useTopic', () => ({
  finishTopicRenaming: vi.fn(),
  getTopicMessages: vi.fn().mockResolvedValue([]),
  mapApiTopicToRendererTopic: (topic: { id: string }) => topic,
  useTopics: hookMocks.useTopics,
  useTopicMutations: () => ({
    deleteTopic: vi.fn(),
    updateTopic: vi.fn()
  }),
  startTopicRenaming: vi.fn()
}))

vi.mock('@renderer/hooks/usePins', () => ({
  usePins: hookMocks.usePins
}))

vi.mock('@renderer/hooks/useNotesSettings', () => ({
  useNotesSettings: () => ({ notesPath: '/notes' })
}))

vi.mock('@renderer/utils/aiGeneration', () => ({
  fetchMessagesSummary: vi.fn().mockResolvedValue({ text: 'Auto title' })
}))

vi.mock('@renderer/services/EventService', () => ({
  EVENT_NAMES: {
    CLEAR_MESSAGES: 'CLEAR_MESSAGES',
    COPY_TOPIC_IMAGE: 'COPY_TOPIC_IMAGE',
    EXPORT_TOPIC_IMAGE: 'EXPORT_TOPIC_IMAGE'
  },
  EventEmitter: {
    emit: vi.fn()
  }
}))

vi.mock('@renderer/components/ObsidianExportPopup', () => ({
  default: { show: vi.fn() }
}))

vi.mock('@renderer/components/popups/PromptPopup', () => ({
  default: { show: hookMocks.promptShow }
}))

vi.mock('@renderer/components/SaveToKnowledgePopup', () => ({
  default: { showForTopic: vi.fn() }
}))

// The confirm-and-run dialog itself is covered by its own unit test; here we just let it run
// the gated action (as if the user confirmed).
const { confirmActionShow } = vi.hoisted(() => ({
  confirmActionShow: vi.fn(async (options?: { action?: () => unknown }) => {
    await options?.action?.()
    return true
  })
}))
vi.mock('@renderer/components/popups/ConfirmActionPopup', () => ({ default: { show: confirmActionShow } }))

vi.mock('@renderer/services/copy', () => ({
  copyTopicAsMarkdown: vi.fn(),
  copyTopicAsPlainText: vi.fn()
}))

vi.mock('@renderer/services/ExportService', () => ({
  exportMarkdownToJoplin: vi.fn(),
  exportMarkdownToSiyuan: vi.fn(),
  exportMarkdownToYuque: vi.fn(),
  exportTopicAsMarkdown: vi.fn(),
  exportTopicToNotes: vi.fn(),
  exportTopicToNotion: vi.fn(),
  topicToMarkdown: vi.fn().mockResolvedValue('# topic')
}))

vi.mock('react-i18next', () => {
  const translation = {
    t: (key: string, fallbackOrOptions?: string | Record<string, unknown>, maybeOptions?: Record<string, unknown>) => {
      const fallback = typeof fallbackOrOptions === 'string' ? fallbackOrOptions : undefined
      const options = typeof fallbackOrOptions === 'object' ? fallbackOrOptions : maybeOptions
      const labels: Record<string, string> = {
        'agent.session.display.workdir': 'Work directory',
        'agent.session.group.no_workdir': 'No work directory',
        'agent.session.group.unknown_agent': 'Unknown agent',
        'agent.session.delete.content': 'Delete this task?',
        'agent.session.delete.title': 'Delete task',
        'agent.session.edit.title': 'Edit task name',
        'agent.session.pin.title': 'Pin task',
        'agent.session.update.error.failed': 'Failed to update task',
        'agent.session.unpin.title': 'Unpin task',
        'agent.edit.title': 'Edit Agent',
        'common.agent': 'Agent',
        'common.all': 'All',
        'common.back': 'Back',
        'common.cancel': 'Cancel',
        'common.close': 'Close',
        'common.delete': 'Delete',
        'common.error': 'Error',
        'common.loading': 'Loading...',
        'common.more': 'More',
        'common.name': 'Name',
        'common.rename': 'Rename',
        'common.required_field': 'Required field',
        'common.retry': 'Retry',
        'common.save': 'Save',
        'common.saved': 'Saved',
        'common.select_all': 'Select all',
        'common.unknown': 'Unknown',
        'common.unnamed': 'Untitled',
        'history.records.bulkDelete': 'Batch Delete',
        'history.records.bulkDeleteSessions.description': 'Delete {{count}} selected task(s)?',
        'history.records.bulkDeleteSessions.title': 'Delete selected tasks',
        'history.records.agentTitle': 'Agent history',
        'history.records.empty.sessionsDescription': 'No tasks for the current filters.',
        'history.records.empty.sessionsTitle': 'No tasks',
        'history.records.loading.sessionsDescription': 'Loading task list.',
        'history.records.loading.sessionsTitle': 'Loading tasks',
        'history.records.searchSession': 'Search tasks...',
        'history.records.shortTitle': 'History',
        'history.records.clearSearch': 'Clear search',
        'history.records.filter.statusLabel': 'Status',
        'history.records.status.completed': 'Completed',
        'history.records.status.failed': 'Failed',
        'history.records.status.running': 'Running',
        'history.records.table.actions': 'Actions',
        'history.records.table.session': 'Task',
        'history.records.table.time': 'Time',
        'selector.common.pin': 'Pin',
        'selector.common.unpin': 'Unpin',
        'selector.common.pinned_title': 'Pinned'
      }
      const template = labels[key] ?? fallback ?? key
      return template.replace('{{count}}', String(options?.count ?? ''))
    }
  }

  return {
    initReactI18next: {
      init: vi.fn(),
      type: '3rdParty'
    },
    useTranslation: () => translation
  }
})

import HistoryRecordsView from '../HistoryRecordsView'

function flushAnimationFrame() {
  return new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
}

function flushCommandMenuAction() {
  return flushAnimationFrame()
}

function makeWorkspace(path: string): NonNullable<AgentSessionEntity['workspace']> {
  return {
    id: `ws-${path}`,
    name: path,
    path,
    type: 'user',
    orderKey: 'a',
    createdAt: '2026-05-13T08:00:00.000Z',
    updatedAt: '2026-05-14T08:00:00.000Z'
  }
}

function createSession(overrides: Partial<AgentSessionListItem> = {}): AgentSessionListItem {
  return {
    id: 'session-alpha',
    agentId: 'agent-alpha',
    name: 'Alpha session',
    description: 'Planning notes',
    workspaceId: 'ws-/Users/jd/project-a',
    workspace: makeWorkspace('/Users/jd/project-a'),
    orderKey: 'a',
    pinId: null,
    pinned: false,
    createdAt: '2026-05-13T08:00:00.000Z',
    updatedAt: '2026-05-14T08:00:00.000Z',
    ...overrides,
    isNameManuallyEdited: overrides.isNameManuallyEdited ?? false
  }
}

function createAgent(overrides: Partial<AgentEntity> = {}): AgentEntity {
  return {
    id: 'agent-alpha',
    type: 'claude-code',
    model: 'provider-alpha::model-alpha',
    modelName: 'Claude',
    name: 'Alpha agent',
    configuration: { avatar: 'A' },
    orderKey: 'k',
    createdAt: '2026-05-13T08:00:00.000Z',
    updatedAt: '2026-05-14T08:00:00.000Z',
    ...overrides
  }
}

function setupAgentHistory({
  activeRecordId = null,
  agents = [
    createAgent(),
    createAgent({ id: 'agent-beta', name: 'Beta agent', configuration: { avatar: 'B' } }),
    createAgent({ id: 'agent-gamma', name: 'Gamma agent', configuration: { avatar: 'G' } })
  ],
  sessions = [
    createSession(),
    createSession({
      id: 'session-beta',
      agentId: 'agent-beta',
      name: 'Beta session',
      description: 'Runbook audit',
      workspace: makeWorkspace('/Users/jd/project-b'),
      orderKey: 'b'
    })
  ],
  pinIdBySessionId = new Map<string, string>(),
  hasMore = false,
  isLoadingMore = false,
  sourceError
}: {
  activeRecordId?: string | null
  agents?: AgentEntity[]
  hasMore?: boolean
  isLoadingMore?: boolean
  pinIdBySessionId?: Map<string, string>
  sessions?: AgentSessionListItem[]
  sourceError?: Error
} = {}) {
  hookMocks.useAgents.mockReturnValue({ agents, error: undefined, isLoading: false })
  const projectedSessions = sessions.map((session) => {
    const pinId = pinIdBySessionId.get(session.id) ?? session.pinId
    return pinId ? { ...session, pinId, pinned: true } : { ...session, pinId: null, pinned: false }
  })
  const filterSessions = (
    ownerScope?: string,
    q?: string,
    ids?: readonly string[],
    pinned?: boolean,
    sortBy: 'updatedAt' | 'orderKey' = 'updatedAt'
  ) => {
    const normalizedQuery = q?.trim().toLowerCase()
    return projectedSessions
      .filter((session) => {
        if (ids && !ids.includes(session.id)) return false
        if (pinned !== undefined && session.pinned !== pinned) return false
        if (ownerScope === 'unlinked') return session.agentId === null
        if (ownerScope && session.agentId !== ownerScope) return false
        if (!normalizedQuery) return true
        const agentName = session.agentId ? agents.find((agent) => agent.id === session.agentId)?.name : undefined
        return [session.name, session.description, agentName].some((value) =>
          value?.toLowerCase().includes(normalizedQuery)
        )
      })
      .sort((left, right) => {
        if (sortBy === 'updatedAt') {
          return Date.parse(right.updatedAt) - Date.parse(left.updatedAt) || left.id.localeCompare(right.id)
        }
        return left.orderKey.localeCompare(right.orderKey) || left.id.localeCompare(right.id)
      })
  }
  hookMocks.useSessions.mockImplementation((ownerScope?: string, options?: any) => ({
    sessions: filterSessions(ownerScope, options?.q, undefined, options?.pinned, options?.sortBy),
    pages: [{ items: filterSessions(ownerScope, options?.q, undefined, options?.pinned, options?.sortBy) }],
    pinIdBySessionId,
    error: sourceError,
    hasMore: options?.pinned ? false : hasMore,
    isLoading: false,
    isLoadingMore,
    loadMore: hookMocks.loadMore,
    reload: hookMocks.reload,
    deleteSession: hookMocks.deleteSession,
    deleteSessions: hookMocks.deleteSessions,
    togglePin: hookMocks.togglePin
  }))
  hookMocks.useAgentSessionsByIds.mockImplementation((ids: readonly string[], options?: any) => ({
    sessions: filterSessions(options?.agentId, options?.q, ids, options?.pinned, options?.sortBy),
    error: undefined,
    isLoading: false,
    isRefreshing: false,
    refetch: hookMocks.refetch
  }))
  hookMocks.useAgentSessionStats.mockReturnValue({
    stats: {
      total: sessions.length,
      pinnedCount: pinIdBySessionId.size,
      byAgent: Array.from(
        sessions.reduce((counts, session) => {
          counts.set(session.agentId, (counts.get(session.agentId) ?? 0) + 1)
          return counts
        }, new Map<string | null, number>())
      ).map(([agentId, count]) => ({ agentId, count, pinnedCount: 0 }))
    },
    error: undefined,
    isLoading: false
  })

  const onClose = vi.fn()
  const onRecordSelect = vi.fn()
  render(
    <HistoryRecordsView
      mode="agent"
      open
      activeRecordId={activeRecordId}
      onClose={onClose}
      onRecordSelect={onRecordSelect}
    />
  )

  return { onClose, onRecordSelect }
}

describe('HistoryRecordsView agent mode', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="agent-page"></div><div id="home-page"></div>'
    MockCacheUtils.resetMocks()
    confirmActionShow.mockClear()
    hookMocks.deleteSession.mockReset()
    hookMocks.deleteSession.mockResolvedValue(true)
    hookMocks.deleteSessions.mockReset()
    hookMocks.deleteSessions.mockResolvedValue({ deletedIds: ['session-alpha'], deletedCount: 1 })
    hookMocks.loadMore.mockReset()
    hookMocks.refetch.mockReset()
    hookMocks.refetch.mockResolvedValue(undefined)
    hookMocks.reload.mockReset()
    hookMocks.reload.mockResolvedValue(undefined)
    hookMocks.promptShow.mockReset()
    hookMocks.togglePin.mockReset()
    hookMocks.togglePin.mockResolvedValue(undefined)
    hookMocks.updateSession.mockReset()
    hookMocks.updateSession.mockResolvedValue(createSession({ name: 'Renamed session' }))
    hookMocks.useAgents.mockReset()
    hookMocks.useAgentSessionStats.mockReset()
    hookMocks.useAgentSessionsByIds.mockReset()
    hookMocks.useTopics.mockReset()
    hookMocks.useAssistants.mockReset()
    hookMocks.openConversationTab.mockReset()
    hookMocks.openConversationTab.mockReturnValue('new-history-session-tab')
    hookMocks.useDataApiQuery.mockReset()
    hookMocks.useDataApiQuery.mockReturnValue({ data: [], error: undefined, isLoading: false })
    hookMocks.useMultiplePreferences.mockReset()
    hookMocks.useMultiplePreferences.mockReturnValue([
      {
        docx: true,
        image: true,
        joplin: true,
        markdown: true,
        markdown_reason: true,
        notes: true,
        notion: true,
        obsidian: true,
        plain_text: true,
        siyuan: true,
        yuque: true
      }
    ])
    hookMocks.usePins.mockReset()
    hookMocks.usePins.mockReturnValue({ pinnedIds: [], togglePin: vi.fn() })
    hookMocks.useSessions.mockReset()
    hookMocks.useUpdateSession.mockReset()
    hookMocks.useUpdateSession.mockReturnValue({ updateSession: hookMocks.updateSession })
    hookMocks.virtualListRenderRows.length = 0
  })

  it('renders sessions from the existing agent session list data', () => {
    const { onClose, onRecordSelect } = setupAgentHistory({
      pinIdBySessionId: new Map([['session-alpha', 'pin-session-alpha']])
    })

    expect(hookMocks.useSessions).toHaveBeenCalledWith(undefined, {
      enabled: true,
      keepPreviousData: false,
      pageSize: 50,
      pinned: true,
      q: '',
      searchScope: 'full',
      sortBy: 'updatedAt'
    })
    expect(hookMocks.useSessions).toHaveBeenCalledWith(undefined, {
      enabled: true,
      keepPreviousData: false,
      pageSize: 50,
      pinned: false,
      q: '',
      searchScope: 'full',
      sortBy: 'updatedAt'
    })
    expect(hookMocks.useTopics).not.toHaveBeenCalled()
    expect(hookMocks.useAssistants).not.toHaveBeenCalled()
    expect(screen.getByRole('region', { name: 'History' })).toBeInTheDocument()
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getByTestId('history-virtual-list')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()
    const pinButton = screen.getAllByTestId('history-pin-button')[0]
    expect(pinButton).toHaveAccessibleName('Unpin')
    fireEvent.click(pinButton)
    expect(hookMocks.togglePin).toHaveBeenCalledWith('session-alpha', 'pin-session-alpha')
    expect(onRecordSelect).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.queryByText('Messages')).not.toBeInTheDocument()
    expect(screen.queryByText('消息')).not.toBeInTheDocument()
    expect(screen.getByText('Alpha session')).toBeInTheDocument()
    // Rows are single-line: the session description is searchable but not rendered.
    expect(screen.queryByText('Planning notes')).not.toBeInTheDocument()
    expect(screen.getAllByText('Agent').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Alpha agent').length).toBeGreaterThanOrEqual(1)
    const alphaRow = screen.getByText('Alpha session').closest('[role="row"]') as HTMLElement
    const alphaCells = within(alphaRow).getAllByRole('cell')
    expect(within(alphaCells[1]).getAllByText('A').length).toBeGreaterThan(0)
    expect(within(alphaCells[1]).getByText('Alpha agent')).toBeInTheDocument()
    expect(within(alphaCells[2]).queryByText('A')).not.toBeInTheDocument()
    const headerCells = screen.getAllByRole('columnheader')
    expect(headerCells[1]).toHaveTextContent('Agent')
    expect(headerCells[2]).toHaveTextContent('Task')
    expect(screen.getByText('Beta session')).toBeInTheDocument()
    expect(screen.getAllByText('Beta agent').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByRole('button', { name: /Gamma agent/ })).toBeInTheDocument()
    expect(screen.queryByText('Agent placeholder')).not.toBeInTheDocument()
    expect(screen.queryByTestId('history-open-button')).not.toBeInTheDocument()

    fireEvent.click(alphaRow)

    expect(onRecordSelect).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Alpha session' }))

    expect(hookMocks.openConversationTab).toHaveBeenCalledWith('session-alpha', 'Alpha session', { forceNew: true })
    expect(onRecordSelect).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('orders search, filters, and bulk actions across the toolbar', () => {
    setupAgentHistory()

    const searchInput = screen.getByRole('searchbox', { name: 'Search tasks...' })
    const sourceFilter = screen.getByRole('button', { name: 'history.records.filter.selectAgent' })
    const statusFilter = screen.getByRole('button', { name: 'Status' })
    const bulkDeleteButton = screen.getByRole('button', { name: 'Batch Delete' })

    expect(searchInput.compareDocumentPosition(sourceFilter)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(sourceFilter.compareDocumentPosition(statusFilter)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(statusFilter.compareDocumentPosition(bulkDeleteButton)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })

  it('filters sessions by selected agent source', () => {
    setupAgentHistory()

    fireEvent.click(screen.getByRole('button', { name: /Beta agent/ }))

    expect(screen.queryByText('Alpha session')).not.toBeInTheDocument()
    expect(screen.getByText('Beta session')).toBeInTheDocument()
  })

  it('orders agent sources and selected agent rows by agent order', () => {
    setupAgentHistory({
      agents: [
        createAgent({ id: 'agent-beta', name: 'Beta agent', configuration: { avatar: 'B' } }),
        createAgent({ id: 'agent-alpha', name: 'Alpha agent', configuration: { avatar: 'A' } }),
        createAgent({ id: 'agent-gamma', name: 'Gamma agent', configuration: { avatar: 'G' } })
      ],
      sessions: [
        createSession({
          id: 'session-beta',
          agentId: 'agent-beta',
          name: 'Beta session',
          workspaceId: 'ws-b',
          workspace: makeWorkspace('/Users/jd/project-b'),
          orderKey: 'a'
        }),
        createSession({
          id: 'session-alpha-b',
          name: 'Alpha B',
          workspaceId: 'ws-a',
          workspace: makeWorkspace('/Users/jd/project-a'),
          orderKey: 'b'
        }),
        createSession({
          id: 'session-alpha-a',
          name: 'Alpha A',
          workspaceId: 'ws-a',
          workspace: makeWorkspace('/Users/jd/project-a'),
          orderKey: 'a'
        })
      ]
    })

    expect(hookMocks.useDataApiQuery).not.toHaveBeenCalled()
    const betaSource = screen.getByRole('button', { name: /Beta agent/ })
    const alphaSource = screen.getByRole('button', { name: /Alpha agent/ })
    expect(Boolean(betaSource.compareDocumentPosition(alphaSource) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true)

    fireEvent.click(alphaSource)

    expect(hookMocks.useSessions).toHaveBeenCalledWith(
      'agent-alpha',
      expect.objectContaining({
        pinned: false,
        sortBy: 'updatedAt'
      })
    )
    const alphaA = screen.getByText('Alpha A').closest('[role="row"]') as HTMLElement
    const alphaB = screen.getByText('Alpha B').closest('[role="row"]') as HTMLElement
    expect(Boolean(alphaA.compareDocumentPosition(alphaB) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true)
  })

  it('restores the agent status selector and filters by existing stream status', () => {
    MockCacheUtils.setInitialState({
      shared: [['agent.session.stream.status_ids', { activeIds: ['session-beta'], failedIds: [] }]]
    })

    setupAgentHistory()

    expect(screen.getByRole('button', { name: 'Status' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Running$/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Completed$/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Failed$/ })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /^Running$/ }))

    expect(hookMocks.useAgentSessionsByIds).toHaveBeenCalledWith(
      ['session-beta'],
      expect.objectContaining({
        enabled: true,
        searchScope: 'full'
      })
    )
    const runtimeSessionOptions = hookMocks.useAgentSessionsByIds.mock.calls.at(-1)?.[1]
    expect(runtimeSessionOptions).not.toHaveProperty('pinned')
    expect(screen.queryByText('Alpha session')).not.toBeInTheDocument()
    expect(screen.getByText('Beta session')).toBeInTheDocument()
  })

  it('filters completed and failed sessions by stream status', () => {
    MockCacheUtils.setInitialState({
      shared: [['agent.session.stream.status_ids', { activeIds: [], failedIds: ['session-beta'] }]]
    })

    setupAgentHistory()

    expect(screen.getByRole('button', { name: /^Running$/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Completed$/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Failed$/ })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /^Failed$/ }))

    expect(screen.queryByText('Alpha session')).not.toBeInTheDocument()
    expect(screen.getByText('Beta session')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /^Completed$/ }))

    expect(screen.getByText('Alpha session')).toBeInTheDocument()
    expect(screen.queryByText('Beta session')).not.toBeInTheDocument()
  })

  it('treats persisted sessions as completed when runtime status indexes are empty after restart', () => {
    MockCacheUtils.setInitialState({
      shared: [['agent.session.stream.status_ids', { activeIds: [], failedIds: [] }]]
    })

    setupAgentHistory()
    fireEvent.click(screen.getByRole('button', { name: /^Completed$/ }))

    expect(screen.getByText('Alpha session')).toBeInTheDocument()
    expect(screen.getByText('Beta session')).toBeInTheDocument()
  })

  it('continues paging when completed filtering consumes the loaded page', async () => {
    MockCacheUtils.setInitialState({
      shared: [['agent.session.stream.status_ids', { activeIds: ['session-alpha', 'session-beta'], failedIds: [] }]]
    })

    setupAgentHistory({ hasMore: true })
    fireEvent.click(screen.getByRole('button', { name: /^Completed$/ }))

    await waitFor(() => expect(hookMocks.loadMore).toHaveBeenCalled())
  })

  it('renders list errors with a retry action', () => {
    setupAgentHistory({ sourceError: new Error('History request failed') })

    expect(screen.getByText('History request failed')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    expect(hookMocks.reload).toHaveBeenCalledTimes(2)
  })

  it('renders a loading-more state without replacing loaded rows', () => {
    setupAgentHistory({ isLoadingMore: true })

    expect(screen.getByText('Alpha session')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Loading...')
  })

  it('keeps the virtual row renderer stable across stream status updates', () => {
    setupAgentHistory()
    const initialRenderRow = hookMocks.virtualListRenderRows.at(-1)

    act(() => {
      cacheService.setShared('agent.session.stream.status_ids', { activeIds: ['session-beta'], failedIds: [] })
    })

    expect(hookMocks.virtualListRenderRows.at(-1)).toBe(initialRenderRow)
  })

  it('groups sessions with a missing agent under the unknown-agent source', () => {
    setupAgentHistory({
      sessions: [
        createSession(),
        createSession({
          id: 'session-missing-agent',
          agentId: null,
          name: 'Missing agent session',
          workspaceId: 'ws-missing',
          workspace: makeWorkspace('/Users/jd/project-missing'),
          orderKey: 'b'
        })
      ]
    })

    fireEvent.click(screen.getByRole('button', { name: /Unknown agent/ }))

    expect(screen.queryByText('Alpha session')).not.toBeInTheDocument()
    expect(screen.getByText('Missing agent session')).toBeInTheDocument()
    expect(screen.getByText('Unknown')).toBeInTheDocument()
  })

  it('searches locally by session name, description, and agent name', () => {
    setupAgentHistory()

    fireEvent.change(screen.getByPlaceholderText('Search tasks...'), { target: { value: 'runbook' } })

    expect(screen.queryByText('Alpha session')).not.toBeInTheDocument()
    expect(screen.getByText('Beta session')).toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('Search tasks...'), { target: { value: 'alpha agent' } })

    expect(screen.getByText('Alpha session')).toBeInTheDocument()
    expect(screen.queryByText('Beta session')).not.toBeInTheDocument()
  })

  it('activates a session when the history title is clicked', () => {
    const { onClose, onRecordSelect } = setupAgentHistory()
    const betaRow = screen.getByText('Beta session').closest('[role="row"]')

    expect(betaRow).not.toBeNull()
    fireEvent.click(betaRow as HTMLElement)

    expect(onRecordSelect).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Beta session' }))

    expect(hookMocks.openConversationTab).toHaveBeenCalledWith('session-beta', 'Beta session', { forceNew: true })
    expect(onRecordSelect).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('falls back to record selection when no conversation tab context exists', () => {
    const { onClose, onRecordSelect } = setupAgentHistory()
    hookMocks.openConversationTab.mockReturnValueOnce(undefined)

    fireEvent.click(screen.getByRole('button', { name: 'Alpha session' }))

    expect(hookMocks.openConversationTab).toHaveBeenCalledWith('session-alpha', 'Alpha session', { forceNew: true })
    expect(onRecordSelect).toHaveBeenCalledWith('session-alpha')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not activate a session when the selection checkbox is clicked', () => {
    const { onClose, onRecordSelect } = setupAgentHistory()
    const betaRow = screen.getByText('Beta session').closest('[role="row"]')

    expect(betaRow).not.toBeNull()
    fireEvent.click(within(betaRow as HTMLElement).getByRole('checkbox'))

    expect(onRecordSelect).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('bulk deletes selected sessions from the query toolbar', async () => {
    hookMocks.deleteSessions.mockResolvedValueOnce({
      deletedIds: ['session-alpha', 'session-beta'],
      deletedCount: 2
    })
    const { onClose, onRecordSelect } = setupAgentHistory({
      activeRecordId: 'session-alpha',
      sessions: [
        createSession(),
        createSession({
          id: 'session-beta',
          agentId: 'agent-beta',
          name: 'Beta session',
          workspaceId: 'ws-b',
          workspace: makeWorkspace('/Users/jd/project-b'),
          orderKey: 'b'
        }),
        createSession({
          id: 'session-gamma',
          agentId: 'agent-gamma',
          name: 'Gamma session',
          workspaceId: 'ws-c',
          workspace: makeWorkspace('/Users/jd/project-c'),
          orderKey: 'c'
        })
      ]
    })

    const alphaRow = screen.getByText('Alpha session').closest('[role="row"]') as HTMLElement
    const betaRow = screen.getByText('Beta session').closest('[role="row"]') as HTMLElement
    fireEvent.click(within(alphaRow).getByRole('checkbox'))
    fireEvent.click(within(betaRow).getByRole('checkbox'))

    fireEvent.click(screen.getByRole('button', { name: /Batch Delete/ }))

    expect(screen.getByRole('dialog')).toHaveTextContent('Delete selected tasks')
    expect(screen.getByRole('dialog')).toHaveTextContent('Delete 2 selected task(s)?')
    expect(hookMocks.deleteSessions).not.toHaveBeenCalled()

    await act(async () => {
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }))
    })

    expect(hookMocks.deleteSessions).toHaveBeenCalledWith(['session-alpha', 'session-beta'])
    expect(onRecordSelect).toHaveBeenCalledWith('session-gamma')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('skips pinned sessions when bulk deleting from the query toolbar', async () => {
    hookMocks.deleteSessions.mockResolvedValueOnce({
      deletedIds: ['session-alpha'],
      deletedCount: 1
    })
    const { onClose, onRecordSelect } = setupAgentHistory({
      sessions: [
        createSession(),
        createSession({
          id: 'session-beta',
          agentId: 'agent-beta',
          name: 'Beta session',
          workspaceId: 'ws-b',
          workspace: makeWorkspace('/Users/jd/project-b'),
          orderKey: 'b'
        })
      ],
      pinIdBySessionId: new Map([['session-beta', 'pin-session-beta']])
    })

    const alphaRow = screen.getByText('Alpha session').closest('[role="row"]') as HTMLElement
    const betaRow = screen.getByText('Beta session').closest('[role="row"]') as HTMLElement
    fireEvent.click(within(alphaRow).getByRole('checkbox'))
    fireEvent.click(within(betaRow).getByRole('checkbox'))

    fireEvent.click(screen.getByRole('button', { name: /Batch Delete/ }))

    expect(screen.getByRole('dialog')).toHaveTextContent('Delete 1 selected task(s)?')

    await act(async () => {
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }))
    })

    expect(hookMocks.deleteSessions).toHaveBeenCalledWith(['session-alpha'])
    expect(onRecordSelect).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('disables bulk delete when only pinned sessions are selected', () => {
    setupAgentHistory({
      pinIdBySessionId: new Map([['session-alpha', 'pin-session-alpha']])
    })

    const alphaRow = screen.getByText('Alpha session').closest('[role="row"]') as HTMLElement
    fireEvent.click(within(alphaRow).getByRole('checkbox'))

    expect(screen.getByRole('button', { name: 'Batch Delete' })).toBeDisabled()
    expect(hookMocks.deleteSessions).not.toHaveBeenCalled()
  })

  it('excludes pinned sessions from row selection and select all', () => {
    setupAgentHistory({
      sessions: [
        createSession(),
        createSession({
          id: 'session-beta',
          agentId: 'agent-beta',
          name: 'Beta session',
          workspaceId: 'ws-b',
          workspace: makeWorkspace('/Users/jd/project-b'),
          orderKey: 'b'
        }),
        createSession({
          id: 'session-gamma',
          agentId: 'agent-gamma',
          name: 'Gamma session',
          workspaceId: 'ws-c',
          workspace: makeWorkspace('/Users/jd/project-c'),
          orderKey: 'c'
        })
      ],
      pinIdBySessionId: new Map([['session-beta', 'pin-session-beta']])
    })

    const alphaCheckbox = within(screen.getByText('Alpha session').closest('[role="row"]') as HTMLElement).getByRole(
      'checkbox'
    )
    const betaCheckbox = within(screen.getByText('Beta session').closest('[role="row"]') as HTMLElement).getByRole(
      'checkbox'
    )
    const gammaCheckbox = within(screen.getByText('Gamma session').closest('[role="row"]') as HTMLElement).getByRole(
      'checkbox'
    )

    expect(betaCheckbox).toBeDisabled()
    fireEvent.click(betaCheckbox)
    expect(betaCheckbox).toHaveAttribute('aria-checked', 'false')

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all' }))

    expect(alphaCheckbox).toHaveAttribute('aria-checked', 'true')
    expect(betaCheckbox).toHaveAttribute('aria-checked', 'false')
    expect(gammaCheckbox).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('button', { name: /Batch Delete/ })).toHaveTextContent('Batch Delete (2)')
  })

  it('renders an empty state when there are no sessions', () => {
    setupAgentHistory({ sessions: [] })

    expect(screen.getByText('No tasks')).toBeInTheDocument()
    expect(screen.getByText('No tasks for the current filters.')).toBeInTheDocument()
  })

  it('unmounts the overlay immediately when closed', () => {
    hookMocks.useAgents.mockReturnValue({ agents: [createAgent()], error: undefined, isLoading: false })
    hookMocks.useSessions.mockReturnValue({
      sessions: [createSession()],
      pinIdBySessionId: new Map(),
      error: undefined,
      isLoading: false,
      deleteSession: hookMocks.deleteSession,
      deleteSessions: hookMocks.deleteSessions,
      togglePin: hookMocks.togglePin
    })

    const props = {
      mode: 'agent' as const,
      onClose: vi.fn(),
      onRecordSelect: vi.fn()
    }

    const { rerender } = render(<HistoryRecordsView {...props} open />)
    expect(screen.getByTestId('history-records-view')).toBeInTheDocument()

    rerender(<HistoryRecordsView {...props} open={false} />)
    expect(screen.queryByTestId('history-records-view')).not.toBeInTheDocument()
  })

  it('renders an empty state when session search has no matches', () => {
    setupAgentHistory()

    fireEvent.change(screen.getByPlaceholderText('Search tasks...'), { target: { value: 'missing task' } })

    expect(screen.getByText('No tasks')).toBeInTheDocument()
    expect(screen.getByText('No tasks for the current filters.')).toBeInTheDocument()
    expect(screen.queryByText('Alpha session')).not.toBeInTheDocument()
    expect(screen.queryByText('Beta session')).not.toBeInTheDocument()
  })

  it('renders the external session context menu for history rows', () => {
    setupAgentHistory()

    const alphaMenu = screen.getByText('Alpha session').closest('[data-testid="context-menu"]')
    const menuContent = alphaMenu?.querySelector('[data-testid="context-menu-content"]')

    expect(menuContent ?? null).toBeInTheDocument()
    expect(menuContent).toHaveClass('z-50')
    expect(Array.from(menuContent?.children ?? []).map((child) => child.textContent)).toEqual([
      'Edit task name',
      'Pin task',
      '',
      'Delete'
    ])
  })

  it('hides the session delete action for pinned history rows', () => {
    setupAgentHistory({
      pinIdBySessionId: new Map([['session-alpha', 'pin-session-alpha']])
    })

    const alphaMenu = screen.getByText('Alpha session').closest('[data-testid="context-menu"]')
    const menuContent = alphaMenu?.querySelector('[data-testid="context-menu-content"]')

    expect(Array.from(menuContent?.children ?? []).map((child) => child.textContent)).toEqual([
      'Edit task name',
      'Unpin task'
    ])
  })

  it('renames a session from the history row context menu without selecting the row', async () => {
    const { onClose, onRecordSelect } = setupAgentHistory()

    const alphaMenu = screen.getByText('Alpha session').closest('[data-testid="context-menu"]')
    const menuContent = alphaMenu?.querySelector('[data-testid="context-menu-content"]')
    await act(async () => {
      fireEvent.click(within(menuContent as HTMLElement).getByRole('button', { name: 'Edit task name' }))
      await flushAnimationFrame()
    })

    expect(hookMocks.promptShow).not.toHaveBeenCalled()
    expect(onRecordSelect).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(hookMocks.updateSession).not.toHaveBeenCalled()

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('Edit task name')
    const input = within(dialog).getByLabelText('Name')
    expect(hookMocks.updateSession).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: 'Renamed session' } })
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' })
      await flushAnimationFrame()
    })

    await vi.waitFor(() =>
      expect(hookMocks.updateSession).toHaveBeenCalledWith(
        { id: 'session-alpha', name: 'Renamed session', isNameManuallyEdited: true },
        { showSuccessToast: false }
      )
    )
  })

  it('pins a session from the history row context menu without selecting the row', async () => {
    const { onClose, onRecordSelect } = setupAgentHistory()

    const alphaMenu = screen.getByText('Alpha session').closest('[data-testid="context-menu"]')
    const menuContent = alphaMenu?.querySelector('[data-testid="context-menu-content"]')
    await act(async () => {
      fireEvent.click(within(menuContent as HTMLElement).getByRole('button', { name: 'Pin task' }))
      await flushAnimationFrame()
    })

    await vi.waitFor(() => expect(hookMocks.togglePin).toHaveBeenCalledWith('session-alpha', null))
    expect(onRecordSelect).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('clears a selected session when pinning it from the history row action column', async () => {
    setupAgentHistory()

    const alphaRow = screen.getByText('Alpha session').closest('[role="row"]') as HTMLElement
    const checkbox = within(alphaRow).getByRole('checkbox')
    fireEvent.click(checkbox)
    expect(checkbox).toHaveAttribute('aria-checked', 'true')

    await act(async () => {
      fireEvent.click(within(alphaRow).getByTestId('history-pin-button'))
      await flushAnimationFrame()
    })

    await vi.waitFor(() => expect(hookMocks.togglePin).toHaveBeenCalledWith('session-alpha', null))
    await vi.waitFor(() => expect(checkbox).toHaveAttribute('aria-checked', 'false'))
  })

  it('keeps a selected session when pinning it from history fails', async () => {
    hookMocks.togglePin.mockResolvedValueOnce(false)
    setupAgentHistory()

    const alphaRow = screen.getByText('Alpha session').closest('[role="row"]') as HTMLElement
    const checkbox = within(alphaRow).getByRole('checkbox')
    fireEvent.click(checkbox)
    expect(checkbox).toHaveAttribute('aria-checked', 'true')

    await act(async () => {
      fireEvent.click(within(alphaRow).getByTestId('history-pin-button'))
      await flushAnimationFrame()
    })

    await vi.waitFor(() => expect(hookMocks.togglePin).toHaveBeenCalledWith('session-alpha', null))
    expect(checkbox).toHaveAttribute('aria-checked', 'true')
  })

  it('deletes a session from the history row action column without selecting the row', async () => {
    const { onClose, onRecordSelect } = setupAgentHistory()
    const alphaRow = screen.getByText('Alpha session').closest('[role="row"]')

    expect(alphaRow).not.toBeNull()
    fireEvent.click(within(alphaRow as HTMLElement).getByTestId('history-delete-button'))

    expect(screen.getByRole('dialog')).toHaveTextContent('Delete task')
    expect(hookMocks.deleteSession).not.toHaveBeenCalled()

    await act(async () => {
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }))
      await flushAnimationFrame()
    })

    await vi.waitFor(() => expect(hookMocks.deleteSession).toHaveBeenCalledWith('session-alpha'))
    expect(onRecordSelect).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('confirms session deletion and moves the active session when needed', async () => {
    const { onRecordSelect } = setupAgentHistory({ activeRecordId: 'session-alpha' })

    const alphaMenu = screen.getByText('Alpha session').closest('[data-testid="context-menu"]')
    const menuContent = alphaMenu?.querySelector('[data-testid="context-menu-content"]')
    fireEvent.click(within(menuContent as HTMLElement).getByRole('button', { name: 'Delete' }))
    await act(async () => {
      await flushCommandMenuAction()
    })

    expect(confirmActionShow).toHaveBeenCalledWith(expect.objectContaining({ title: 'Delete task' }))

    await act(async () => {
      await flushAnimationFrame()
    })

    await vi.waitFor(() => expect(hookMocks.deleteSession).toHaveBeenCalledWith('session-alpha'))
    expect(onRecordSelect).toHaveBeenCalledWith('session-beta')
  })

  it('clears the active session after deleting the last session from history', async () => {
    const { onRecordSelect } = setupAgentHistory({
      activeRecordId: 'session-alpha',
      sessions: [createSession()]
    })

    const alphaMenu = screen.getByText('Alpha session').closest('[data-testid="context-menu"]')
    const menuContent = alphaMenu?.querySelector('[data-testid="context-menu-content"]')
    fireEvent.click(within(menuContent as HTMLElement).getByRole('button', { name: 'Delete' }))
    await act(async () => {
      await flushCommandMenuAction()
    })

    await act(async () => {
      await flushAnimationFrame()
    })

    await vi.waitFor(() => expect(hookMocks.deleteSession).toHaveBeenCalledWith('session-alpha'))
    expect(onRecordSelect).toHaveBeenCalledWith(null)
  })

  it('keeps the active session unchanged when history deletion fails', async () => {
    hookMocks.deleteSession.mockResolvedValueOnce(false)
    const { onRecordSelect } = setupAgentHistory({ activeRecordId: 'session-alpha' })

    const alphaMenu = screen.getByText('Alpha session').closest('[data-testid="context-menu"]')
    const menuContent = alphaMenu?.querySelector('[data-testid="context-menu-content"]')
    fireEvent.click(within(menuContent as HTMLElement).getByRole('button', { name: 'Delete' }))
    await act(async () => {
      await flushCommandMenuAction()
    })

    await act(async () => {
      await flushAnimationFrame()
    })

    await vi.waitFor(() => expect(hookMocks.deleteSession).toHaveBeenCalledWith('session-alpha'))
    expect(onRecordSelect).not.toHaveBeenCalled()
  })
})
