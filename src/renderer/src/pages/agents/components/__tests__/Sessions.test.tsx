import type * as CherryStudioUi from '@cherrystudio/ui'
import type { AgentSessionEntity } from '@shared/data/api/schemas/sessions'
import { act, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@cherrystudio/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof CherryStudioUi>()
  return actual
})

beforeAll(() => {
  HTMLElement.prototype.scrollIntoView = () => {}
})

const virtualMocks = vi.hoisted(() => ({
  useVirtualizer: vi.fn((options: { count: number; estimateSize: (index: number) => number }) => ({
    getVirtualItems: () =>
      Array.from({ length: options.count }, (_, index) => ({
        index,
        key: `row-${index}`,
        start: index * options.estimateSize(index),
        size: options.estimateSize(index)
      })),
    getTotalSize: () => options.count * 40,
    measureElement: vi.fn(),
    scrollElement: null
  }))
}))

const dndMocks = vi.hoisted(() => ({
  droppableData: new Map<string, unknown>(),
  onDragCancel: undefined as undefined | ((event: any) => void),
  onDragEnd: undefined as undefined | ((event: any) => void),
  onDragOver: undefined as undefined | ((event: any) => void),
  onDragStart: undefined as undefined | ((event: any) => void),
  sortableData: new Map<string, unknown>()
}))

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: virtualMocks.useVirtualizer,
  defaultRangeExtractor: vi.fn((range) =>
    Array.from({ length: range.endIndex - range.startIndex + 1 }, (_, i) => range.startIndex + i)
  )
}))

vi.mock('@dnd-kit/core', () => {
  const React = require('react')
  return {
    DndContext: ({
      children,
      onDragCancel,
      onDragEnd,
      onDragOver,
      onDragStart
    }: {
      children: ReactNode
      onDragCancel?: any
      onDragEnd?: any
      onDragOver?: any
      onDragStart?: any
    }) => {
      dndMocks.onDragCancel = onDragCancel
      dndMocks.onDragEnd = onDragEnd
      dndMocks.onDragOver = onDragOver
      dndMocks.onDragStart = onDragStart
      return React.createElement('div', { 'data-testid': 'dnd-context' }, children)
    },
    DragOverlay: ({ children }: { children: ReactNode }) =>
      React.createElement('div', { 'data-testid': 'drag-overlay' }, children),
    KeyboardSensor: vi.fn(),
    PointerSensor: vi.fn(),
    useDroppable: ({ data, id }: { data: unknown; id: string }) => {
      dndMocks.droppableData.set(id, data)
      return { isOver: false, setNodeRef: vi.fn() }
    },
    useSensor: vi.fn((sensor, options) => ({ sensor, options })),
    useSensors: vi.fn((...sensors) => sensors)
  }
})

vi.mock('@dnd-kit/sortable', () => {
  const React = require('react')
  return {
    SortableContext: ({ children }: { children: ReactNode }) =>
      React.createElement('div', { 'data-testid': 'sortable-context' }, children),
    useSortable: ({ data, id }: { data?: unknown; id: string }) => {
      if (data) {
        dndMocks.sortableData.set(id, data)
      }

      return {
        attributes: { 'data-sortable-id': id },
        listeners: {},
        setNodeRef: vi.fn(),
        transform: null,
        transition: undefined,
        isDragging: false
      }
    },
    verticalListSortingStrategy: {}
  }
})

vi.mock('@dnd-kit/utilities', () => ({
  CSS: {
    Transform: {
      toString: () => undefined
    }
  }
}))

const sessionDataMocks = vi.hoisted(() => ({
  createSession: vi.fn().mockResolvedValue({ id: 'created-session' }),
  deleteSession: vi.fn().mockResolvedValue(true),
  reload: vi.fn().mockResolvedValue(undefined),
  reorderSession: vi.fn().mockResolvedValue(true),
  togglePin: vi.fn().mockResolvedValue(undefined),
  updateSession: vi.fn().mockResolvedValue(undefined),
  useUpdateSession: vi.fn(),
  useSessions: vi.fn()
}))

