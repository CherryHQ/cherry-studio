import { MockCacheUtils } from '@test-mocks/renderer/CacheService'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as CherryStudioUI from '@cherrystudio/ui'
import { cacheService } from '@renderer/data/CacheService'
import { dataApiService } from '@renderer/data/DataApiService'
import type * as UseCacheModule from '@renderer/data/hooks/useCache'
import type * as RecycleBinFeedback from '@renderer/services/recycleBinFeedback'
import { toast } from '@renderer/services/toast'
import type { AgentFileNavigationOptions, AgentFileNavigationTransition } from '@renderer/types/agent'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import type { AgentEntity } from '@shared/data/types/agent'
import { aiErrorCodes } from '@shared/ipc/errors/ai'
import { IpcError } from '@shared/ipc/errors/IpcError'

type VirtualListRenderRow = (item: unknown, index: number) => ReactNode

const hookMocks = vi.hoisted(() => ({
  deleteSession: vi.fn(),
  deleteSessionWithOutcome: vi.fn(),
  deleteSessions: vi.fn(),
  promptShow: vi.fn(),
  reload: vi.fn(),
  togglePin: vi.fn(),
  updateSession: vi.fn(),
  openConversationTab: vi.fn(),
  restoreSession: vi.fn(),
  useAgents: vi.fn(),
  useTopics: vi.fn(),
  useAssistants: vi.fn(),
  useDataApiQuery: vi.fn(),
  useMultiplePreferences: vi.fn(),
  usePins: vi.fn(),
  useSessions: vi.fn(),
  useUpdateSession: vi.fn(),
  virtualListRenderRows: [] as VirtualListRenderRow[]
}))

const recycleBinFeedbackMocks = vi.hoisted(() => ({
  showRecycleBinBatchUndo: vi.fn(),
  showRecycleBinUndo: vi.fn()
}))

vi.mock('@renderer/services/recycleBinFeedback', async (importOriginal) => ({
  ...(await importOriginal<typeof RecycleBinFeedback>()),
  ...recycleBinFeedbackMocks
}))

vi.mock('@cherrystudio/ui', async (importOriginal) => {
  const { MockCherrystudioUI } = await import('@test-mocks/renderer/CherrystudioUI')
  return {
    ...(await importOriginal<typeof CherryStudioUI>()),
    ...MockCherrystudioUI
  }
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
  useSessions: hookMocks.useSessions,
  useUpdateSession: hookMocks.useUpdateSession
}))

vi.mock('@renderer/hooks/resourceViewSources', async () => {
  // Resolves to the mocked useTopic module, so rendererTopics uses the same mapper as the test.
  const { mapApiTopicToRendererTopic } = await import('@renderer/hooks/useTopic')
  return {
    useAgentSessionsSource: () => {
      const source = hookMocks.useSessions()
      return {
        ...source,
        isLoadingAll: source.isLoadingAll ?? source.isLoading,
        isFullyLoaded: source.isFullyLoaded ?? !source.isLoading
      }
    },
    useAssistantTopicsSource: () => {
      const source = hookMocks.useTopics()
      return {
        ...source,
        rendererTopics: (source.topics ?? []).map(mapApiTopicToRendererTopic),
        orderSignature: ''
      }
    }
  }
})

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

const permanentDeletePopupMocks = vi.hoisted(() => ({ show: vi.fn() }))
vi.mock('@renderer/components/chat/DeleteConversationOwnerConfirmDialog', () => ({
  permanentDeletePopup: permanentDeletePopupMocks
}))

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
        'agent.session.group.unknown_agent': 'Unlinked Agent',
        'agent.session.delete.content': 'Delete this task?',
        'agent.session.delete.title': 'Delete task',
        'agent.session.edit.title': 'Edit task name',
        'agent.session.pin.title': 'Pin task',
        'agent.session.update.error.failed': 'Failed to update task',
        'agent.session.unpin.title': 'Unpin task',
        'agent.edit.title': 'Edit Agent',
        'common.agent': 'Agent',
        'common.all': 'All',
        'common.archive': 'Archive',
        'common.back': 'Back',
        'common.cancel': 'Cancel',
        'common.close': 'Close',
        'common.delete': 'Delete',
        'common.delete_permanently': 'Delete Permanently',
        'common.select': 'Select',
        'common.more': 'More',
        'common.name': 'Name',
        'common.rename': 'Rename',
        'common.required_field': 'Required field',
        'common.save': 'Save',
        'common.saved': 'Saved',
        'common.select_all': 'Select all',
        'common.unnamed': 'Untitled',
        'recycle_bin.move.confirm_action': 'Move to Recycle Bin',
        'recycle_bin.move.confirm_title': 'Move to Recycle Bin?',
        'recycle_bin.already_moved': 'Already in Recycle Bin',
        'recycle_bin.delete.busy': 'Stop generation before permanently deleting this conversation.',
        'recycle_bin.delete.pinned': 'Unpin this conversation before permanently deleting it.',
        'recycle_bin.delete.stale': 'This item has already been deleted or archived. Refresh the list and try again.',
        'agent.session.delete.error.failed': 'Failed to delete the session',
        'recycle_bin.move_failed': 'Could not move to Recycle Bin',
        'history.records.bulkArchive': 'Batch Archive',
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

import { CommandProvider } from '@renderer/components/command'

import HistoryRecordsView from '../HistoryRecordsView'

function flushAnimationFrame() {
  return new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
}

function flushCommandMenuAction() {
  return flushAnimationFrame()
}

