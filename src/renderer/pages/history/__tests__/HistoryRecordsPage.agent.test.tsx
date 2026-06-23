import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import type { AgentEntity } from '@shared/data/types/agent'
import { MockCacheUtils } from '@test-mocks/renderer/CacheService'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hookMocks = vi.hoisted(() => ({
  deleteSession: vi.fn(),
  deleteSessions: vi.fn(),
  promptShow: vi.fn(),
  togglePin: vi.fn(),
  updateSession: vi.fn(),
  openConversationTab: vi.fn(),
  useAgents: vi.fn(),
  useTopics: vi.fn(),
  useAssistants: vi.fn(),
  useDataApiQuery: vi.fn(),
  useMultiplePreferences: vi.fn(),
  usePins: vi.fn(),
  useSessions: vi.fn(),
  useUpdateSession: vi.fn()
}))

vi.mock('@cherrystudio/ui', async () => {
  const { MockCherrystudioUI } = await import('@test-mocks/renderer/CherrystudioUI')
  return MockCherrystudioUI
})

vi.mock('@renderer/data/CacheService', async () => {
  const { MockCacheService } = await import('@test-mocks/renderer/CacheService')
  return MockCacheService
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
  }) => (
    <div data-testid="history-virtual-list" role={role}>
      {header}
      {list.map((item, index) => (
        <div key={(item as { id?: string }).id ?? index}>{children(item, index)}</div>
      ))}
    </div>
  )
}))

vi.mock('@renderer/components/resource/dialogs', () => ({
  ResourceEditDialogHost: ({ target }: { target: { kind: string; id: string } | null }) =>
    target ? <div data-testid="resource-edit-dialog-host" data-kind={target.kind} data-id={target.id} /> : null
}))

vi.mock('@renderer/data/hooks/usePreference', () => ({
  usePreference: () => ['cherry', () => {}],
  useMultiplePreferences: hookMocks.useMultiplePreferences
}))

vi.mock('@renderer/data/hooks/useDataApi', () => ({
  useQuery: hookMocks.useDataApiQuery
}))

vi.mock('@renderer/hooks/agents/useAgent', () => ({
  useAgents: hookMocks.useAgents
}))

vi.mock('@renderer/hooks/agents/useSession', () => ({
  useSessions: hookMocks.useSessions,
  useUpdateSession: hookMocks.useUpdateSession
}))

vi.mock('@renderer/hooks/useAssistant', () => ({
  useAssistants: hookMocks.useAssistants
}))

vi.mock('@renderer/hooks/useConversationNavigation', () => ({
  useConversationNavigation: () => ({
    focusExistingTab: vi.fn(),
    openConversationTab: hookMocks.openConversationTab
  })
}))

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