const agentDataMocks = vi.hoisted(() => ({
  useAgents: vi.fn()
}))

const preferenceMocks = vi.hoisted(() => ({
  values: new Map<string, unknown>(),
  setPreference: vi.fn()
}))

const cacheMocks = vi.hoisted(() => ({
  state: { activeSessionId: 'session-a' as string | null },
  setActiveSessionId: vi.fn()
}))

const topicStreamStatusMocks = vi.hoisted(() => ({
  useTopicStreamStatus: vi.fn(() => ({
    activeExecutions: [],
    isFulfilled: false,
    isPending: false,
    markSeen: vi.fn(),
    status: undefined
  }))
}))

vi.mock('@renderer/hooks/agents/useSessionDataApi', () => ({
  useSessions: sessionDataMocks.useSessions,
  useUpdateSession: sessionDataMocks.useUpdateSession
}))

vi.mock('@renderer/hooks/agents/useAgentDataApi', () => ({
  useAgents: agentDataMocks.useAgents
}))

vi.mock('@renderer/data/hooks/usePreference', () => ({
  usePreference: (key: string) => [
    preferenceMocks.values.get(key),
    (value: unknown) => {
      preferenceMocks.values.set(key, value)
      preferenceMocks.setPreference(key, value)
    }
  ]
}))

vi.mock('@renderer/data/hooks/useCache', () => ({
  useCache: (key: string) => {
    if (key === 'agent.active_session_id') {
      return [
        cacheMocks.state.activeSessionId,
        (id: string | null) => {
          cacheMocks.state.activeSessionId = id
          cacheMocks.setActiveSessionId(id)
        }
      ]
    }
    return [undefined, vi.fn()]
  }
}))

vi.mock('@renderer/hooks/useTopicStreamStatus', () => ({
  useTopicStreamStatus: topicStreamStatusMocks.useTopicStreamStatus
}))

vi.mock('@renderer/data/hooks/useDataApi', () => ({
  useQuery: vi.fn((path: string) => {
    if (path === '/agents') {
      const agentResult = agentDataMocks.useAgents()
      return {
        data: {
          items: agentResult.agents,
          page: 1,
          total: agentResult.agents.length
        },
        isLoading: agentResult.isLoading,
        isRefreshing: false,
        error: agentResult.error,
        refetch: vi.fn(),
        mutate: vi.fn()
      }
    }

    return {
      data: [],
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      refetch: vi.fn(),
      mutate: vi.fn()
    }
  })
}))

vi.mock('@renderer/hooks/usePins', () => ({
  usePins: vi.fn(() => ({
    isLoading: false,
    isRefreshing: false,
    isMutating: false,
    pinnedIds: [],
    refetch: vi.fn(),
    togglePin: vi.fn()
  }))
}))

vi.mock('@renderer/utils/agentSession', () => ({
  buildAgentSessionTopicId: (sessionId: string) => `agent-session:${sessionId}`,
  getChannelTypeIcon: vi.fn(() => undefined)
}))