async function clickBulkDelete() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /Batch Archive/ }))
    await flushAnimationFrame()
  })
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
    lastActivityAt: '2026-05-14T08:00:00.000Z',
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
  requestRecordRemoval,
  onLocalPermanentDeletePendingChange
}: {
  activeRecordId?: string | null
  agents?: AgentEntity[]
  onLocalPermanentDeletePendingChange?: (id: string | null) => void
  pinIdBySessionId?: Map<string, string>
  requestRecordRemoval?: (
    nextSessionId: string | null,
    transition: AgentFileNavigationTransition,
    options?: AgentFileNavigationOptions
  ) => void
  sessions?: AgentSessionEntity[]
} = {}) {
  hookMocks.useAgents.mockReturnValue({ agents, error: undefined, isLoading: false })
  hookMocks.useSessions.mockReturnValue({
    sessions,
    pinIdBySessionId,
    error: undefined,
    isLoading: false,
    deleteSession: hookMocks.deleteSession,
    deleteSessionWithOutcome: hookMocks.deleteSessionWithOutcome,
    deleteSessions: hookMocks.deleteSessions,
    reload: hookMocks.reload,
    restoreSession: hookMocks.restoreSession,
    togglePin: hookMocks.togglePin
  })

  const onClose = vi.fn()
  const onRecordSelect = vi.fn()
  const onActiveRecordChange = vi.fn()
  const view = render(
    <HistoryRecordsView
      mode="agent"
      open
      activeRecordId={activeRecordId}
      onClose={onClose}
      onRecordSelect={onRecordSelect}
      onActiveRecordChange={onActiveRecordChange}
      onLocalPermanentDeletePendingChange={onLocalPermanentDeletePendingChange}
      requestRecordRemoval={requestRecordRemoval}
    />
  )
  const rerender = (nextActiveRecordId: string | null = activeRecordId) => {
    view.rerender(
      <HistoryRecordsView
        mode="agent"
        open
        activeRecordId={nextActiveRecordId}
        onClose={onClose}
        onRecordSelect={onRecordSelect}
        onActiveRecordChange={onActiveRecordChange}
        onLocalPermanentDeletePendingChange={onLocalPermanentDeletePendingChange}
        requestRecordRemoval={requestRecordRemoval}
      />
    )
  }

  return { onClose, onRecordSelect, onActiveRecordChange, rerender }
}

let agentHistoryLoaded = false

