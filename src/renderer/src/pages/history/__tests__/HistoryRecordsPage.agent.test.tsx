import type { AgentSessionEntity } from '@shared/data/api/schemas/sessions'
import type { AgentEntity } from '@shared/data/types/agent'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import type { InputHTMLAttributes, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hookMocks = vi.hoisted(() => ({
  cacheGet: vi.fn(),
  cacheGetShared: vi.fn(),
  cacheSet: vi.fn(),
  cacheSubscribe: vi.fn(),
  deleteSession: vi.fn(),
  promptShow: vi.fn(),
  setActiveSessionId: vi.fn(),
  togglePin: vi.fn(),
  updateSession: vi.fn(),
  useAgents: vi.fn(),
  useAllTopics: vi.fn(),
  useAssistants: vi.fn(),
  useCache: vi.fn(),
  useMultiplePreferences: vi.fn(),
  usePins: vi.fn(),
  useSessions: vi.fn(),
  useUpdateSession: vi.fn()
}))

vi.mock('@cherrystudio/ui', async () => {
  const React = await import('react')
  const itemHandler = (onSelect: ((event: Event) => void) | undefined, props: Record<string, unknown>) => ({
    ...props,
    'data-disabled': props.disabled ? '' : undefined,
    disabled: props.disabled as boolean | undefined,
    onClick: (event: Event) => onSelect?.(event),
    type: 'button'
  })

  return {
    Button: ({ children, loading: _loading, ...props }: { children?: ReactNode; loading?: boolean }) => (
      <button type="button" {...props}>
        {children}
      </button>
    ),
    ConfirmDialog: ({
      cancelText,
      confirmText,
      contentClassName,
      description,
      onConfirm,
      open,
      overlayClassName,
      title
    }: any) =>
      open ? (
        <div role="dialog" className={contentClassName} data-overlay-class={overlayClassName}>
          <h2>{title}</h2>
          {description && <p>{description}</p>}
          <button type="button">{cancelText ?? 'Cancel'}</button>
          <button type="button" onClick={onConfirm}>
            {confirmText ?? 'Confirm'}
          </button>
        </div>
      ) : null,
    ContextMenu: ({ children }: { children?: ReactNode }) => <div data-testid="context-menu">{children}</div>,
    ContextMenuContent: ({ children, ...props }: { children?: ReactNode }) => (
      <div data-testid="context-menu-content" {...props}>
        {children}
      </div>
    ),
    ContextMenuItem: ({ children, onSelect, ...props }: any) =>
      React.createElement('button', itemHandler(onSelect, props), children),
    ContextMenuSeparator: (props: any) => <hr data-testid="context-menu-separator" {...props} />,
    ContextMenuShortcut: ({ children, ...props }: { children?: ReactNode }) => <span {...props}>{children}</span>,
    ContextMenuSub: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    ContextMenuSubContent: ({ children, ...props }: { children?: ReactNode }) => <div {...props}>{children}</div>,
    ContextMenuSubTrigger: ({ children, ...props }: { children?: ReactNode }) => (
      <button type="button" {...props}>
        {children}
      </button>
    ),
    ContextMenuTrigger: ({ children }: { children?: ReactNode }) => <>{children}</>,
    Dialog: ({ children, open }: { children?: ReactNode; open?: boolean }) => (open ? <>{children}</> : null),
    DialogContent: ({ children, showCloseButton: _showCloseButton, ...props }: any) => (
      <div role="dialog" {...props}>
        {children}
      </div>
    ),
    DialogFooter: ({ children, ...props }: { children?: ReactNode }) => <div {...props}>{children}</div>,
    DialogHeader: ({ children, ...props }: { children?: ReactNode }) => <div {...props}>{children}</div>,
    DialogTitle: ({ children, ...props }: { children?: ReactNode }) => <h2 {...props}>{children}</h2>,
    EmptyState: ({ description, title }: { description?: string; title: string }) => (
      <div>
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
    ),
    FieldError: ({ children, ...props }: { children?: ReactNode }) => <p {...props}>{children}</p>,
    Input: (props: InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
    Label: ({ children, ...props }: { children?: ReactNode }) => <label {...props}>{children}</label>,
    Skeleton: (props: Record<string, unknown>) => <div {...props} />
  }
})

vi.mock('@data/CacheService', () => ({
  cacheService: {
    get: hookMocks.cacheGet,
    getShared: hookMocks.cacheGetShared,
    set: hookMocks.cacheSet,
    subscribe: hookMocks.cacheSubscribe
  }
}))

vi.mock('@renderer/components/VirtualList', () => ({
  DynamicVirtualList: <T,>({ children, list }: { children: (item: T, index: number) => ReactNode; list: T[] }) => (
    <div>
      {list.map((item, index) => (
        <div key={(item as { id?: string }).id ?? index}>{children(item, index)}</div>
      ))}
    </div>
  )
}))

vi.mock('@renderer/data/hooks/useCache', () => ({
  useCache: hookMocks.useCache
}))

vi.mock('@renderer/data/hooks/usePreference', () => ({
  useMultiplePreferences: hookMocks.useMultiplePreferences
}))

vi.mock('@renderer/hooks/agents/useAgentDataApi', () => ({
  useAgents: hookMocks.useAgents
}))

vi.mock('@renderer/hooks/agents/useSessionDataApi', () => ({
  useSessions: hookMocks.useSessions,
  useUpdateSession: hookMocks.useUpdateSession
}))

vi.mock('@renderer/hooks/useAssistant', () => ({
  useAssistants: hookMocks.useAssistants
}))

vi.mock('@renderer/hooks/useTopicDataApi', () => ({
  mapApiTopicToRendererTopic: (topic: { id: string }) => topic,
  useAllTopics: hookMocks.useAllTopics,
  useTopicMutations: () => ({
    deleteTopic: vi.fn(),
    updateTopic: vi.fn()
  })
}))

vi.mock('@renderer/hooks/usePins', () => ({
  usePins: hookMocks.usePins
}))

vi.mock('@renderer/hooks/useNotesSettings', () => ({
  useNotesSettings: () => ({ notesPath: '/notes' })
}))

vi.mock('@renderer/hooks/useTopic', () => ({
  finishTopicRenaming: vi.fn(),
  getTopicMessages: vi.fn().mockResolvedValue([]),
  startTopicRenaming: vi.fn()
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
    t: (key: string, fallback?: string, options?: Record<string, unknown>) => {
      const labels: Record<string, string> = {
        'agent.session.group.unknown_agent': 'Unknown agent',
        'agent.session.delete.content': 'Delete this session?',
        'agent.session.delete.title': 'Delete session',
        'agent.session.edit.title': 'Edit session',
        'agent.session.update.error.failed': 'Failed to update session',
        'chat.topics.pin': 'Pin',
        'chat.topics.unpin': 'Unpin',
        'common.agent': 'Agent',
        'common.all': 'All',
        'common.cancel': 'Cancel',
        'common.close': 'Close',
        'common.delete': 'Delete',
        'common.name': 'Name',
        'common.rename': 'Rename',
        'common.required_field': 'Required field',
        'common.save': 'Save',
        'common.saved': 'Saved',
        'common.unnamed': 'Untitled',
        'history.records.agentSubtitle': '{{count}} sessions',
        'history.records.agentTitle': 'Agent history',
        'history.records.empty.sessionsDescription': 'No sessions for the current filters.',
        'history.records.empty.sessionsTitle': 'No sessions',
        'history.records.loading.sessionsDescription': 'Loading sessions.',
        'history.records.loading.sessionsTitle': 'Loading sessions',
        'history.records.resultCount': '{{count}} results',
        'history.records.searchSession': 'Search sessions...',
        'history.records.sidebar.status': 'Status',
        'history.records.status.completed': 'Completed',
        'history.records.status.failed': 'Failed',
        'history.records.status.running': 'Running',
        'history.records.table.session': 'Session',
        'history.records.table.time': 'Time'
      }
      const template = labels[key] ?? fallback ?? key
      return template.replace('{{count}}', String(options?.count ?? ''))
    }
  })
}))