vi.mock('react-i18next', () => ({
  initReactI18next: {
    init: vi.fn(),
    type: '3rdParty'
  },
  useTranslation: () => ({
    t: (key: string) => {
      const labels: Record<string, string> = {
        'agent.session.add.title': 'Add session',
        'agent.session.display.agent': 'Agent',
        'agent.session.display.time': 'Time',
        'agent.session.display.title': 'Display mode',
        'agent.session.display.workdir': 'Workspace',
        'agent.session.edit.title': 'Edit session',
        'agent.session.get.error.failed': 'Failed to get sessions',
        'agent.session.group.collapse': 'Collapse sessions',
        'agent.session.group.earlier': 'Earlier',
        'agent.session.group.no_workdir': 'No workspace',
        'agent.session.group.show_more': 'Show more sessions',
        'agent.session.group.this_week': 'This week',
        'agent.session.group.today': 'Today',
        'agent.session.group.unknown_agent': 'Unknown agent',
        'agent.session.group.yesterday': 'Yesterday',
        'agent.session.list.title': 'Sessions',
        'agent.session.reorder.error.failed': 'Failed to reorder sessions',
        'agent.session.search.placeholder': 'Search sessions',
        'agent.session.update.error.failed': 'Failed to update session',
        'chat.topics.delete.shortcut': 'Hold Ctrl to delete directly',
        'chat.topics.pin': 'Pin',
        'chat.topics.unpin': 'Unpin',
        'common.delete': 'Delete',
        'common.error': 'Error',
        'common.loading': 'Loading...',
        'common.retry': 'Retry',
        'common.saved': 'Saved',
        'common.unnamed': 'Untitled',
        'error.model.not_exists': 'Model does not exist',
        'selector.agent.create_new': 'Create agent',
        'selector.agent.empty_text': 'No agents',
        'selector.agent.search_placeholder': 'Search agents',
        'selector.common.edit': 'Edit',
        'selector.common.pin': 'Pin',
        'selector.common.pinned_title': 'Pinned',
        'selector.common.sort.asc': 'Oldest first',
        'selector.common.sort.desc': 'Newest first',
        'selector.common.sort_label': 'Sort',
        'selector.common.unpin': 'Unpin',
        'shortcut.general.toggle_sidebar': 'Toggle sidebar'
      }
      return labels[key] ?? key
    }
  })
}))

import Sessions from '../Sessions'

const CURRENT_SESSION_ISO = new Date().toISOString()

function createSession(overrides: Partial<AgentSessionEntity> = {}): AgentSessionEntity {
  return {
    id: 'session-a',
    agentId: 'agent-a',
    name: 'Alpha session',
    description: '',
    accessiblePaths: ['/Users/jd/project-a'],
    orderKey: 'a',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: CURRENT_SESSION_ISO,
    ...overrides
  }
}

function sortableData(id: string) {
  const data = dndMocks.sortableData.get(id)
  if (!data) {
    throw new Error(`Expected sortable data for ${id}`)
  }
  return { current: data }
}

function startDraggingSession(id: string) {
  act(() => {
    dndMocks.onDragStart?.({
      active: {
        data: sortableData(`item:${id}`),
        id: `item:${id}`,
        rect: { current: { initial: { height: 32, width: 240 }, translated: null } }
      }
    })
  })
}

function expectSessionBlocked(name: string) {
  expect(screen.getByText(name).closest('[data-drop-blocked="true"]')).toBeInTheDocument()
}

function expectGroupBlocked(name: string) {
  expect(screen.getByRole('button', { name }).closest('[data-drop-blocked="true"]')).toBeInTheDocument()
}

function setupSessions(overrides: Record<string, unknown> = {}) {
  sessionDataMocks.useSessions.mockReturnValue({
    sessions: [
      createSession({ id: 'session-a', name: 'Alpha session', orderKey: 'a' }),
      createSession({ id: 'session-b', name: 'Beta session', orderKey: 'b' })
    ],
    createSession: sessionDataMocks.createSession,
    pinIdBySessionId: new Map(),
    isLoading: false,
    error: undefined,
    deleteSession: sessionDataMocks.deleteSession,
    hasMore: false,
    isLoadingMore: false,
    isValidating: false,
    reload: sessionDataMocks.reload,
    reorderSession: sessionDataMocks.reorderSession,
    togglePin: sessionDataMocks.togglePin,
    ...overrides
  })
}