describe('HistoryRecordsView agent mode', () => {
  beforeEach(async () => {
    document.body.innerHTML = '<div id="agent-page"></div><div id="home-page"></div>'
    MockCacheUtils.resetMocks()
    confirmActionShow.mockClear()
    hookMocks.deleteSession.mockReset()
    hookMocks.deleteSession.mockResolvedValue(true)
    hookMocks.deleteSessionWithOutcome.mockReset()
    hookMocks.deleteSessionWithOutcome.mockResolvedValue({ status: 'succeeded' })
    permanentDeletePopupMocks.show.mockReset()
    permanentDeletePopupMocks.show.mockResolvedValue(false)
    hookMocks.restoreSession.mockReset()
    hookMocks.restoreSession.mockResolvedValue(undefined)
    hookMocks.deleteSessions.mockReset()
    hookMocks.deleteSessions.mockResolvedValue({ deletedIds: ['session-alpha'], deletedCount: 1 })
    hookMocks.promptShow.mockReset()
    hookMocks.reload.mockReset()
    hookMocks.reload.mockResolvedValue(undefined)
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
    recycleBinFeedbackMocks.showRecycleBinBatchUndo.mockClear()
    recycleBinFeedbackMocks.showRecycleBinUndo.mockClear()

    if (!agentHistoryLoaded) {
      await import('../AgentHistoryRecords')
      hookMocks.useAgents.mockReturnValue({ agents: [], error: undefined, isLoading: false })
      hookMocks.useSessions.mockReturnValue({
        sessions: [],
        pinIdBySessionId: new Map(),
        error: undefined,
        isLoading: false,
        deleteSession: hookMocks.deleteSession,
        deleteSessionWithOutcome: hookMocks.deleteSessionWithOutcome,
        deleteSessions: hookMocks.deleteSessions,
        reload: hookMocks.reload,
        togglePin: hookMocks.togglePin
      })
      const { unmount } = render(<HistoryRecordsView mode="agent" open onClose={vi.fn()} />)

      await screen.findByRole('region', { name: 'History' })
      unmount()
      vi.clearAllMocks()
      agentHistoryLoaded = true
    }
  }, 60_000)

  it('renders sessions from the existing agent session list data', () => {
    const { onClose, onRecordSelect } = setupAgentHistory({
      pinIdBySessionId: new Map([['session-alpha', 'pin-session-alpha']])
    })

    expect(hookMocks.useSessions).toHaveBeenCalledWith()
    expect(hookMocks.useTopics).not.toHaveBeenCalled()
    expect(hookMocks.useAssistants).not.toHaveBeenCalled()
    expect(screen.getByRole('region', { name: 'History' })).toBeInTheDocument()
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getByTestId('history-virtual-list')).toBeInTheDocument()
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
    const bulkDeleteButton = screen.getByRole('button', { name: 'Batch Archive' })

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

    const alphaA = screen.getByText('Alpha A').closest('[role="row"]') as HTMLElement
    const alphaB = screen.getByText('Alpha B').closest('[role="row"]') as HTMLElement
    expect(Boolean(alphaA.compareDocumentPosition(alphaB) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true)
  })

  it('restores the agent status selector and filters by existing stream status', () => {
    MockCacheUtils.setInitialState({
      shared: [['topic.stream.statuses.agent-session:session-beta', { status: 'streaming', activeExecutions: [] }]]
    })

    setupAgentHistory()

    expect(screen.getByRole('button', { name: 'Status' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Running$/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Completed$/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Failed$/ })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /^Running$/ }))

    expect(screen.queryByText('Alpha session')).not.toBeInTheDocument()
    expect(screen.getByText('Beta session')).toBeInTheDocument()
  })

  it('filters completed and failed sessions by stream status', () => {
    MockCacheUtils.setInitialState({
      shared: [['topic.stream.statuses.agent-session:session-beta', { status: 'error', activeExecutions: [] }]]
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

  it('keeps the virtual row renderer stable across stream status updates', () => {
    setupAgentHistory()
    const initialRenderRow = hookMocks.virtualListRenderRows.at(-1)

    act(() => {
      cacheService.setShared('topic.stream.statuses.agent-session:session-beta', {
        status: 'streaming',
        activeExecutions: [],
        awaitingApprovalAnchors: []
      })
    })

    expect(hookMocks.virtualListRenderRows.at(-1)).toBe(initialRenderRow)
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

    fireEvent.click(screen.getByRole('button', { name: /Unlinked Agent/ }))

    expect(screen.queryByText('Alpha session')).not.toBeInTheDocument()
    expect(screen.getByText('Missing agent session')).toBeInTheDocument()
    expect(screen.getAllByText('Unlinked Agent')).not.toHaveLength(0)
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
    const { onClose, onActiveRecordChange } = setupAgentHistory({
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

    await clickBulkDelete()

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    expect(hookMocks.deleteSessionWithOutcome).toHaveBeenCalledTimes(2)
    expect(hookMocks.deleteSessionWithOutcome).toHaveBeenNthCalledWith(1, 'session-alpha', { showFeedback: false })
    expect(hookMocks.deleteSessionWithOutcome).toHaveBeenNthCalledWith(2, 'session-beta', { showFeedback: false })
    expect(hookMocks.deleteSessions).not.toHaveBeenCalled()
    expect(onActiveRecordChange).toHaveBeenCalledWith('session-gamma')
    expect(onClose).not.toHaveBeenCalled()
    expect(recycleBinFeedbackMocks.showRecycleBinBatchUndo).toHaveBeenCalledWith({
      itemCount: 2,
      onUndo: expect.any(Function)
    })

    hookMocks.restoreSession.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('Restore failed'))
    await expect(recycleBinFeedbackMocks.showRecycleBinBatchUndo.mock.calls.at(-1)?.[0].onUndo()).resolves.toEqual({
      restored: ['session-alpha'],
      failed: [{ id: 'session-beta', error: 'Restore failed' }]
    })
    expect(hookMocks.reload).toHaveBeenCalledOnce()
  })

  it('keeps failed bulk sessions selected and excludes them from Undo', async () => {
    hookMocks.deleteSessionWithOutcome
      .mockResolvedValueOnce({ status: 'succeeded' })
      .mockResolvedValueOnce({ status: 'failed', error: 'Beta delete failed' })
    const { onActiveRecordChange } = setupAgentHistory({ activeRecordId: 'session-alpha' })
    const alphaRow = screen.getByText('Alpha session').closest('[role="row"]') as HTMLElement
    const betaRow = screen.getByText('Beta session').closest('[role="row"]') as HTMLElement
    fireEvent.click(within(alphaRow).getByRole('checkbox'))
    fireEvent.click(within(betaRow).getByRole('checkbox'))
    await clickBulkDelete()

    expect(within(alphaRow).getByRole('checkbox')).toHaveAttribute('aria-checked', 'false')
    expect(within(betaRow).getByRole('checkbox')).toHaveAttribute('aria-checked', 'true')
    expect(onActiveRecordChange).toHaveBeenCalledWith('session-beta')
    expect(recycleBinFeedbackMocks.showRecycleBinBatchUndo).toHaveBeenCalledWith({
      itemCount: 1,
      onUndo: expect.any(Function)
    })

    await recycleBinFeedbackMocks.showRecycleBinBatchUndo.mock.calls.at(-1)?.[0].onUndo()
    expect(hookMocks.restoreSession).toHaveBeenCalledExactlyOnceWith('session-alpha')
  })

  it('reports all stale bulk sessions once without changing selection or active state', async () => {
    hookMocks.deleteSessionWithOutcome.mockResolvedValue({ status: 'stale' })
    const { onActiveRecordChange } = setupAgentHistory({ activeRecordId: 'session-alpha' })
    const alphaRow = screen.getByText('Alpha session').closest('[role="row"]') as HTMLElement
    const betaRow = screen.getByText('Beta session').closest('[role="row"]') as HTMLElement
    fireEvent.click(within(alphaRow).getByRole('checkbox'))
    fireEvent.click(within(betaRow).getByRole('checkbox'))
    await clickBulkDelete()

    expect(within(alphaRow).getByRole('checkbox')).toHaveAttribute('aria-checked', 'true')
    expect(within(betaRow).getByRole('checkbox')).toHaveAttribute('aria-checked', 'true')
    expect(onActiveRecordChange).not.toHaveBeenCalled()
    expect(recycleBinFeedbackMocks.showRecycleBinBatchUndo).not.toHaveBeenCalled()
    expect(toast.info).toHaveBeenCalledExactlyOnceWith('Already in Recycle Bin')
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('reports non-stale bulk session failures once without changing selection or active state', async () => {
    hookMocks.deleteSessionWithOutcome.mockResolvedValue({ status: 'failed', error: 'Delete failed' })
    const { onActiveRecordChange } = setupAgentHistory({ activeRecordId: 'session-alpha' })
    const alphaRow = screen.getByText('Alpha session').closest('[role="row"]') as HTMLElement
    const betaRow = screen.getByText('Beta session').closest('[role="row"]') as HTMLElement
    fireEvent.click(within(alphaRow).getByRole('checkbox'))
    fireEvent.click(within(betaRow).getByRole('checkbox'))
    await clickBulkDelete()

    expect(within(alphaRow).getByRole('checkbox')).toHaveAttribute('aria-checked', 'true')
    expect(within(betaRow).getByRole('checkbox')).toHaveAttribute('aria-checked', 'true')
    expect(onActiveRecordChange).not.toHaveBeenCalled()
    expect(recycleBinFeedbackMocks.showRecycleBinBatchUndo).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledExactlyOnceWith('Could not move to Recycle Bin')
    expect(toast.info).not.toHaveBeenCalled()
  })

  it('keeps a stale bulk session selected and only offers Undo for the successful id', async () => {
    hookMocks.deleteSessionWithOutcome
      .mockResolvedValueOnce({ status: 'succeeded' })
      .mockResolvedValueOnce({ status: 'stale' })
    const { onActiveRecordChange } = setupAgentHistory({ activeRecordId: 'session-alpha' })
    const alphaRow = screen.getByText('Alpha session').closest('[role="row"]') as HTMLElement
    const betaRow = screen.getByText('Beta session').closest('[role="row"]') as HTMLElement
    fireEvent.click(within(alphaRow).getByRole('checkbox'))
    fireEvent.click(within(betaRow).getByRole('checkbox'))
    await clickBulkDelete()

    expect(within(alphaRow).getByRole('checkbox')).toHaveAttribute('aria-checked', 'false')
    expect(within(betaRow).getByRole('checkbox')).toHaveAttribute('aria-checked', 'true')
    expect(onActiveRecordChange).toHaveBeenCalledWith('session-beta')
    expect(recycleBinFeedbackMocks.showRecycleBinBatchUndo).toHaveBeenCalledWith({
      itemCount: 1,
      onUndo: expect.any(Function)
    })
    expect(toast.info).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()

    await recycleBinFeedbackMocks.showRecycleBinBatchUndo.mock.calls.at(-1)?.[0].onUndo()
    expect(hookMocks.restoreSession).toHaveBeenCalledExactlyOnceWith('session-alpha')
  })

  it('skips pinned sessions when bulk deleting from the query toolbar', async () => {
    const { onClose, onActiveRecordChange } = setupAgentHistory({
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

    await clickBulkDelete()

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    expect(hookMocks.deleteSessionWithOutcome).toHaveBeenCalledExactlyOnceWith('session-alpha', {
      showFeedback: false
    })
    expect(onActiveRecordChange).not.toHaveBeenCalled()
    expect(hookMocks.deleteSessions).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('disables bulk delete when only pinned sessions are selected', () => {
    setupAgentHistory({
      pinIdBySessionId: new Map([['session-alpha', 'pin-session-alpha']])
    })

    const alphaRow = screen.getByText('Alpha session').closest('[role="row"]') as HTMLElement
    fireEvent.click(within(alphaRow).getByRole('checkbox'))

    expect(screen.getByRole('button', { name: 'Batch Archive' })).toBeDisabled()
    expect(hookMocks.deleteSession).not.toHaveBeenCalled()
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
    expect(screen.getByRole('button', { name: /Batch Archive/ })).toHaveTextContent('Batch Archive (2)')
  })

  it('renders an empty state when there are no sessions', () => {
    setupAgentHistory({ sessions: [] })

    expect(screen.getByText('No tasks')).toBeInTheDocument()
    expect(screen.getByText('No tasks for the current filters.')).toBeInTheDocument()
  })

  it('keeps the loading state until the shared full-session source commits', () => {
    hookMocks.useAgents.mockReturnValue({ agents: [createAgent()], error: undefined, isLoading: false })
    hookMocks.useSessions.mockReturnValue({
      sessions: [],
      pinIdBySessionId: new Map(),
      error: undefined,
      isLoading: false,
      isLoadingAll: true,
      isFullyLoaded: false,
      deleteSession: hookMocks.deleteSession,
      deleteSessions: hookMocks.deleteSessions,
      togglePin: hookMocks.togglePin
    })

    render(<HistoryRecordsView mode="agent" open onClose={vi.fn()} onRecordSelect={vi.fn()} />)

    expect(screen.getByText('Loading tasks')).toBeInTheDocument()
    expect(screen.queryByText('No tasks')).not.toBeInTheDocument()
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
    let resolveRename!: (session: AgentSessionEntity) => void
    hookMocks.updateSession.mockReturnValueOnce(
      new Promise<AgentSessionEntity>((resolve) => {
        resolveRename = resolve
      })
    )
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
    expect(screen.getByText('Renamed session')).toBeInTheDocument()
    expect(screen.queryByText('Alpha session')).not.toBeInTheDocument()

    await act(async () => {
      resolveRename(createSession({ name: 'Renamed session' }))
    })
    expect(screen.getByText('Renamed session')).toBeInTheDocument()
    expect(screen.queryByText('Alpha session')).not.toBeInTheDocument()
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
    hookMocks.restoreSession.mockRejectedValueOnce(
      new IpcError(aiErrorCodes.AI_AGENT_SESSION_NOT_FOUND, 'Session active')
    )
    const getActiveSession = vi.spyOn(dataApiService, 'get').mockResolvedValue({ id: 'session-alpha' })
    const { onClose, onActiveRecordChange } = setupAgentHistory()
    const alphaRow = screen.getByText('Alpha session').closest('[role="row"]')

    expect(alphaRow).not.toBeNull()
    fireEvent.click(within(alphaRow as HTMLElement).getByTestId('history-delete-button'))

    await act(async () => {
      await flushAnimationFrame()
    })

    await vi.waitFor(() => expect(hookMocks.deleteSession).toHaveBeenCalledWith('session-alpha'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(onActiveRecordChange).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(recycleBinFeedbackMocks.showRecycleBinUndo).toHaveBeenCalledWith({
      itemName: 'Alpha session',
      onUndo: expect.any(Function)
    })
    await expect(recycleBinFeedbackMocks.showRecycleBinUndo.mock.calls.at(-1)?.[0].onUndo()).resolves.toBeUndefined()
    expect(hookMocks.restoreSession).toHaveBeenCalledWith('session-alpha')
    expect(getActiveSession).toHaveBeenCalledWith('/agent-sessions/session-alpha')
    expect(hookMocks.reload).toHaveBeenCalledOnce()
    getActiveSession.mockRestore()
  })

  it('archives a session without confirmation and moves the active session when needed', async () => {
    const user = userEvent.setup()
    const { onActiveRecordChange } = setupAgentHistory({ activeRecordId: 'session-alpha' })

    const alphaMenu = screen.getByText('Alpha session').closest('[data-testid="context-menu"]')
    const menuContent = alphaMenu?.querySelector('[data-testid="context-menu-content"]')
    await user.click(within(menuContent as HTMLElement).getByRole('button', { name: 'Archive' }))
    await act(async () => {
      await flushCommandMenuAction()
    })

    expect(confirmActionShow).not.toHaveBeenCalled()

    await act(async () => {
      await flushAnimationFrame()
    })

    await vi.waitFor(() => expect(hookMocks.deleteSession).toHaveBeenCalledWith('session-alpha'))
    expect(onActiveRecordChange).toHaveBeenCalledWith('session-beta')
  })

  it('clears the active session after archiving the last session from history', async () => {
    const user = userEvent.setup()
    const { onActiveRecordChange } = setupAgentHistory({
      activeRecordId: 'session-alpha',
      sessions: [createSession()]
    })

    const alphaMenu = screen.getByText('Alpha session').closest('[data-testid="context-menu"]')
    const menuContent = alphaMenu?.querySelector('[data-testid="context-menu-content"]')
    await user.click(within(menuContent as HTMLElement).getByRole('button', { name: 'Archive' }))
    await act(async () => {
      await flushCommandMenuAction()
    })

    await act(async () => {
      await flushAnimationFrame()
    })

    await vi.waitFor(() => expect(hookMocks.deleteSession).toHaveBeenCalledWith('session-alpha'))
    expect(onActiveRecordChange).toHaveBeenCalledWith(null)
  })

  it('keeps the active session unchanged when history archiving fails', async () => {
    const user = userEvent.setup()
    hookMocks.deleteSession.mockResolvedValueOnce(false)
    const { onActiveRecordChange } = setupAgentHistory({ activeRecordId: 'session-alpha' })

    const alphaMenu = screen.getByText('Alpha session').closest('[data-testid="context-menu"]')
    const menuContent = alphaMenu?.querySelector('[data-testid="context-menu-content"]')
    await user.click(within(menuContent as HTMLElement).getByRole('button', { name: 'Archive' }))
    await act(async () => {
      await flushCommandMenuAction()
    })

    await act(async () => {
      await flushAnimationFrame()
    })

    await vi.waitFor(() => expect(hookMocks.deleteSession).toHaveBeenCalledWith('session-alpha'))
    expect(onActiveRecordChange).not.toHaveBeenCalled()
    expect(recycleBinFeedbackMocks.showRecycleBinUndo).not.toHaveBeenCalled()
  })

  function permanentDeleteButton(name: string) {
    const menu = screen.getByText(name).closest('[data-testid="context-menu"]')
    const content = menu?.querySelector('[data-testid="context-menu-content"]')
    return within(content as HTMLElement).getByRole('button', { name: /Delete Permanently/ })
  }

  it('opens the shared permanent-delete confirmation from the focused history row shortcut', async () => {
    cleanup()
    setupAgentHistory({ activeRecordId: 'session-alpha' })
    cleanup()
    render(
      <CommandProvider>
        <HistoryRecordsView mode="agent" open activeRecordId="session-alpha" onClose={vi.fn()} />
      </CommandProvider>
    )
    const title = screen.getByRole('button', { name: 'Alpha session' })
    act(() => {
      title.focus()
    })
    const event = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Backspace',
      code: 'Backspace',
      ctrlKey: true
    })
    act(() => {
      title.dispatchEvent(event)
    })
    await act(async () => {
      await flushCommandMenuAction()
    })
    expect(event.defaultPrevented).toBe(true)
    expect(permanentDeletePopupMocks.show).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'conversation', name: 'Alpha session', action: expect.any(Function) })
    )
    expect(hookMocks.deleteSessionWithOutcome).not.toHaveBeenCalled()
  })

  it('offers permanent deletion beside Archive and does not delete before confirm or on cancel', async () => {
    const user = userEvent.setup()
    setupAgentHistory()

    expect(permanentDeleteButton('Alpha session')).toBeEnabled()
    await user.click(permanentDeleteButton('Alpha session'))
    await act(async () => {
      await flushCommandMenuAction()
    })

    expect(permanentDeletePopupMocks.show).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'conversation',
        name: 'Alpha session',
        action: expect.any(Function)
      })
    )
    expect(hookMocks.deleteSessionWithOutcome).not.toHaveBeenCalled()
    expect(recycleBinFeedbackMocks.showRecycleBinUndo).not.toHaveBeenCalled()
  })

  it.each([
    { storedName: '', visibleName: 'Untitled' },
    { storedName: '   ', visibleName: 'Untitled' },
    { storedName: '  Padded name  ', visibleName: '  Padded name  ' }
  ])(
    'permanent delete uses the same history label as the row ($storedName) and cancel keeps it',
    async ({ storedName, visibleName }) => {
      const user = userEvent.setup()
      setupAgentHistory({
        sessions: [createSession({ id: 'session-blank', name: storedName })]
      })

      const exactText = { exact: true, normalizer: (text: string) => text }
      const title = screen.getByText(visibleName, exactText)
      const row = title.closest('[role="row"]') as HTMLElement
      expect(within(row).getByRole('checkbox')).toHaveAttribute('aria-label', `Select ${visibleName}`)
      const menu = title.closest('[data-testid="context-menu"]')
      const deleteButton = within(menu?.querySelector('[data-testid="context-menu-content"]') as HTMLElement).getByRole(
        'button',
        { name: /Delete Permanently/ }
      )

      await user.click(deleteButton)
      await act(async () => {
        await flushCommandMenuAction()
      })

      expect(permanentDeletePopupMocks.show).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'conversation', name: visibleName, action: expect.any(Function) })
      )
      expect(hookMocks.deleteSessionWithOutcome).not.toHaveBeenCalled()
      expect(screen.getByText(visibleName, exactText)).toBeInTheDocument()
    }
  )

  it('permanently deletes the confirmed session, keeps the pre-delete neighbor, and offers no Undo', async () => {
    const user = userEvent.setup()
    permanentDeletePopupMocks.show.mockImplementation(async ({ action }: { action: () => Promise<void> }) => {
      await action()
      return true
    })
    const { onActiveRecordChange } = setupAgentHistory({ activeRecordId: 'session-alpha' })

    await user.click(permanentDeleteButton('Alpha session'))
    await act(async () => {
      await flushCommandMenuAction()
    })

    expect(hookMocks.deleteSessionWithOutcome).toHaveBeenCalledExactlyOnceWith('session-alpha', {
      permanent: true,
      showFeedback: false,
      onDeleted: expect.any(Function)
    })
    expect(onActiveRecordChange).toHaveBeenCalledWith('session-beta')
    expect(recycleBinFeedbackMocks.showRecycleBinUndo).not.toHaveBeenCalled()
    expect(hookMocks.reload).not.toHaveBeenCalled()
  })

  it('clears the active session after permanently deleting the last history session', async () => {
    const user = userEvent.setup()
    permanentDeletePopupMocks.show.mockImplementation(async ({ action }: { action: () => Promise<void> }) => {
      await action()
      return true
    })
    const { onActiveRecordChange } = setupAgentHistory({
      activeRecordId: 'session-alpha',
      sessions: [createSession()]
    })

    await user.click(permanentDeleteButton('Alpha session'))
    await act(async () => {
      await flushCommandMenuAction()
    })

    expect(onActiveRecordChange).toHaveBeenCalledWith(null)
    expect(recycleBinFeedbackMocks.showRecycleBinUndo).not.toHaveBeenCalled()
  })

  it('keeps a selection the user changed while permanent delete was in flight', async () => {
    const user = userEvent.setup()
    const view = setupAgentHistory({ activeRecordId: 'session-alpha' })
    hookMocks.deleteSessionWithOutcome.mockImplementation(async () => {
      view.onActiveRecordChange.mockClear()
      await act(async () => {
        view.rerender('session-beta')
      })
      return { status: 'succeeded' }
    })
    permanentDeletePopupMocks.show.mockImplementation(async ({ action }: { action: () => Promise<void> }) => {
      await action()
      return true
    })

    await user.click(permanentDeleteButton('Alpha session'))
    await act(async () => {
      await flushCommandMenuAction()
    })

    expect(hookMocks.deleteSessionWithOutcome).toHaveBeenCalledOnce()
    expect(view.onActiveRecordChange).not.toHaveBeenCalled()
  })

  it('keeps history neighbor B when NOT_FOUND would otherwise activate globally latest C before the delete reply', async () => {
    // Display order [C, A, B]. Unguarded AgentPage recovery replaces A with non-null C
    // before the IPC reply, and History then treats C as a user choice and skips B.
    const user = userEvent.setup()
    let currentPending: string | null = null
    const events: string[] = []
    const sessions = [
      createSession({
        id: 'session-c',
        name: 'Latest session',
        lastActivityAt: '2026-05-16T08:00:00.000Z',
        updatedAt: '2026-05-16T08:00:00.000Z'
      }),
      createSession({ id: 'session-a', name: 'Active session', lastActivityAt: '2026-05-15T08:00:00.000Z' }),
      createSession({
        id: 'session-b',
        name: 'Neighbor session',
        lastActivityAt: '2026-05-14T08:00:00.000Z',
        updatedAt: '2026-05-14T08:00:00.000Z'
      })
    ]
    const view = setupAgentHistory({
      activeRecordId: 'session-a',
      sessions,
      onLocalPermanentDeletePendingChange: (id) => {
        currentPending = id
        events.push(id === null ? 'clear' : `pending:${id}`)
      }
    })
    view.onActiveRecordChange.mockImplementation((id: string | null) => {
      events.push(`select:${id ?? 'null'}`)
    })
    hookMocks.deleteSessionWithOutcome.mockImplementation(async () => {
      if (currentPending !== 'session-a') {
        await act(async () => {
          view.rerender('session-c')
        })
      }
      return { status: 'succeeded' }
    })
    permanentDeletePopupMocks.show.mockImplementation(async ({ action }: { action: () => Promise<void> }) => {
      await action()
      return true
    })

    await user.click(permanentDeleteButton('Active session'))
    await act(async () => {
      await flushCommandMenuAction()
    })

    expect(view.onActiveRecordChange).toHaveBeenCalledWith('session-b')
    expect(view.onActiveRecordChange).not.toHaveBeenCalledWith('session-c')
    expect(events).toEqual(['pending:session-a', 'select:session-b', 'clear'])
    expect(currentPending).toBeNull()
  })

  it('does not arm the pending guard when permanent delete is cancelled before it starts', async () => {
    const user = userEvent.setup()
    const pending: Array<string | null> = []
    setupAgentHistory({
      activeRecordId: 'session-alpha',
      onLocalPermanentDeletePendingChange: (id) => {
        pending.push(id)
      }
    })

    await user.click(permanentDeleteButton('Alpha session'))
    await act(async () => {
      await flushCommandMenuAction()
    })

    expect(permanentDeletePopupMocks.show).toHaveBeenCalledOnce()
    expect(hookMocks.deleteSessionWithOutcome).not.toHaveBeenCalled()
    expect(pending).toEqual([])
  })

  it('clears the pending guard without selecting a neighbor when permanent delete fails or is stale', async () => {
    const user = userEvent.setup()
    const pending: Array<string | null> = []
    let failure: unknown
    permanentDeletePopupMocks.show.mockImplementation(async ({ action }: { action: () => Promise<void> }) => {
      try {
        await action()
      } catch (error) {
        failure = error
        return false
      }
      return true
    })
    hookMocks.deleteSessionWithOutcome.mockResolvedValueOnce({ status: 'failed', error: 'Delete failed' })
    const view = setupAgentHistory({
      activeRecordId: 'session-alpha',
      onLocalPermanentDeletePendingChange: (id) => {
        pending.push(id)
      }
    })
    const openPermanentDelete = async () => {
      await user.click(permanentDeleteButton('Alpha session'))
      await act(async () => {
        await flushCommandMenuAction()
      })
    }

    await openPermanentDelete()
    expect(failure).toEqual(expect.objectContaining({ message: 'Delete failed' }))
    expect(view.onActiveRecordChange).not.toHaveBeenCalled()
    expect(pending).toEqual(['session-alpha', null])

    pending.length = 0
    failure = undefined
    hookMocks.deleteSessionWithOutcome.mockResolvedValueOnce({ status: 'stale' })
    await openPermanentDelete()
    expect(failure).toEqual(
      expect.objectContaining({
        message: 'This item has already been deleted or archived. Refresh the list and try again.'
      })
    )
    expect(view.onActiveRecordChange).not.toHaveBeenCalled()
    expect(pending).toEqual(['session-alpha', null])
  })

  it('keeps a newer non-null selection made while the history delete reply is still pending', async () => {
    const user = userEvent.setup()
    const pending: Array<string | null> = []
    const view = setupAgentHistory({
      activeRecordId: 'session-alpha',
      onLocalPermanentDeletePendingChange: (id) => {
        pending.push(id)
      }
    })
    hookMocks.deleteSessionWithOutcome.mockImplementation(async () => {
      expect(pending).toEqual(['session-alpha'])
      view.onActiveRecordChange.mockClear()
      await act(async () => {
        view.rerender('session-c')
      })
      return { status: 'succeeded' }
    })
    permanentDeletePopupMocks.show.mockImplementation(async ({ action }: { action: () => Promise<void> }) => {
      await action()
      return true
    })

    await user.click(permanentDeleteButton('Alpha session'))
    await act(async () => {
      await flushCommandMenuAction()
    })

    expect(view.onActiveRecordChange).not.toHaveBeenCalled()
    expect(pending).toEqual(['session-alpha', null])
  })

  it('selects the pre-delete neighbor when NOT_FOUND recovery clears the active session during delete', async () => {
    const user = userEvent.setup()
    const view = setupAgentHistory({ activeRecordId: 'session-alpha' })
    permanentDeletePopupMocks.show.mockImplementation(async ({ action }: { action: () => Promise<void> }) => {
      await action()
      return true
    })
    hookMocks.deleteSessionWithOutcome.mockImplementation(async () => {
      view.onActiveRecordChange.mockClear()
      await act(async () => {
        view.rerender(null)
      })
      return { status: 'succeeded' }
    })

    await user.click(permanentDeleteButton('Alpha session'))
    await act(async () => {
      await flushCommandMenuAction()
    })

    expect(hookMocks.deleteSessionWithOutcome).toHaveBeenCalledOnce()
    expect(view.onActiveRecordChange).toHaveBeenCalledWith('session-beta')
    expect(screen.getByText('Beta session')).toBeInTheDocument()
  })

  it('defers the permanent-delete confirmation until file navigation allows it', async () => {
    const user = userEvent.setup()
    let transition: (() => void) | undefined
    const requestRecordRemoval = vi.fn((next: string | null, run: () => void) => {
      expect(next).toBe('session-beta')
      transition = run
    })
    setupAgentHistory({ activeRecordId: 'session-alpha', requestRecordRemoval })

    await user.click(permanentDeleteButton('Alpha session'))
    await act(async () => {
      await flushCommandMenuAction()
    })

    expect(requestRecordRemoval).toHaveBeenCalledOnce()
    expect(permanentDeletePopupMocks.show).not.toHaveBeenCalled()
    expect(hookMocks.deleteSessionWithOutcome).not.toHaveBeenCalled()

    const guard = document.createElement('div')
    guard.setAttribute('role', 'dialog')
    document.body.append(guard)
    await user.click(permanentDeleteButton('Alpha session'))
    await act(async () => {
      await flushCommandMenuAction()
    })
    expect(requestRecordRemoval).toHaveBeenCalledOnce()
    expect(permanentDeletePopupMocks.show).not.toHaveBeenCalled()
    guard.remove()

    await user.click(permanentDeleteButton('Alpha session'))
    await act(async () => {
      await flushCommandMenuAction()
    })
    expect(requestRecordRemoval).toHaveBeenCalledTimes(2)
    expect(permanentDeletePopupMocks.show).not.toHaveBeenCalled()
    expect(hookMocks.deleteSessionWithOutcome).not.toHaveBeenCalled()

    permanentDeletePopupMocks.show.mockImplementation(async ({ action }: { action: () => Promise<void> }) => {
      await action()
      return true
    })
    hookMocks.deleteSessionWithOutcome.mockResolvedValueOnce({ status: 'succeeded' })
    transition?.()
    await act(async () => {
      await Promise.resolve()
    })
    expect(permanentDeletePopupMocks.show).toHaveBeenCalledOnce()
    expect(hookMocks.deleteSessionWithOutcome).toHaveBeenCalledOnce()
  })

  it('retries permanent delete after a cancelled guard leaves a hidden dialog', async () => {
    const user = userEvent.setup()
    const requestRecordRemoval = vi.fn()
    setupAgentHistory({ activeRecordId: 'session-alpha', requestRecordRemoval })
    const guard = document.createElement('div')
    guard.setAttribute('role', 'dialog')
    document.body.append(guard)

    await user.click(permanentDeleteButton('Alpha session'))
    await act(async () => {
      await flushCommandMenuAction()
    })
    expect(requestRecordRemoval).toHaveBeenCalledTimes(1)
    expect(permanentDeletePopupMocks.show).not.toHaveBeenCalled()

    await user.click(permanentDeleteButton('Alpha session'))
    await act(async () => {
      await flushCommandMenuAction()
    })
    expect(requestRecordRemoval).toHaveBeenCalledTimes(1)

    guard.style.display = 'none'
    await user.click(permanentDeleteButton('Alpha session'))
    await act(async () => {
      await flushCommandMenuAction()
    })
    expect(requestRecordRemoval).toHaveBeenCalledTimes(2)
    expect(permanentDeletePopupMocks.show).not.toHaveBeenCalled()
    expect(hookMocks.deleteSessionWithOutcome).not.toHaveBeenCalled()
    guard.remove()
  })

  it('passes a null neighbor through the file guard for the last active session and still waits for confirmation', async () => {
    const user = userEvent.setup()
    let transition: (() => void) | undefined
    const requestRecordRemoval = vi.fn((next: string | null, run: () => void) => {
      expect(next).toBeNull()
      transition = run
    })
    const { onActiveRecordChange } = setupAgentHistory({
      activeRecordId: 'session-alpha',
      requestRecordRemoval,
      sessions: [createSession()]
    })

    await user.click(permanentDeleteButton('Alpha session'))
    await act(async () => {
      await flushCommandMenuAction()
    })
    expect(hookMocks.deleteSessionWithOutcome).not.toHaveBeenCalled()
    expect(permanentDeletePopupMocks.show).not.toHaveBeenCalled()

    permanentDeletePopupMocks.show.mockImplementation(async ({ action }: { action: () => Promise<void> }) => {
      await action()
      return true
    })
    transition?.()
    await act(async () => {
      await Promise.resolve()
    })

    expect(hookMocks.deleteSessionWithOutcome).toHaveBeenCalledExactlyOnceWith('session-alpha', {
      permanent: true,
      showFeedback: false,
      onDeleted: expect.any(Function)
    })
    expect(onActiveRecordChange).toHaveBeenCalledWith(null)
  })

  it('discards a deferred draft only after the active history session is permanently deleted', async () => {
    const user = userEvent.setup()
    const order: string[] = []
    const commitDiscard = vi.fn(() => order.push('discard'))
    const requestRecordRemoval = vi.fn(
      (next: string | null, run: AgentFileNavigationTransition, options?: AgentFileNavigationOptions) => {
        expect(next).toBe('session-beta')
        expect(options).toEqual({ deferDraftDisposal: true })
        run({ commitDiscard })
      }
    )
    hookMocks.deleteSessionWithOutcome.mockImplementation(async (_id, options) => {
      options?.onDeleted?.()
      order.push('deleted')
      return { status: 'succeeded' }
    })
    permanentDeletePopupMocks.show.mockImplementation(async ({ action }: { action: () => Promise<void> }) => {
      await action()
      return true
    })
    const { onActiveRecordChange } = setupAgentHistory({ activeRecordId: 'session-alpha', requestRecordRemoval })
    onActiveRecordChange.mockImplementation(() => order.push('select'))

    await user.click(permanentDeleteButton('Alpha session'))
    await act(async () => {
      await flushCommandMenuAction()
    })

    await vi.waitFor(() => expect(order).toEqual(['discard', 'deleted', 'select']))
    expect(onActiveRecordChange).toHaveBeenCalledWith('session-beta')
  })

  it('does not discard a deferred draft when history deletion fails, is stale, or the user selects another session', async () => {
    const user = userEvent.setup()
    const commitDiscard = vi.fn()
    let removalSettled = Promise.resolve()
    const requestRecordRemoval = vi.fn((_next: string | null, run: AgentFileNavigationTransition) => {
      removalSettled = Promise.resolve(run({ commitDiscard })).then(
        () => undefined,
        () => undefined
      )
    })
    permanentDeletePopupMocks.show.mockImplementation(async ({ action }: { action: () => Promise<void> }) => {
      try {
        await action()
      } catch {
        return false
      }
      return true
    })
    hookMocks.deleteSessionWithOutcome.mockResolvedValueOnce({ status: 'failed', error: 'Delete failed' })
    const view = setupAgentHistory({ activeRecordId: 'session-alpha', requestRecordRemoval })

    await user.click(permanentDeleteButton('Alpha session'))
    await act(async () => {
      await flushCommandMenuAction()
    })
    await removalSettled

    expect(hookMocks.deleteSessionWithOutcome).toHaveBeenCalledWith(
      'session-alpha',
      expect.objectContaining({ permanent: true, showFeedback: false, onDeleted: expect.any(Function) })
    )
    expect(commitDiscard).not.toHaveBeenCalled()
    expect(view.onActiveRecordChange).not.toHaveBeenCalled()

    hookMocks.deleteSessionWithOutcome.mockResolvedValueOnce({ status: 'stale' })
    await user.click(permanentDeleteButton('Alpha session'))
    await act(async () => {
      await flushCommandMenuAction()
    })
    await removalSettled
    expect(commitDiscard).not.toHaveBeenCalled()
    expect(view.onActiveRecordChange).not.toHaveBeenCalled()

    hookMocks.deleteSessionWithOutcome.mockImplementation(async () => {
      view.onActiveRecordChange.mockClear()
      await act(async () => {
        view.rerender('session-beta')
      })
      const options = hookMocks.deleteSessionWithOutcome.mock.calls.at(-1)?.[1] as { onDeleted?: () => void }
      options.onDeleted?.()
      return { status: 'succeeded' }
    })
    await user.click(permanentDeleteButton('Alpha session'))
    await act(async () => {
      await flushCommandMenuAction()
    })
    await removalSettled
    expect(commitDiscard).not.toHaveBeenCalled()
    expect(view.onActiveRecordChange).not.toHaveBeenCalled()
  })

  it('hides permanent delete for a pinned session and rejects a pin that lands before confirm', async () => {
    const user = userEvent.setup()
    setupAgentHistory({ pinIdBySessionId: new Map([['session-alpha', 'pin-session-alpha']]) })
    const menu = screen.getByText('Alpha session').closest('[data-testid="context-menu"]')
    const content = menu?.querySelector('[data-testid="context-menu-content"]')
    expect(within(content as HTMLElement).queryByRole('button', { name: /Delete Permanently/ })).not.toBeInTheDocument()
    cleanup()

    let confirm: (() => Promise<void>) | undefined
    permanentDeletePopupMocks.show.mockImplementation((params: { action: () => Promise<void> }) => {
      confirm = params.action
      return new Promise(() => undefined)
    })
    const view = setupAgentHistory()
    await user.click(permanentDeleteButton('Alpha session'))
    await act(async () => {
      await flushCommandMenuAction()
    })
    hookMocks.useSessions.mockReturnValue({
      sessions: hookMocks.useSessions().sessions,
      pinIdBySessionId: new Map([['session-alpha', 'pin-session-alpha']]),
      error: undefined,
      isLoading: false,
      deleteSession: hookMocks.deleteSession,
      deleteSessionWithOutcome: hookMocks.deleteSessionWithOutcome,
      deleteSessions: hookMocks.deleteSessions,
      reload: hookMocks.reload,
      restoreSession: hookMocks.restoreSession,
      togglePin: hookMocks.togglePin
    })
    view.rerender(null)
    await expect(confirm?.()).rejects.toThrow('Unpin this conversation before permanently deleting it.')
    expect(hookMocks.deleteSessionWithOutcome).not.toHaveBeenCalled()
  })

  it('disables permanent delete while the session is generating and rechecks the latest stream on confirm', async () => {
    const user = userEvent.setup()
    cacheService.setShared(
      'topic.stream.statuses.agent-session:session-alpha' as never,
      { status: 'pending', awaitingApprovalAnchors: [] } as never
    )
    setupAgentHistory()
    expect(permanentDeleteButton('Alpha session')).toBeDisabled()
    cleanup()

    cacheService.deleteShared('topic.stream.statuses.agent-session:session-alpha' as never)
    let confirm: (() => Promise<void>) | undefined
    permanentDeletePopupMocks.show.mockImplementation((params: { action: () => Promise<void> }) => {
      confirm = params.action
      return new Promise(() => undefined)
    })
    setupAgentHistory()
    await user.click(permanentDeleteButton('Alpha session'))
    await act(async () => {
      await flushCommandMenuAction()
    })
    cacheService.setShared(
      'topic.stream.statuses.agent-session:session-alpha' as never,
      { status: 'streaming', awaitingApprovalAnchors: [] } as never
    )
    await expect(confirm?.()).rejects.toThrow('Stop generation before permanently deleting this conversation.')
    expect(hookMocks.deleteSessionWithOutcome).not.toHaveBeenCalled()
    expect(recycleBinFeedbackMocks.showRecycleBinUndo).not.toHaveBeenCalled()
  })

  it('refreshes and rejects when permanent session deletion is stale or fails, without Undo', async () => {
    const user = userEvent.setup()
    let failure: unknown
    permanentDeletePopupMocks.show.mockImplementation(async ({ action }: { action: () => Promise<void> }) => {
      try {
        await action()
      } catch (error) {
        failure = error
        return false
      }
      return true
    })
    hookMocks.deleteSessionWithOutcome.mockResolvedValueOnce({ status: 'stale' })
    const { onActiveRecordChange } = setupAgentHistory({ activeRecordId: 'session-alpha' })
    const openPermanentDelete = async () => {
      await user.click(permanentDeleteButton('Alpha session'))
      await act(async () => {
        await flushCommandMenuAction()
      })
    }

    await openPermanentDelete()
    expect(failure).toEqual(
      expect.objectContaining({
        message: 'This item has already been deleted or archived. Refresh the list and try again.'
      })
    )
    expect(hookMocks.reload).toHaveBeenCalledOnce()
    expect(onActiveRecordChange).not.toHaveBeenCalled()
    expect(recycleBinFeedbackMocks.showRecycleBinUndo).not.toHaveBeenCalled()

    failure = undefined
    hookMocks.reload.mockClear()
    hookMocks.deleteSessionWithOutcome.mockResolvedValueOnce({ status: 'failed', error: 'Delete failed' })
    await openPermanentDelete()
    expect(failure).toEqual(expect.objectContaining({ message: 'Delete failed' }))
    expect(hookMocks.reload).toHaveBeenCalledOnce()
    expect(onActiveRecordChange).not.toHaveBeenCalled()
    expect(recycleBinFeedbackMocks.showRecycleBinUndo).not.toHaveBeenCalled()
  })

  it('still throws the stale error when refreshing after a failed permanent delete also fails', async () => {
    const user = userEvent.setup()
    let failure: unknown
    hookMocks.reload.mockRejectedValueOnce(new Error('refresh down'))
    hookMocks.deleteSessionWithOutcome.mockResolvedValueOnce({ status: 'stale' })
    permanentDeletePopupMocks.show.mockImplementation(async ({ action }: { action: () => Promise<void> }) => {
      try {
        await action()
      } catch (error) {
        failure = error
        return false
      }
      return true
    })
    const { onActiveRecordChange } = setupAgentHistory({ activeRecordId: 'session-alpha' })

    await user.click(permanentDeleteButton('Alpha session'))
    await act(async () => {
      await flushCommandMenuAction()
    })

    expect(failure).toEqual(
      expect.objectContaining({
        message: 'This item has already been deleted or archived. Refresh the list and try again.'
      })
    )
    expect(onActiveRecordChange).not.toHaveBeenCalled()
    expect(recycleBinFeedbackMocks.showRecycleBinUndo).not.toHaveBeenCalled()
  })
})