import HistoryRecordsPage from '../HistoryRecordsPage'

function createSession(overrides: Partial<AgentSessionEntity> = {}): AgentSessionEntity {
  return {
    id: 'session-alpha',
    agentId: 'agent-alpha',
    name: 'Alpha session',
    description: 'Planning notes',
    accessiblePaths: [],
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
    model: 'model-alpha',
    modelName: 'Claude',
    name: 'Alpha agent',
    configuration: { avatar: 'A' },
    createdAt: '2026-05-13T08:00:00.000Z',
    updatedAt: '2026-05-14T08:00:00.000Z',
    ...overrides
  }
}

function setupAgentHistory({
  activeSessionId = null,
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
      orderKey: 'b'
    })
  ]
}: {
  activeSessionId?: string | null
  agents?: AgentEntity[]
  sessions?: AgentSessionEntity[]
} = {}) {
  hookMocks.useAgents.mockReturnValue({ agents, error: undefined, isLoading: false })
  hookMocks.useSessions.mockReturnValue({
    sessions,
    pinIdBySessionId: new Map(),
    error: undefined,
    isLoading: false,
    deleteSession: hookMocks.deleteSession,
    togglePin: hookMocks.togglePin
  })
  hookMocks.useCache.mockReturnValue([activeSessionId, hookMocks.setActiveSessionId])

  const onClose = vi.fn()
  render(<HistoryRecordsPage mode="agent" open onClose={onClose} />)

  return { onClose }
}