vi.mock('@renderer/services/ApiService', () => ({
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

vi.mock('@renderer/components/Popups/ObsidianExportPopup', () => ({
  default: { show: vi.fn() }
}))

vi.mock('@renderer/components/Popups/PromptPopup', () => ({
  default: { show: hookMocks.promptShow }
}))

vi.mock('@renderer/components/Popups/SaveToKnowledgePopup', () => ({
  default: { showForTopic: vi.fn() }
}))

vi.mock('@renderer/utils/copy', () => ({
  copyTopicAsMarkdown: vi.fn(),
  copyTopicAsPlainText: vi.fn()
}))

vi.mock('@renderer/utils/export', () => ({
  exportMarkdownToJoplin: vi.fn(),
  exportMarkdownToSiyuan: vi.fn(),
  exportMarkdownToYuque: vi.fn(),
  exportTopicAsMarkdown: vi.fn(),
  exportTopicToNotes: vi.fn(),
  exportTopicToNotion: vi.fn(),
  topicToMarkdown: vi.fn().mockResolvedValue('# topic')
}))

vi.mock('react-i18next', () => ({
  initReactI18next: {
    init: vi.fn(),
    type: '3rdParty'
  },
  useTranslation: () => ({
    t: (key: string, fallbackOrOptions?: string | Record<string, unknown>, maybeOptions?: Record<string, unknown>) => {
      const fallback = typeof fallbackOrOptions === 'string' ? fallbackOrOptions : undefined
      const options = typeof fallbackOrOptions === 'object' ? fallbackOrOptions : maybeOptions
      const labels: Record<string, string> = {
        'agent.session.display.workdir': 'Work directory',
        'agent.session.group.no_workdir': 'No work directory',
        'agent.session.group.unknown_agent': 'Unknown agent',
        'agent.session.delete.content': 'Delete this task?',
        'agent.session.delete.title': 'Delete task',
        'agent.session.edit.title': 'Edit task',
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
        'common.more': 'More',
        'common.name': 'Name',
        'common.rename': 'Rename',
        'common.required_field': 'Required field',
        'common.save': 'Save',
        'common.saved': 'Saved',
        'common.select_all': 'Select all',
        'common.unknown': 'Unknown',
        'common.unnamed': 'Untitled',
        'history.records.bulkDelete': 'Batch Delete',
        'history.records.bulkDeleteSessions.description': 'Delete {{count}} selected task(s)?',
        'history.records.bulkDeleteSessions.title': 'Delete selected tasks',
        'history.records.agentSubtitle': '{{count}} tasks',
        'history.records.agentTitle': 'Agent history',
        'history.records.empty.sessionsDescription': 'No tasks for the current filters.',
        'history.records.empty.sessionsTitle': 'No tasks',
        'history.records.loading.sessionsDescription': 'Loading task list.',
        'history.records.loading.sessionsTitle': 'Loading tasks',
        'history.records.resultCount': '{{count}} results',
        'history.records.searchSession': 'Search tasks...',
        'history.records.shortTitle': 'History',
        'history.records.sidebar.status': 'Status',
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
  })
}))

import HistoryRecordsPage from '../HistoryRecordsPage'

function flushAnimationFrame() {
  return new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
}

function flushCommandMenuAction() {
  return new Promise<void>((resolve) => queueMicrotask(resolve))
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

function createSession(overrides: Partial<AgentSessionEntity> = {}): AgentSessionEntity {
  return {
    id: 'session-alpha',
    agentId: 'agent-alpha',
    name: 'Alpha session',
    description: 'Planning notes',
    workspaceId: 'ws-/Users/jd/project-a',
    workspace: makeWorkspace('/Users/jd/project-a'),
    orderKey: 'a',
    createdAt: '2026-05-13T08:00:00.000Z',
    updatedAt: '2026-05-14T08:00:00.000Z',
    ...overrides
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
  pinIdBySessionId = new Map<string, string>()
}: {
  activeRecordId?: string | null
  agents?: AgentEntity[]
  pinIdBySessionId?: Map<string, string>
  sessions?: AgentSessionEntity[]
} = {}) {
  hookMocks.useAgents.mockReturnValue({ agents, error: undefined, isLoading: false })
  hookMocks.useSessions.mockReturnValue({
    sessions,
    pinIdBySessionId,
    error: undefined,
    isLoading: false,
    deleteSession: hookMocks.deleteSession,
    deleteSessions: hookMocks.deleteSessions,
    togglePin: hookMocks.togglePin
  })

  const onClose = vi.fn()
  const onRecordSelect = vi.fn()
  render(
    <HistoryRecordsPage
      mode="agent"
      open
      activeRecordId={activeRecordId}
      onClose={onClose}
      onRecordSelect={onRecordSelect}
    />
  )

  return { onClose, onRecordSelect }
}

describe('HistoryRecordsPage agent mode', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="agent-page"></div><div id="home-page"></div>'
    Object.assign(window, {
      modal: {
        confirm: vi.fn()
      },
      toast: {
        error: vi.fn(),
        success: vi.fn(),
        warning: vi.fn()
      }
    })
    MockCacheUtils.resetMocks()
    hookMocks.deleteSession.mockReset()
    hookMocks.deleteSession.mockResolvedValue(true)
    hookMocks.deleteSessions.mockReset()
    hookMocks.deleteSessions.mockResolvedValue({ deletedIds: ['session-alpha'], deletedCount: 1 })
    hookMocks.promptShow.mockReset()
    hookMocks.togglePin.mockReset()
    hookMocks.togglePin.mockResolvedValue(undefined)
    hookMocks.updateSession.mockReset()
    hookMocks.updateSession.mockResolvedValue(createSession({ name: 'Renamed session' }))
    hookMocks.useAgents.mockReset()
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
  })

  it('renders sessions from the existing agent session list data', () => {
    const { onClose, onRecordSelect } = setupAgentHistory({
      pinIdBySessionId: new Map([['session-alpha', 'pin-session-alpha']])
    })

    expect(hookMocks.useSessions).toHaveBeenCalledWith(undefined, { loadAll: true, pageSize: 50 })
    expect(hookMocks.useTopics).not.toHaveBeenCalled()
    expect(hookMocks.useAssistants).not.toHaveBeenCalled()
    expect(screen.getByText('History')).toBeInTheDocument()
    expect(screen.getByText('2 tasks')).toBeInTheDocument()
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getByTestId('history-virtual-list')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()
    const pinButton = screen.getAllByTestId('history-pin-button')[0]
    expect(pinButton).toHaveAccessibleName('Unpin')
    fireEvent.click(pinButton)
    expect(hookMocks.togglePin).toHaveBeenCalledWith('session-alpha')
    expect(onRecordSelect).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.queryByText('Messages')).not.toBeInTheDocument()
    expect(screen.queryByText('消息')).not.toBeInTheDocument()
    expect(screen.getByText('Alpha session')).toBeInTheDocument()
    expect(screen.getByText('Planning notes')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Agent' })).toBeInTheDocument()
    expect(screen.getAllByText('Alpha agent').length).toBeGreaterThanOrEqual(1)
    const alphaRow = screen.getByText('Alpha session').closest('[role="row"]') as HTMLElement
    const alphaCells = within(alphaRow).getAllByRole('cell')
    expect(within(alphaCells[1]).queryByText('A')).not.toBeInTheDocument()
    expect(within(alphaCells[2]).getAllByText('A').length).toBeGreaterThan(0)
    expect(within(alphaCells[2]).getByText('Alpha agent')).toBeInTheDocument()
    expect(screen.getByText('Beta session')).toBeInTheDocument()
    expect(screen.getAllByText('Beta agent').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByRole('button', { name: /Gamma agent 0/ })).toBeInTheDocument()
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

  it('filters sessions by selected agent source', () => {
    setupAgentHistory()

    fireEvent.click(screen.getByRole('button', { name: /Beta agent 1/ }))

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
    const betaSource = screen.getByRole('button', { name: /Beta agent 1/ })
    const alphaSource = screen.getByRole('button', { name: /Alpha agent 2/ })
    expect(Boolean(betaSource.compareDocumentPosition(alphaSource) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true)

    fireEvent.click(alphaSource)

    const alphaA = screen.getByText('Alpha A').closest('[role="row"]') as HTMLElement
    const alphaB = screen.getByText('Alpha B').closest('[role="row"]') as HTMLElement
    expect(Boolean(alphaA.compareDocumentPosition(alphaB) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true)
  })

  it('restores the agent status selector and filters by existing stream status', () => {
    MockCacheUtils.setInitialState({
      shared: [['topic.stream.statuses.agent-session:session-beta', { status: 'streaming', activeExecutions: [] }]]
    })

    setupAgentHistory()

    expect(screen.getByText('Status')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Running 1/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Completed 1/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Failed 0/ })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Running 1/ }))

    expect(screen.queryByText('Alpha session')).not.toBeInTheDocument()
    expect(screen.getByText('Beta session')).toBeInTheDocument()
  })

  it('filters completed and failed sessions by stream status', () => {
    MockCacheUtils.setInitialState({
      shared: [['topic.stream.statuses.agent-session:session-beta', { status: 'error', activeExecutions: [] }]]
    })

    setupAgentHistory()

    expect(screen.getByRole('button', { name: /Running 0/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Completed 1/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Failed 1/ })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Failed 1/ }))

    expect(screen.queryByText('Alpha session')).not.toBeInTheDocument()
    expect(screen.getByText('Beta session')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Completed 1/ }))

    expect(screen.getByText('Alpha session')).toBeInTheDocument()
    expect(screen.queryByText('Beta session')).not.toBeInTheDocument()
  })

  it('groups sessions with a missing agent under the unknown-agent source', () => {
    setupAgentHistory({
      sessions: [
        createSession(),
        createSession({
          id: 'session-missing-agent',
          agentId: 'agent-missing',
          name: 'Missing agent session',
          workspaceId: 'ws-missing',
          workspace: makeWorkspace('/Users/jd/project-missing'),
          orderKey: 'b'
        })
      ]
    })

    fireEvent.click(screen.getByRole('button', { name: /Unknown agent 1/ }))

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

    const { rerender } = render(<HistoryRecordsPage {...props} open />)
    expect(screen.getByTestId('history-records-page')).toBeInTheDocument()

    rerender(<HistoryRecordsPage {...props} open={false} />)
    expect(screen.queryByTestId('history-records-page')).not.toBeInTheDocument()
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
      'Rename',
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

    expect(Array.from(menuContent?.children ?? []).map((child) => child.textContent)).toEqual(['Rename', 'Unpin task'])
  })

  it('renames a session from the history row context menu without selecting the row', async () => {
    const { onClose, onRecordSelect } = setupAgentHistory()

    const alphaMenu = screen.getByText('Alpha session').closest('[data-testid="context-menu"]')
    const menuContent = alphaMenu?.querySelector('[data-testid="context-menu-content"]')
    await act(async () => {
      fireEvent.click(within(menuContent as HTMLElement).getByRole('button', { name: 'Rename' }))
      await flushAnimationFrame()
    })

    expect(hookMocks.promptShow).not.toHaveBeenCalled()
    expect(onRecordSelect).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(hookMocks.updateSession).not.toHaveBeenCalled()

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('Edit task')
    const input = within(dialog).getByLabelText('Name')
    expect(hookMocks.updateSession).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: 'Renamed session' } })
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' })
      await flushAnimationFrame()
    })

    await vi.waitFor(() =>
      expect(hookMocks.updateSession).toHaveBeenCalledWith(
        { id: 'session-alpha', name: 'Renamed session' },
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

    await vi.waitFor(() => expect(hookMocks.togglePin).toHaveBeenCalledWith('session-alpha'))
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

    await vi.waitFor(() => expect(hookMocks.togglePin).toHaveBeenCalledWith('session-alpha'))
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

    await vi.waitFor(() => expect(hookMocks.togglePin).toHaveBeenCalledWith('session-alpha'))
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

    expect(window.modal.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Delete task' }))
    expect(hookMocks.deleteSession).not.toHaveBeenCalled()

    const confirmOptions = vi.mocked(window.modal.confirm).mock.calls.at(-1)?.[0]
    await act(async () => {
      await confirmOptions?.onOk?.()
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

    const confirmOptions = vi.mocked(window.modal.confirm).mock.calls.at(-1)?.[0]
    await act(async () => {
      await confirmOptions?.onOk?.()
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

    const confirmOptions = vi.mocked(window.modal.confirm).mock.calls.at(-1)?.[0]
    await act(async () => {
      await confirmOptions?.onOk?.()
      await flushAnimationFrame()
    })

    await vi.waitFor(() => expect(hookMocks.deleteSession).toHaveBeenCalledWith('session-alpha'))
    expect(onRecordSelect).not.toHaveBeenCalled()
  })
})