describe('Sessions', () => {
  beforeEach(() => {
    preferenceMocks.values.clear()
    preferenceMocks.values.set('agent.session.display_mode', 'time')
    preferenceMocks.values.set('agent.session.collapsed_group_ids', [])
    preferenceMocks.values.set('topic.tab.show', true)
    cacheMocks.state.activeSessionId = 'session-a'
    setupSessions()
    sessionDataMocks.useUpdateSession.mockReturnValue({ updateSession: sessionDataMocks.updateSession })
    agentDataMocks.useAgents.mockReturnValue({
      agents: [{ id: 'agent-a', model: 'model-a', name: 'Alpha agent' }],
      isLoading: false,
      error: undefined
    })
    vi.clearAllMocks()
  })

  afterEach(() => {
    dndMocks.droppableData.clear()
    dndMocks.sortableData.clear()
    vi.useRealTimers()
  })

  it('loads all sessions and renders time groups without drag', () => {
    render(<Sessions />)

    expect(sessionDataMocks.useSessions).toHaveBeenCalledWith(undefined, { loadAll: true, pageSize: 50 })
    expect(screen.getByText('Sessions')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Search sessions')).toBeInTheDocument()
    expect(screen.getByText('Alpha session')).toHaveClass('text-[12px]', 'font-medium', 'text-sidebar-foreground/70')
    expect(screen.queryByTestId('dnd-context')).not.toBeInTheDocument()
  })

  it('renders load errors inside the shared ResourceList shell', () => {
    setupSessions({ error: new Error('Failed request'), sessions: [] })

    render(<Sessions />)

    expect(screen.getByText('Sessions')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Search sessions')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Failed to get sessions')
    expect(screen.getByRole('alert')).toHaveTextContent('Failed request')

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    expect(sessionDataMocks.reload).toHaveBeenCalled()
  })

  it('uses agent configuration avatar for agent group headers without changing session rows', () => {
    agentDataMocks.useAgents.mockReturnValue({
      agents: [{ id: 'agent-a', model: 'model-a', name: 'Alpha agent', configuration: { avatar: '🧠' } }],
      isLoading: false,
      error: undefined
    })

    const { unmount } = render(<Sessions />)

    expect(screen.getByText('Alpha session').closest('[data-testid="agent-session-row"]')).not.toHaveTextContent('🧠')

    unmount()
    preferenceMocks.values.set('agent.session.display_mode', 'agent')
    render(<Sessions />)

    expect(screen.getByRole('button', { name: 'Alpha agent' }).closest('div')).toHaveTextContent('🧠')
  })

  it('clears the active session from the header without creating inline', () => {
    agentDataMocks.useAgents.mockReturnValue({
      agents: [
        { id: 'agent-a', model: 'model-a', name: 'Alpha agent' },
        { id: 'agent-b', model: 'model-b', name: 'Beta agent' }
      ],
      isLoading: false,
      error: undefined
    })

    render(<Sessions />)

    const addButtons = screen.getAllByLabelText('Add session')
    expect(addButtons).toHaveLength(2)

    fireEvent.click(addButtons[0])
    expect(sessionDataMocks.createSession).not.toHaveBeenCalled()
    expect(cacheMocks.setActiveSessionId).toHaveBeenCalledWith(null)
  })

  it('creates sessions from the time group action', async () => {
    render(<Sessions />)

    const addButtons = screen.getAllByLabelText('Add session')
    fireEvent.click(addButtons[1])

    await vi.waitFor(() =>
      expect(sessionDataMocks.createSession).toHaveBeenCalledWith({ agentId: 'agent-a', name: 'Untitled' })
    )
  })

  it('toggles the agent sidebar from the header action', () => {
    render(<Sessions />)

    fireEvent.click(screen.getByLabelText('Toggle sidebar'))

    expect(preferenceMocks.setPreference).toHaveBeenCalledWith('topic.tab.show', false)
  })

  it('renames sessions through the shared update session hook', async () => {
    render(<Sessions />)

    fireEvent.doubleClick(screen.getByText('Alpha session'))
    const input = screen.getByLabelText('Edit session')
    fireEvent.change(input, { target: { value: 'Renamed session' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await vi.waitFor(() =>
      expect(sessionDataMocks.updateSession).toHaveBeenCalledWith(
        { id: 'session-a', name: 'Renamed session' },
        { showSuccessToast: false }
      )
    )
    expect(sessionDataMocks.reorderSession).not.toHaveBeenCalled()
  })

  it('clears pending delete confirmation timers on unmount', () => {
    vi.useFakeTimers()
    const clearTimeoutSpy = vi.spyOn(window, 'clearTimeout')
    const { unmount } = render(<Sessions />)

    fireEvent.click(screen.getAllByLabelText('Delete')[0])
    unmount()

    expect(clearTimeoutSpy).toHaveBeenCalled()
    clearTimeoutSpy.mockRestore()
  })

  it('subscribes stream status only for visible session rows', () => {
    preferenceMocks.values.set('agent.session.display_mode', 'agent')
    preferenceMocks.values.set('agent.session.collapsed_group_ids', ['session:agent:agent-a'])

    render(<Sessions />)

    expect(screen.getByRole('button', { name: 'Alpha agent' })).toBeInTheDocument()
    expect(screen.queryByText('Alpha session')).not.toBeInTheDocument()
    expect(topicStreamStatusMocks.useTopicStreamStatus).not.toHaveBeenCalledWith('agent-session:session-a')
    expect(topicStreamStatusMocks.useTopicStreamStatus).not.toHaveBeenCalledWith('agent-session:session-b')
  })

  it('persists display mode selection from the header menu', () => {
    render(<Sessions />)

    fireEvent.click(screen.getByLabelText('Display mode'))
    fireEvent.click(screen.getByRole('button', { name: 'Agent' }))

    expect(preferenceMocks.setPreference).toHaveBeenCalledWith('agent.session.display_mode', 'agent')
  })

  it('blocks cross-agent drops and persists same-group ordering', async () => {
    preferenceMocks.values.set('agent.session.display_mode', 'agent')
    setupSessions({
      sessions: [
        createSession({ id: 'session-a', name: 'Alpha session', agentId: 'agent-a', orderKey: 'a' }),
        createSession({ id: 'session-b', name: 'Beta session', agentId: 'agent-a', orderKey: 'b' }),
        createSession({ id: 'session-c', name: 'Gamma session', agentId: 'agent-b', orderKey: 'c' })
      ]
    })
    agentDataMocks.useAgents.mockReturnValue({
      agents: [
        { id: 'agent-a', model: 'model-a', name: 'Alpha agent' },
        { id: 'agent-b', model: 'model-b', name: 'Beta agent' }
      ],
      isLoading: false,
      error: undefined
    })

    render(<Sessions />)

    expect(screen.getByTestId('dnd-context')).toBeInTheDocument()
    startDraggingSession('session-a')

    expectGroupBlocked('Beta agent')
    expectSessionBlocked('Gamma session')
    expect(screen.getByRole('button', { name: 'Alpha agent' }).closest('[data-drop-blocked="true"]')).toBeNull()
    expect(screen.getByText('Beta session').closest('[data-drop-blocked="true"]')).toBeNull()

    act(() => {
      dndMocks.onDragEnd?.({
        active: {
          data: sortableData('item:session-a'),
          id: 'item:session-a',
          rect: { current: { initial: null, translated: { top: 10, height: 20 } } }
        },
        over: { data: sortableData('item:session-c'), id: 'item:session-c', rect: { top: 80, height: 20 } }
      })
    })

    expect(sessionDataMocks.reorderSession).not.toHaveBeenCalled()

    act(() => {
      dndMocks.onDragEnd?.({
        active: {
          data: sortableData('item:session-a'),
          id: 'item:session-a',
          rect: { current: { initial: null, translated: { top: 10, height: 20 } } }
        },
        over: { data: sortableData('item:session-b'), id: 'item:session-b', rect: { top: 80, height: 20 } }
      })
    })

    await vi.waitFor(() =>
      expect(sessionDataMocks.reorderSession).toHaveBeenCalledWith('session-a', { after: 'session-b' })
    )
  })

  it('blocks cross-workspace groups from drag start while preserving same-workspace reorder', async () => {
    preferenceMocks.values.set('agent.session.display_mode', 'workdir')
    setupSessions({
      sessions: [
        createSession({
          id: 'session-a',
          name: 'Alpha session',
          accessiblePaths: ['/Users/jd/project-a'],
          orderKey: 'a'
        }),
        createSession({
          id: 'session-b',
          name: 'Beta session',
          accessiblePaths: ['/Users/jd/project-a'],
          orderKey: 'b'
        }),
        createSession({
          id: 'session-c',
          name: 'Gamma session',
          accessiblePaths: ['/Users/jd/project-b'],
          orderKey: 'c'
        })
      ],
      pinIdBySessionId: new Map([['session-c', 'pin-session-c']])
    })

    render(<Sessions />)

    expect(screen.getByTestId('dnd-context')).toBeInTheDocument()
    startDraggingSession('session-a')

    expectGroupBlocked('Pinned')
    expectSessionBlocked('Gamma session')
    expect(screen.getByRole('button', { name: 'project-a' }).closest('[data-drop-blocked="true"]')).toBeNull()
    expect(screen.getByText('Beta session').closest('[data-drop-blocked="true"]')).toBeNull()

    act(() => {
      dndMocks.onDragEnd?.({
        active: {
          data: sortableData('item:session-a'),
          id: 'item:session-a',
          rect: { current: { initial: null, translated: { top: 10, height: 20 } } }
        },
        over: { data: sortableData('item:session-b'), id: 'item:session-b', rect: { top: 80, height: 20 } }
      })
    })

    await vi.waitFor(() =>
      expect(sessionDataMocks.reorderSession).toHaveBeenCalledWith('session-a', { after: 'session-b' })
    )
  })

  it('creates sessions from agent and workspace group actions', async () => {
    preferenceMocks.values.set('agent.session.display_mode', 'agent')
    setupSessions({
      sessions: [
        createSession({ id: 'session-a', name: 'Alpha session', agentId: 'agent-a', orderKey: 'a' }),
        createSession({ id: 'session-b', name: 'Beta session', agentId: 'agent-b', orderKey: 'b' })
      ]
    })
    agentDataMocks.useAgents.mockReturnValue({
      agents: [
        { id: 'agent-a', model: 'model-a', name: 'Alpha agent' },
        { id: 'agent-b', model: 'model-b', name: 'Beta agent' }
      ],
      isLoading: false,
      error: undefined
    })

    const { unmount } = render(<Sessions />)

    const betaGroup = screen.getByRole('button', { name: 'Beta agent' }).closest('div')
    expect(betaGroup).not.toBeNull()
    fireEvent.click(betaGroup!.querySelector('[aria-label="Add session"]')!)

    await vi.waitFor(() =>
      expect(sessionDataMocks.createSession).toHaveBeenCalledWith({ agentId: 'agent-b', name: 'Untitled' })
    )

    unmount()
    preferenceMocks.values.set('agent.session.display_mode', 'workdir')
    render(<Sessions />)

    const workdirGroup = screen.getByRole('button', { name: 'project-a' }).closest('div')
    expect(workdirGroup).not.toBeNull()
    fireEvent.click(workdirGroup!.querySelector('[aria-label="Add session"]')!)

    await vi.waitFor(() =>
      expect(sessionDataMocks.createSession).toHaveBeenCalledWith({
        agentId: 'agent-a',
        name: 'Untitled',
        accessiblePaths: ['/Users/jd/project-a']
      })
    )
  })
})