describe('HistoryRecordsPage agent mode', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="agent-page"></div><div id="home-page"></div>'
    Object.assign(window, {
      toast: {
        error: vi.fn(),
        success: vi.fn(),
        warning: vi.fn()
      }
    })
    hookMocks.cacheGet.mockReset()
    hookMocks.cacheGet.mockReturnValue(undefined)
    hookMocks.cacheGetShared.mockReset()
    hookMocks.cacheGetShared.mockReturnValue(undefined)
    hookMocks.cacheSet.mockReset()
    hookMocks.cacheSubscribe.mockReset()
    hookMocks.cacheSubscribe.mockReturnValue(() => undefined)
    hookMocks.deleteSession.mockReset()
    hookMocks.deleteSession.mockResolvedValue(true)
    hookMocks.promptShow.mockReset()
    hookMocks.setActiveSessionId.mockReset()
    hookMocks.togglePin.mockReset()
    hookMocks.togglePin.mockResolvedValue(undefined)
    hookMocks.updateSession.mockReset()
    hookMocks.updateSession.mockResolvedValue(createSession({ name: 'Renamed session' }))
    hookMocks.useAgents.mockReset()
    hookMocks.useAllTopics.mockReset()
    hookMocks.useAssistants.mockReset()
    hookMocks.useCache.mockReset()
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
    setupAgentHistory()

    expect(hookMocks.useSessions).toHaveBeenCalledWith(undefined, { loadAll: true, pageSize: 50 })
    expect(hookMocks.useAllTopics).not.toHaveBeenCalled()
    expect(hookMocks.useAssistants).not.toHaveBeenCalled()
    expect(screen.getByText('Agent history')).toBeInTheDocument()
    expect(screen.queryByText('Messages')).not.toBeInTheDocument()
    expect(screen.queryByText('消息')).not.toBeInTheDocument()
    expect(screen.getByText('Alpha session')).toBeInTheDocument()
    expect(screen.getByText('Planning notes')).toBeInTheDocument()
    expect(screen.getAllByText('Alpha agent')).toHaveLength(2)
    expect(screen.getByText('Beta session')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Gamma agent 0/ })).toBeInTheDocument()
    expect(screen.queryByText('Agent placeholder')).not.toBeInTheDocument()
  })

  it('filters sessions by selected agent source', () => {
    setupAgentHistory()

    fireEvent.click(screen.getAllByRole('button', { name: /Beta agent/ })[0])

    expect(screen.queryByText('Alpha session')).not.toBeInTheDocument()
    expect(screen.getByText('Beta session')).toBeInTheDocument()
  })

  it('restores the agent status selector and filters by existing stream status', () => {
    hookMocks.cacheGetShared.mockImplementation((key: string) => {
      if (key.includes('session-beta')) return { status: 'streaming', activeExecutions: [] }
      return undefined
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

  it('searches locally by session name, description, and agent name', () => {
    setupAgentHistory()

    fireEvent.change(screen.getByPlaceholderText('Search sessions...'), { target: { value: 'runbook' } })

    expect(screen.queryByText('Alpha session')).not.toBeInTheDocument()
    expect(screen.getByText('Beta session')).toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('Search sessions...'), { target: { value: 'alpha agent' } })

    expect(screen.getByText('Alpha session')).toBeInTheDocument()
    expect(screen.queryByText('Beta session')).not.toBeInTheDocument()
  })

  it('activates the selected session and closes history', () => {
    const { onClose } = setupAgentHistory()

    fireEvent.click(screen.getByText('Beta session'))

    expect(hookMocks.setActiveSessionId).toHaveBeenCalledWith('session-beta')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('renders an empty state when there are no sessions', () => {
    setupAgentHistory({ sessions: [] })

    expect(screen.getByText('No sessions')).toBeInTheDocument()
    expect(screen.getByText('No sessions for the current filters.')).toBeInTheDocument()
  })

  it('renders the external session context menu for history rows', () => {
    setupAgentHistory()

    const alphaMenu = screen.getByText('Alpha session').closest('[data-testid="context-menu"]')
    const menuContent = alphaMenu?.querySelector('[data-testid="context-menu-content"]')

    expect(menuContent ?? null).toBeInTheDocument()
    expect(menuContent).toHaveClass('z-50')
    expect(Array.from(menuContent?.children ?? []).map((child) => child.textContent)).toEqual([
      'Rename',
      'Pin',
      '',
      'Delete'
    ])
  })

  it('renames a session from the history row context menu without selecting the row', async () => {
    const { onClose } = setupAgentHistory()

    const alphaMenu = screen.getByText('Alpha session').closest('[data-testid="context-menu"]')
    const menuContent = alphaMenu?.querySelector('[data-testid="context-menu-content"]')
    fireEvent.click(within(menuContent as HTMLElement).getByRole('button', { name: 'Rename' }))

    expect(hookMocks.promptShow).not.toHaveBeenCalled()
    expect(hookMocks.setActiveSessionId).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(hookMocks.updateSession).not.toHaveBeenCalled()

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('Edit session')
    const input = within(dialog).getByLabelText('Name')
    expect(hookMocks.updateSession).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: 'Renamed session' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await vi.waitFor(() =>
      expect(hookMocks.updateSession).toHaveBeenCalledWith(
        { id: 'session-alpha', name: 'Renamed session' },
        { showSuccessToast: false }
      )
    )
  })

  it('pins a session from the history row context menu without selecting the row', () => {
    const { onClose } = setupAgentHistory()

    const alphaMenu = screen.getByText('Alpha session').closest('[data-testid="context-menu"]')
    const menuContent = alphaMenu?.querySelector('[data-testid="context-menu-content"]')
    fireEvent.click(within(menuContent as HTMLElement).getByRole('button', { name: 'Pin' }))

    expect(hookMocks.togglePin).toHaveBeenCalledWith('session-alpha')
    expect(hookMocks.setActiveSessionId).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('confirms session deletion and moves the active session when needed', async () => {
    setupAgentHistory({ activeSessionId: 'session-alpha' })

    const alphaMenu = screen.getByText('Alpha session').closest('[data-testid="context-menu"]')
    const menuContent = alphaMenu?.querySelector('[data-testid="context-menu-content"]')
    fireEvent.click(within(menuContent as HTMLElement).getByRole('button', { name: 'Delete' }))

    expect(screen.getByRole('dialog')).toHaveTextContent('Delete session')
    expect(screen.getByRole('dialog')).toHaveClass('z-50')
    expect(screen.getByRole('dialog')).toHaveAttribute('data-overlay-class', 'z-40')
    expect(hookMocks.deleteSession).not.toHaveBeenCalled()

    await act(async () => {
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }))
    })

    expect(hookMocks.deleteSession).toHaveBeenCalledWith('session-alpha')
    expect(hookMocks.setActiveSessionId).toHaveBeenCalledWith('session-beta')
  })
})
