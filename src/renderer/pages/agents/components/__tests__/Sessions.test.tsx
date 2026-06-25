import type * as CherryStudioUi from '@cherrystudio/ui'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import type { AgentWorkspaceEntity } from '@shared/data/api/schemas/agentWorkspaces'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import type { ComponentProps, ReactNode } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@cherrystudio/ui', async (importOriginal) => {
  const React = await import('react')
  const actual = await importOriginal<typeof CherryStudioUi>()
  const ContextMenuContext = React.createContext<{ onOpenChange?: (open: boolean) => void }>({})
  const itemHandler = (onSelect: ((event: Event) => void) | undefined, props: Record<string, unknown>) => ({
    ...props,
    disabled: props.disabled as boolean | undefined,
    onClick: (event: Event) => onSelect?.(event),
    role: 'menuitem',
    type: 'button'
  })

  return {
    ...actual,
    ContextMenu: ({ children, onOpenChange }: { children?: ReactNode; onOpenChange?: (open: boolean) => void }) => (
      <ContextMenuContext value={{ onOpenChange }}>
        <div data-testid="context-menu">{children}</div>
      </ContextMenuContext>
    ),
    ContextMenuContent: ({ children, ...props }: { children?: ReactNode }) => (
      <div data-testid="context-menu-content" {...props}>
        {children}
      </div>
    ),
    ContextMenuItemContent: ({ children, hasSubmenu, icon, shortcut, ...props }: any) => (
      <span data-has-submenu={hasSubmenu ? 'true' : undefined} {...props}>
        {icon}
        <span>{children}</span>
        {shortcut ? <span>{shortcut}</span> : null}
      </span>
    ),
    ContextMenuItem: ({ children, onSelect, ...props }: any) =>
      React.createElement('button', itemHandler(onSelect, props), children),
    ContextMenuSeparator: (props: any) => <hr data-testid="context-menu-separator" {...props} />,
    ContextMenuSub: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    ContextMenuSubContent: ({ children, ...props }: { children?: ReactNode }) => <div {...props}>{children}</div>,
    ContextMenuSubTrigger: ({ children, ...props }: { children?: ReactNode }) => (
      <button type="button" {...props}>
        {children}
      </button>
    ),
    ContextMenuTrigger: ({ asChild, children, ...props }: any) => {
      const context = React.use(ContextMenuContext)
      const triggerProps = {
        ...props,
        onContextMenu: (event: any) => {
          props.onContextMenu?.(event)
          if (!event.defaultPrevented) {
            context.onOpenChange?.(true)
            event.preventDefault()
          }
        }
      }

      if (asChild && React.isValidElement(children)) {
        const childProps = children.props || {}

        return React.cloneElement(children, {
          ...triggerProps,
          ...childProps,
          onContextMenu: (event: any) => {
            childProps.onContextMenu?.(event)
            if (!event.defaultPrevented) {
              triggerProps.onContextMenu(event)
            }
          }
        })
      }

      return <div {...triggerProps}>{children}</div>
    },
    DropdownMenu: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    DropdownMenuContent: ({ children, ...props }: { children?: ReactNode }) => (
      <div data-slot="dropdown-menu-content" {...props}>
        {children}
      </div>
    ),
    DropdownMenuItem: ({ children, disabled, onSelect, variant, ...props }: any) => (
      <button
        data-disabled={disabled ? '' : undefined}
        data-slot="dropdown-menu-item"
        disabled={disabled || undefined}
        role="menuitem"
        type="button"
        variant={variant}
        onClick={(event) => {
          if (!disabled) onSelect?.(event)
        }}
        {...props}>
        {children}
      </button>
    ),
    DropdownMenuSeparator: (props: any) => <hr data-testid="dropdown-menu-separator" {...props} />,
    DropdownMenuTrigger: ({ children }: { children?: ReactNode }) => <>{children}</>
  }
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
    scrollElement: null,
    scrollToIndex: virtualMocks.scrollToIndex
  })),
  scrollToIndex: vi.fn()
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

const pinMocks = vi.hoisted(() => ({
  usePins: vi.fn()
}))

const preferenceMocks = vi.hoisted(() => ({
  values: new Map<string, unknown>(),
  setPreference: vi.fn()
}))

const cacheMocks = vi.hoisted(() => ({
  state: { activeSessionId: 'session-a' as string | null },
  values: new Map<string, unknown>(),
  setActiveSessionId: vi.fn(),
  setCache: vi.fn()
}))

const tabsContextMocks = vi.hoisted(() => ({
  openTab: vi.fn(),
  setActiveTab: vi.fn(),
  tabs: [] as Array<{ id: string; type: string; url: string }>
}))

const dataApiMocks = vi.hoisted(() => ({
  deleteWorkspace: vi.fn().mockResolvedValue(undefined),
  deleteAgentSessions: vi.fn().mockResolvedValue({ deletedIds: [] as string[], deletedCount: 0 }),
  findOrCreateWorkspace: vi.fn(async ({ body }: { body: { path: string } }) => {
    const workspace = dataApiMocks.workspaces.find((candidate) => candidate.path === body.path)
    return workspace ?? { id: 'ws-test', name: 'Test Workspace', path: body.path }
  }),
  refetchWorkspaces: vi.fn().mockResolvedValue(undefined),
  refetchAgents: vi.fn().mockResolvedValue(undefined),
  reorderAgent: vi.fn().mockResolvedValue(undefined),
  reorderWorkspace: vi.fn().mockResolvedValue(undefined),
  updateWorkspace: vi.fn().mockResolvedValue(undefined),
  mutationOptions: new Map<string, { refresh?: string[] }>(),
  workspaces: [] as Array<{
    id: string
    name: string
    path: string
    orderKey: string
    createdAt: string
    updatedAt: string
  }>,
  workspacesError: undefined as unknown,
  workspacesLoading: false,
  workspacesRefreshing: false
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

const createTopicStreamStatusMock = (overrides: { isFulfilled?: boolean; isPending?: boolean } = {}) => ({
  activeExecutions: [],
  isFulfilled: overrides.isFulfilled ?? false,
  isPending: overrides.isPending ?? false,
  markSeen: vi.fn(),
  status: undefined
})

vi.mock('@renderer/hooks/agents/useSession', () => ({
  useSessions: sessionDataMocks.useSessions,
  useUpdateSession: sessionDataMocks.useUpdateSession
}))

vi.mock('@renderer/hooks/agents/useAgent', () => ({
  useAgents: agentDataMocks.useAgents
}))

vi.mock('@renderer/context/TabsContext', () => ({
  useOptionalTabsContext: () => tabsContextMocks
}))

vi.mock('@renderer/components/resource/dialogs', () => ({
  ResourceEditDialogHost: ({ target }: { target: { kind: string; id: string } | null }) =>
    target ? <div data-testid="resource-edit-dialog-host" data-kind={target.kind} data-id={target.id} /> : null
}))

vi.mock('@renderer/data/hooks/usePreference', () => ({
  usePreference: (key: string) => [
    preferenceMocks.values.get(key),
    (value: unknown) => {
      preferenceMocks.values.set(key, value)
      preferenceMocks.setPreference(key, value)
    }
  ],
  useMultiplePreferences: () => [{}, vi.fn()]
}))

vi.mock('@renderer/data/hooks/useCache', () => ({
  useCache: () => [undefined, vi.fn()],
  usePersistCache: (key: string) => [
    cacheMocks.values.get(key),
    (value: unknown) => {
      cacheMocks.values.set(key, value)
      cacheMocks.setCache(key, value)
    }
  ]
}))

vi.mock('@renderer/hooks/useTopicStreamStatus', () => ({
  useTopicStreamStatus: topicStreamStatusMocks.useTopicStreamStatus
}))

vi.mock('@renderer/data/hooks/useDataApi', () => ({
  useQuery: vi.fn((path: string, options?: { enabled?: boolean }) => {
    if (options?.enabled === false) {
      return {
        data: undefined,
        isLoading: false,
        isRefreshing: false,
        error: undefined,
        refetch: vi.fn(),
        mutate: vi.fn()
      }
    }

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

    if (path === '/agent-workspaces') {
      return {
        data: dataApiMocks.workspaces,
        isLoading: dataApiMocks.workspacesLoading,
        isRefreshing: dataApiMocks.workspacesRefreshing,
        error: dataApiMocks.workspacesError,
        refetch: dataApiMocks.refetchWorkspaces,
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
  }),
  useMutation: vi.fn((method: string, path: string, options?: { refresh?: string[] }) => {
    dataApiMocks.mutationOptions.set(`${method} ${path}`, options ?? {})
    return {
      trigger:
        method === 'PATCH' && path === '/agent-workspaces/:id/order'
          ? dataApiMocks.reorderWorkspace
          : method === 'PATCH' && path === '/agents/:id/order'
            ? dataApiMocks.reorderAgent
            : method === 'PATCH' && path === '/agent-workspaces/:workspaceId'
              ? dataApiMocks.updateWorkspace
              : method === 'DELETE' && path === '/agent-workspaces/:workspaceId'
                ? dataApiMocks.deleteWorkspace
                : method === 'DELETE' && path === '/agents/:agentId/sessions'
                  ? dataApiMocks.deleteAgentSessions
                  : dataApiMocks.findOrCreateWorkspace,
      isLoading: false,
      error: undefined
    }
  })
}))

vi.mock('@renderer/hooks/usePins', () => ({
  usePins: pinMocks.usePins
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
    t: (key: string, options?: Record<string, unknown>) => {
      const labels: Record<string, string> = {
        'agent.session.add.title': 'Add task',
        'agent.session.display.agent': 'Agent',
        'agent.session.display.time': 'Time',
        'agent.session.display.title': 'Display mode',
        'agent.session.display.workdir': 'Work directory',
        'agent.session.empty.description': 'Tasks will appear here after you start one.',
        'agent.session.empty.title': 'No tasks yet',
        'agent.edit.title': 'Edit Agent',
        'agent.session.edit.title': 'Edit task',
        'agent.session.file_manager.file_explorer': 'File Explorer',
        'agent.session.file_manager.files': 'Files',
        'agent.session.file_manager.finder': 'Finder',
        'agent.session.get.error.failed': 'Failed to get tasks',
        'agent.session.agent.delete.content':
          "Deleting this agent's tasks will delete all tasks associated with this agent. The agent itself will not be deleted.",
        'agent.session.agent.delete.error.failed': 'Failed to delete agent tasks',
        'agent.session.agent.delete.title': 'Delete agent tasks',
        'agent.session.agent.delete.trigger': 'Delete agent tasks',
        'agent.session.group.collapse': 'Collapse display',
        'agent.session.group.collapse_all': 'Collapse all',
        'agent.session.group.conversation': 'Conversations',
        'agent.session.group.drag_hint': 'Drag to reorder. Drag tasks to adjust display and hidden groups.',
        'agent.session.group.earlier': 'Earlier',
        'agent.session.group.expand_all': 'Expand all',
        'agent.session.group.no_workdir': 'No work directory',
        'agent.session.group.show_more': 'Expand display',
        'agent.session.group.this_week': 'This week',
        'agent.session.group.today': 'Today',
        'agent.session.group.unknown_agent': 'Unknown agent',
        'agent.session.group.yesterday': 'Yesterday',
        'agent.session.list.title': 'Tasks',
        'agent.pin.title': 'Pin Agent',
        'agent.session.pin.title': 'Pin task',
        'agent.session.reorder.error.failed': 'Failed to reorder tasks',
        'agent.session.search.placeholder': 'Search tasks',
        'agent.session.update.error.failed': 'Failed to update task',
        'agent.session.unpin.title': 'Unpin task',
        'agent.session.workdir.delete.content':
          'Deleting this work directory also deletes tasks under it. The actual folder is not deleted.',
        'agent.session.workdir.delete.error.failed': 'Failed to delete work directory',
        'agent.session.workdir.delete.title': 'Delete work directory',
        'agent.session.workdir.delete.trigger': 'Delete work directory',
        'agent.session.workdir.rename.error.failed': 'Failed to rename work directory',
        'agent.session.workdir.rename.title': 'Rename work directory',
        'agent.session.workdir.rename.trigger': 'Rename work directory',
        'agent.unpin.title': 'Unpin Agent',
        'chat.topics.delete.shortcut': 'Hold Ctrl to delete directly',
        'common.cancel': 'Cancel',
        'common.delete': 'Delete',
        'common.delete_success': 'Deleted successfully',
        'common.error': 'Error',
        'common.loading': 'Loading...',
        'common.more': 'More',
        'common.name': 'Name',
        'common.open_in': `Open in ${options?.name ?? ''}`,
        'common.open_in_new_tab': 'Open in new tab',
        'common.rename': 'Rename',
        'tab.open_in_new_window': 'Open in New Window',
        'common.required_field': 'Required field',
        'common.retry': 'Retry',
        'common.save': 'Save',
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
        'settings.shortcuts.toggle_left_sidebar': 'Toggle Left Sidebar'
      }
      return labels[key] ?? key
    }
  })
}))

import { SESSION_AGENT_SECTION_ID, SESSION_PINNED_SECTION_ID, SESSION_WORKDIR_SECTION_ID } from '../sessionListHelpers'
import Sessions from '../Sessions'

const CURRENT_SESSION_ISO = new Date().toISOString()
const SESSION_EXPANSION_TIME_KEY = 'ui.agent.session.expansion.time'
const SESSION_EXPANSION_AGENT_KEY = 'ui.agent.session.expansion.agent'
const SESSION_EXPANSION_WORKDIR_KEY = 'ui.agent.session.expansion.workdir'

type SessionsForTestProps = Partial<ComponentProps<typeof Sessions>> & {
  activeSessionId?: string | null
  setActiveSessionId?: (id: string | null, session?: AgentSessionEntity | null) => void
}

function SessionsForTest({
  activeSessionId = cacheMocks.state.activeSessionId,
  setActiveSessionId = cacheMocks.setActiveSessionId,
  ...props
}: SessionsForTestProps) {
  return <Sessions activeSessionId={activeSessionId ?? null} setActiveSessionId={setActiveSessionId} {...props} />
}
type SessionGroupCollapseFixture = {
  time: string[]
  agent: string[]
  workdir: string[]
}

// Default fixture: nothing collapsed (everything expanded).
function createExpandedSessionGroupExpansionFixture(): SessionGroupCollapseFixture {
  return {
    time: [],
    agent: [],
    workdir: []
  }
}

function setSessionGroupExpansionCache(value: SessionGroupCollapseFixture) {
  cacheMocks.values.set(SESSION_EXPANSION_TIME_KEY, value.time)
  cacheMocks.values.set(SESSION_EXPANSION_AGENT_KEY, value.agent)
  cacheMocks.values.set(SESSION_EXPANSION_WORKDIR_KEY, value.workdir)
}

function getSessionGroupExpansionCache() {
  return {
    time: cacheMocks.values.get(SESSION_EXPANSION_TIME_KEY),
    agent: cacheMocks.values.get(SESSION_EXPANSION_AGENT_KEY),
    workdir: cacheMocks.values.get(SESSION_EXPANSION_WORKDIR_KEY)
  } as SessionGroupCollapseFixture
}

function makeWorkspace(path: string, overrides: Partial<AgentWorkspaceEntity> = {}): AgentWorkspaceEntity {
  return {
    id: `ws-${path}`,
    name: path.split('/').at(-1) ?? path,
    path,
    type: 'user',
    orderKey: 'a',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

function createSession(overrides: Partial<AgentSessionEntity> = {}): AgentSessionEntity {
  return {
    id: 'session-a',
    agentId: 'agent-a',
    name: 'Alpha session',
    description: '',
    workspaceId: 'ws-a',
    workspace: makeWorkspace('/Users/jd/project-a', { id: 'ws-a', name: 'Embedded Project A' }),
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

function startDraggingGroup(groupId: string) {
  act(() => {
    dndMocks.onDragStart?.({
      active: {
        data: sortableData(`group:${groupId}`),
        id: `group:${groupId}`,
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

function openSessionListOptions() {
  fireEvent.click(screen.getByLabelText('Display mode'))
  const title = screen.getByText('Display mode')
  return title.closest('[data-radix-popper-content-wrapper]') ?? title.parentElement
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
    isFullyLoaded: true,
    isLoadingAll: false,
    isLoadingMore: false,
    isPinsLoading: false,
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
    cacheMocks.values.clear()
    preferenceMocks.values.set('agent.session.display_mode', 'workdir')
    setSessionGroupExpansionCache(createExpandedSessionGroupExpansionFixture())
    preferenceMocks.values.set('topic.tab.show', true)
    dataApiMocks.workspaces = [
      makeWorkspace('/Users/jd/project-a', { id: 'ws-a', name: 'Project A Workspace', orderKey: 'a' }),
      makeWorkspace('/Users/jd/project-b', { id: 'ws-b', name: 'Project B Workspace', orderKey: 'b' })
    ]
    dataApiMocks.workspacesError = undefined
    dataApiMocks.workspacesLoading = false
    dataApiMocks.workspacesRefreshing = false
    dataApiMocks.deleteWorkspace.mockResolvedValue(undefined)
    dataApiMocks.deleteAgentSessions.mockResolvedValue({ deletedIds: [], deletedCount: 0 })
    dataApiMocks.refetchAgents.mockResolvedValue(undefined)
    dataApiMocks.reorderAgent.mockResolvedValue(undefined)
    dataApiMocks.updateWorkspace.mockResolvedValue(undefined)
    dataApiMocks.mutationOptions.clear()
    sessionDataMocks.deleteSession.mockResolvedValue(true)
    Object.assign(window, {
      api: {
        file: {
          openPath: vi.fn().mockResolvedValue(undefined)
        }
      },
      modal: {
        confirm: vi.fn().mockResolvedValue(true)
      },
      toast: {
        error: vi.fn(),
        success: vi.fn()
      }
    })
    cacheMocks.state.activeSessionId = 'session-a'
    setupSessions()
    topicStreamStatusMocks.useTopicStreamStatus.mockImplementation(() => createTopicStreamStatusMock())
    pinMocks.usePins.mockReturnValue({
      isLoading: false,
      isRefreshing: false,
      isMutating: false,
      error: undefined,
      pinnedIds: [],
      refetch: vi.fn(),
      togglePin: vi.fn()
    })
    sessionDataMocks.useUpdateSession.mockReturnValue({ updateSession: sessionDataMocks.updateSession })
    agentDataMocks.useAgents.mockReturnValue({
      agents: [{ id: 'agent-a', model: 'model-a', name: 'Alpha agent' }],
      isLoading: false,
      error: undefined,
      refetch: dataApiMocks.refetchAgents
    })
    vi.clearAllMocks()
    tabsContextMocks.openTab.mockClear()
  })

  afterEach(() => {
    dndMocks.droppableData.clear()
    dndMocks.sortableData.clear()
    virtualMocks.scrollToIndex.mockClear()
    vi.useRealTimers()
  })

  it('loads all sessions and renders collapsed workspace groups with drag by default', () => {
    setSessionGroupExpansionCache({
      ...createExpandedSessionGroupExpansionFixture(),
      // Collapse the workspace groups; sections stay expanded.
      workdir: ['session:workspace:ws-a', 'session:workspace:ws-b']
    })

    const view = render(<SessionsForTest />)

    expect(sessionDataMocks.useSessions).toHaveBeenCalledWith(undefined, { loadAll: true, pageSize: 200 })
    expect(screen.getByTestId('resource-list-session')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Search tasks')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Project A Workspace' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: 'project-a' })).not.toBeInTheDocument()
    const projectIconContainer = screen
      .getByRole('button', { name: 'Project A Workspace' })
      .querySelector('[data-resource-list-leading-slot="true"]')
    expect(projectIconContainer?.querySelector('.lucide-folder')).toBeInTheDocument()
    expect(projectIconContainer?.querySelector('.lucide-folder-open')).toHaveClass(
      'group-hover/resource-list-group:block'
    )
    expect(screen.queryByText('Alpha session')).not.toBeInTheDocument()
    expect(screen.getByTestId('dnd-context')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Project A Workspace' }))

    // Sections stay expanded; expanding ws-a removes it from the collapsed list.
    expect(getSessionGroupExpansionCache().workdir).not.toContain(SESSION_PINNED_SECTION_ID)
    expect(getSessionGroupExpansionCache().workdir).not.toContain(SESSION_WORKDIR_SECTION_ID)
    expect(getSessionGroupExpansionCache().workdir).not.toContain('session:workspace:ws-a')
    expect(getSessionGroupExpansionCache().workdir).toContain('session:workspace:ws-b')
    view.rerender(<SessionsForTest key="expanded-project-a-workspace" />)
    expect(screen.getByRole('button', { name: 'Project A Workspace' })).toHaveAttribute('aria-expanded', 'true')
    expect(
      screen.getByRole('button', { name: 'Project A Workspace' }).querySelector('.lucide-folder-open')
    ).toBeInTheDocument()
  })

  it('keeps the header new task action enabled without agents and starts a missing-agent draft', () => {
    const onStartDraftSession = vi.fn()
    const onStartMissingAgentDraft = vi.fn()
    setupSessions({ sessions: [] })
    agentDataMocks.useAgents.mockReturnValue({
      agents: [],
      isLoading: false,
      error: undefined,
      refetch: dataApiMocks.refetchAgents
    })

    render(
      <SessionsForTest onStartDraftSession={onStartDraftSession} onStartMissingAgentDraft={onStartMissingAgentDraft} />
    )

    const newConversationButton = screen.getByRole('button', { name: 'Add task' })
    expect(newConversationButton).not.toBeDisabled()

    fireEvent.click(newConversationButton)

    expect(onStartMissingAgentDraft).toHaveBeenCalledTimes(1)
    expect(onStartDraftSession).not.toHaveBeenCalled()
  })

  it('starts a first-agent draft from the header when there are agents but no sessions', async () => {
    const onStartDraftSession = vi.fn()
    const onStartMissingAgentDraft = vi.fn()
    setupSessions({ sessions: [] })

    render(
      <SessionsForTest onStartDraftSession={onStartDraftSession} onStartMissingAgentDraft={onStartMissingAgentDraft} />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Add task' }))

    await vi.waitFor(() =>
      expect(onStartDraftSession).toHaveBeenCalledWith({
        agentId: 'agent-a',
        workspace: { type: 'system' }
      })
    )
    expect(onStartMissingAgentDraft).not.toHaveBeenCalled()
  })

  it('shows the empty task state without a creation action', () => {
    const onStartDraftSession = vi.fn()
    setupSessions({ sessions: [] })

    render(<SessionsForTest onStartDraftSession={onStartDraftSession} />)

    expect(screen.getByText('No tasks yet')).toBeInTheDocument()
    expect(screen.getByText('Tasks will appear here after you start one.')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Add task' })).toHaveLength(1)
    expect(onStartDraftSession).not.toHaveBeenCalled()
  })

  it('renders no-project sessions in a bottom no-project section', () => {
    const onStartDraftSession = vi.fn()
    const systemWorkspace = makeWorkspace('/Users/jd/Data/Agents/system/2026-05-25/120000-session', {
      id: 'system-ws',
      name: 'System Workspace',
      type: 'system'
    })
    setupSessions({
      sessions: [
        createSession({
          id: 'session-system',
          name: 'System session',
          orderKey: '0',
          workspaceId: systemWorkspace.id,
          workspace: systemWorkspace
        }),
        createSession({ id: 'session-a', name: 'Alpha session', orderKey: 'a' }),
        createSession({
          id: 'session-b',
          name: 'Beta session',
          orderKey: 'b',
          workspaceId: 'ws-b',
          workspace: makeWorkspace('/Users/jd/project-b', { id: 'ws-b' })
        })
      ]
    })

    render(<SessionsForTest onStartDraftSession={onStartDraftSession} />)

    const projectSection = screen.getByRole('button', { name: 'Work directory' })
    const noProjectSection = screen.getByRole('button', { name: 'No work directory' })
    expect(projectSection.compareDocumentPosition(noProjectSection) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByText('System session')).toBeInTheDocument()
    const systemSessionRow = screen.getByText('System session').closest('[role="option"]')
    expect(systemSessionRow?.querySelector('[data-resource-list-leading-slot="true"]') ?? null).not.toBeInTheDocument()

    const noProjectSectionHeader = noProjectSection.closest('[class*="group/resource-list-section"]')
    expect(noProjectSectionHeader).not.toBeNull()
    fireEvent.click(
      within(noProjectSectionHeader as HTMLElement).getByRole('button', { name: 'chat.conversation.new' })
    )

    expect(onStartDraftSession).toHaveBeenCalledWith({
      agentId: 'agent-a',
      workspace: { type: 'system' }
    })
  })

  it('does not reserve leading icon space for time grouped session rows', () => {
    preferenceMocks.values.set('agent.session.display_mode', 'time')

    render(<SessionsForTest />)

    const sessionRow = screen.getByText('Alpha session').closest('[role="option"]')
    expect(sessionRow).not.toBeNull()
    expect(sessionRow?.querySelector('[data-resource-list-leading-slot="true"]') ?? null).not.toBeInTheDocument()
  })

  it('orders workspace groups by workspace DataApi order', () => {
    dataApiMocks.workspaces = [
      makeWorkspace('/Users/jd/project-b', { id: 'ws-b', name: 'DB Project B', orderKey: 'a' }),
      makeWorkspace('/Users/jd/project-a', { id: 'ws-a', name: 'DB Project A', orderKey: 'b' })
    ]
    setupSessions({
      sessions: [
        createSession({
          id: 'session-a',
          name: 'Alpha session',
          workspaceId: 'ws-a',
          workspace: makeWorkspace('/Users/jd/project-a', { id: 'ws-a', name: 'Embedded Project A' }),
          orderKey: 'a'
        }),
        createSession({
          id: 'session-b',
          name: 'Beta session',
          workspaceId: 'ws-b',
          workspace: makeWorkspace('/Users/jd/project-b', { id: 'ws-b', name: 'Embedded Project B' }),
          orderKey: 'b'
        })
      ]
    })

    render(<SessionsForTest />)

    const projectB = screen.getByRole('button', { name: 'DB Project B' })
    const projectA = screen.getByRole('button', { name: 'DB Project A' })
    expect(projectB.compareDocumentPosition(projectA) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('renders agent groups in agent display mode', () => {
    preferenceMocks.values.set('agent.session.display_mode', 'agent')
    setSessionGroupExpansionCache({
      ...createExpandedSessionGroupExpansionFixture(),
      // Collapse both agent groups; sections stay expanded.
      agent: ['session:agent:agent-a', 'session:agent:agent-b']
    })
    agentDataMocks.useAgents.mockReturnValue({
      agents: [
        { id: 'agent-b', model: 'model-b', name: 'Beta agent', configuration: { avatar: 'B' } },
        { id: 'agent-a', model: 'model-a', name: 'Alpha agent', configuration: { avatar: 'A' } }
      ],
      isLoading: false,
      error: undefined
    })
    setupSessions({
      sessions: [
        createSession({ id: 'session-a', name: 'Alpha session', agentId: 'agent-a', orderKey: 'a' }),
        createSession({ id: 'session-b', name: 'Beta session', agentId: 'agent-b', orderKey: 'b' })
      ]
    })

    const view = render(<SessionsForTest />)

    const betaGroup = screen.getByRole('button', { name: 'Beta agent' })
    const alphaGroup = screen.getByRole('button', { name: 'Alpha agent' })
    expect(betaGroup.compareDocumentPosition(alphaGroup) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(betaGroup).toHaveAttribute('aria-expanded', 'false')
    expect(alphaGroup).toHaveAttribute('aria-expanded', 'false')
    expect(betaGroup).toHaveTextContent('B')
    expect(alphaGroup).toHaveTextContent('A')
    expect(screen.queryByText('Beta session')).not.toBeInTheDocument()
    expect(screen.queryByText('Alpha session')).not.toBeInTheDocument()
    expect(screen.getByTestId('dnd-context')).toBeInTheDocument()

    fireEvent.click(betaGroup)

    expect(cacheMocks.setActiveSessionId).toHaveBeenCalledWith(
      'session-b',
      expect.objectContaining({ id: 'session-b' })
    )
    // Selecting the first item does not toggle the still-collapsed group.
    expect(getSessionGroupExpansionCache().agent).toContain('session:agent:agent-b')
    expect(betaGroup).toHaveAttribute('aria-expanded', 'false')

    cacheMocks.state.activeSessionId = 'session-b'
    view.rerender(<SessionsForTest key="selected-session-b" />)

    fireEvent.click(screen.getByRole('button', { name: 'Beta agent' }))

    // Expanding agent-b removes it from the collapsed list; sections stay expanded.
    expect(getSessionGroupExpansionCache().agent).not.toContain(SESSION_PINNED_SECTION_ID)
    expect(getSessionGroupExpansionCache().agent).not.toContain(SESSION_AGENT_SECTION_ID)
    expect(getSessionGroupExpansionCache().agent).not.toContain('session:agent:agent-b')
  })

  it('uses the provided active session setter', () => {
    preferenceMocks.values.set('agent.session.display_mode', 'agent')
    setSessionGroupExpansionCache({
      ...createExpandedSessionGroupExpansionFixture(),
      // Collapse both agent groups so clicking a header selects the first session.
      agent: ['session:agent:agent-a', 'session:agent:agent-b']
    })
    agentDataMocks.useAgents.mockReturnValue({
      agents: [
        { id: 'agent-a', model: 'model-a', name: 'Alpha agent', configuration: { avatar: 'A' } },
        { id: 'agent-b', model: 'model-b', name: 'Beta agent', configuration: { avatar: 'B' } }
      ],
      isLoading: false,
      error: undefined
    })
    setupSessions({
      sessions: [
        createSession({ id: 'session-a', name: 'Alpha session', agentId: 'agent-a', orderKey: 'a' }),
        createSession({ id: 'session-b', name: 'Beta session', agentId: 'agent-b', orderKey: 'b' })
      ]
    })
    const setActiveSessionId = vi.fn()

    render(<SessionsForTest activeSessionId="session-a" setActiveSessionId={setActiveSessionId} />)
    fireEvent.click(screen.getByRole('button', { name: 'Beta agent' }))

    expect(setActiveSessionId).toHaveBeenCalledWith('session-b', expect.objectContaining({ id: 'session-b' }))
    expect(cacheMocks.setActiveSessionId).not.toHaveBeenCalled()
    expect(cacheMocks.state.activeSessionId).toBe('session-a')
  })

  it('uses the default agent avatar for blank agent group avatars', () => {
    preferenceMocks.values.set('agent.session.display_mode', 'agent')
    agentDataMocks.useAgents.mockReturnValue({
      agents: [{ id: 'agent-a', model: 'model-a', name: 'Alpha agent', configuration: { avatar: '   ' } }],
      isLoading: false,
      error: undefined
    })
    setupSessions({
      sessions: [createSession({ id: 'session-a', name: 'Alpha session', agentId: 'agent-a', orderKey: 'a' })]
    })

    render(<SessionsForTest />)

    expect(screen.getByRole('button', { name: /Alpha agent/ })).toHaveTextContent('🤖')
  })

  it('keeps system workspace sessions inside agent groups in agent display mode', () => {
    preferenceMocks.values.set('agent.session.display_mode', 'agent')
    const systemWorkspace = makeWorkspace('/Users/jd/Data/Agents/system/2026-05-25/120000-session', {
      id: 'system-ws',
      name: 'System Workspace',
      type: 'system'
    })
    agentDataMocks.useAgents.mockReturnValue({
      agents: [{ id: 'agent-a', model: 'model-a', name: 'Alpha agent', configuration: { avatar: 'A' } }],
      isLoading: false,
      error: undefined
    })
    setupSessions({
      sessions: [
        createSession({
          id: 'session-system',
          name: 'System session',
          orderKey: '0',
          workspaceId: systemWorkspace.id,
          workspace: systemWorkspace
        }),
        createSession({ id: 'session-a', name: 'Alpha session', orderKey: 'a' })
      ]
    })

    render(<SessionsForTest />)

    expect(screen.queryByRole('button', { name: 'No work directory' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Alpha agent' })).toBeInTheDocument()
    expect(screen.getByText('System session')).toBeInTheDocument()
    expect(screen.getByText('Alpha session')).toBeInTheDocument()
  })

  it('selects the first session from an agent group before toggling that selected group', () => {
    preferenceMocks.values.set('agent.session.display_mode', 'agent')
    cacheMocks.state.activeSessionId = 'session-a'
    agentDataMocks.useAgents.mockReturnValue({
      agents: [
        { id: 'agent-b', model: 'model-b', name: 'Beta agent', configuration: { avatar: 'B' } },
        { id: 'agent-a', model: 'model-a', name: 'Alpha agent', configuration: { avatar: 'A' } }
      ],
      isLoading: false,
      error: undefined
    })
    setupSessions({
      sessions: [
        createSession({ id: 'session-a', name: 'Alpha session', agentId: 'agent-a', orderKey: 'a' }),
        createSession({ id: 'session-b', name: 'Beta session', agentId: 'agent-b', orderKey: 'b' })
      ]
    })

    const view = render(<SessionsForTest />)

    const betaGroupButton = screen.getByRole('button', { name: 'Beta agent' })
    expect(betaGroupButton).toHaveAttribute('aria-expanded', 'true')

    fireEvent.click(betaGroupButton)

    expect(cacheMocks.setActiveSessionId).toHaveBeenCalledWith(
      'session-b',
      expect.objectContaining({ id: 'session-b' })
    )
    expect(betaGroupButton).toHaveAttribute('aria-expanded', 'true')
    expect(getSessionGroupExpansionCache().agent).not.toContain('session:agent:agent-b')

    cacheMocks.state.activeSessionId = 'session-b'
    view.rerender(<SessionsForTest key="selected-session-b" />)

    const selectedBetaGroupButton = screen.getByRole('button', { name: 'Beta agent' })
    expect(selectedBetaGroupButton).toHaveAttribute('aria-current', 'true')
    expect(selectedBetaGroupButton.closest('[data-selected]')).toHaveAttribute('data-selected', 'true')

    fireEvent.click(selectedBetaGroupButton)
    expect(getSessionGroupExpansionCache().agent).toContain('session:agent:agent-b')

    view.rerender(<SessionsForTest key="collapsed-session-b" />)
    expect(screen.getByRole('button', { name: 'Beta agent' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('creates sessions from agent group actions', async () => {
    const onStartDraftSession = vi.fn()
    preferenceMocks.values.set('agent.session.display_mode', 'agent')
    agentDataMocks.useAgents.mockReturnValue({
      agents: [
        { id: 'agent-a', model: 'model-a', name: 'Alpha agent' },
        { id: 'agent-b', model: 'model-b', name: 'Beta agent' },
        { id: 'agent-c', model: 'model-c', name: 'Gamma agent' }
      ],
      isLoading: false,
      error: undefined
    })
    setupSessions({
      sessions: [
        createSession({
          id: 'session-a',
          name: 'Alpha session',
          agentId: 'agent-a',
          workspaceId: 'ws-a',
          workspace: makeWorkspace('/Users/jd/project-a', { id: 'ws-a' }),
          orderKey: 'a'
        }),
        createSession({
          id: 'session-b',
          name: 'Beta session',
          agentId: 'agent-b',
          workspaceId: 'ws-b',
          workspace: makeWorkspace('/Users/jd/project-b', { id: 'ws-b' }),
          orderKey: 'b',
          updatedAt: '2026-01-02T00:00:00.000Z'
        }),
        createSession({
          id: 'session-c',
          name: 'Beta newest session',
          agentId: 'agent-b',
          workspaceId: 'ws-c',
          workspace: makeWorkspace('/Users/jd/project-c', { id: 'ws-c' }),
          orderKey: 'c',
          updatedAt: '2026-01-03T00:00:00.000Z'
        })
      ]
    })

    render(<SessionsForTest onStartDraftSession={onStartDraftSession} />)

    const betaGroup = screen.getByRole('button', { name: 'Beta agent' }).closest('div')
    expect(betaGroup).not.toBeNull()
    fireEvent.click(within(betaGroup as HTMLElement).getByRole('button', { name: 'chat.conversation.new' }))

    await vi.waitFor(() =>
      expect(onStartDraftSession).toHaveBeenCalledWith({
        agentId: 'agent-b',
        workspace: { type: 'user', workspaceId: 'ws-c' }
      })
    )

    expect(screen.queryByRole('button', { name: 'Gamma agent' })).not.toBeInTheDocument()
  })

  it('renders load errors inside the shared ResourceList shell', () => {
    setupSessions({ error: new Error('Failed request'), sessions: [] })

    render(<SessionsForTest />)

    expect(screen.getByTestId('resource-list-session')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Search tasks')).not.toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Failed to get tasks')
    expect(screen.getByRole('alert')).toHaveTextContent('Failed request')

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    expect(sessionDataMocks.reload).toHaveBeenCalled()
  })

  it('keeps grouped sessions in the generic loading state until all pages are ready', () => {
    preferenceMocks.values.set('agent.session.display_mode', 'workdir')
    setupSessions({
      sessions: [createSession({ id: 'session-first-page', name: 'First page session', agentId: 'agent-a' })],
      hasMore: true,
      isFullyLoaded: false,
      isLoadingAll: true
    })
    agentDataMocks.useAgents.mockReturnValue({
      agents: [
        { id: 'agent-a', model: 'model-a', name: 'Alpha agent' },
        { id: 'agent-b', model: 'model-b', name: 'Beta agent' }
      ],
      isLoading: false,
      error: undefined
    })

    render(<SessionsForTest />)

    expect(screen.queryByTestId('resource-list-grouped-loading')).not.toBeInTheDocument()
    expect(screen.queryByText('project-a')).not.toBeInTheDocument()
    expect(screen.queryByText('First page session')).not.toBeInTheDocument()
    expect(screen.queryByText('1')).not.toBeInTheDocument()
    expect(screen.queryAllByTestId('agent-session-row')).toHaveLength(0)
    expect(document.querySelectorAll('[data-resource-list-loading-group]')).toHaveLength(2)
    expect(document.querySelectorAll('[data-resource-list-loading-item]')).toHaveLength(5)
    expect(document.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0)
  })

  it('keeps workdir sessions loading until workspace rows are ready', () => {
    dataApiMocks.workspacesLoading = true

    render(<SessionsForTest />)

    expect(screen.queryByText('Project A Workspace')).not.toBeInTheDocument()
    expect(screen.queryByText('Alpha session')).not.toBeInTheDocument()
    expect(document.querySelectorAll('[data-resource-list-loading-group]')).toHaveLength(2)
    expect(document.querySelectorAll('[data-resource-list-loading-item]')).toHaveLength(5)
  })

  it('keeps workdir sessions visible while workspace rows refresh', () => {
    dataApiMocks.workspacesRefreshing = true

    render(<SessionsForTest />)

    expect(screen.getByRole('button', { name: 'Project A Workspace' })).toBeInTheDocument()
    expect(screen.getByText('Alpha session')).toBeInTheDocument()
    expect(document.querySelectorAll('[data-resource-list-loading-group]')).toHaveLength(0)
    expect(document.querySelectorAll('[data-resource-list-loading-item]')).toHaveLength(0)
  })

  it('renders workspace load errors in workdir mode', async () => {
    dataApiMocks.workspacesError = new Error('Workspace request failed')

    render(<SessionsForTest />)

    expect(screen.getByRole('alert')).toHaveTextContent('Failed to get tasks')
    expect(screen.getByRole('alert')).toHaveTextContent('Workspace request failed')

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    await vi.waitFor(() => expect(dataApiMocks.refetchWorkspaces).toHaveBeenCalled())
  })

  it('does not block time grouping on workspace loading state', () => {
    preferenceMocks.values.set('agent.session.display_mode', 'time')
    setSessionGroupExpansionCache(createExpandedSessionGroupExpansionFixture())
    dataApiMocks.workspacesLoading = true
    dataApiMocks.workspacesError = new Error('Workspace request failed')

    render(<SessionsForTest />)

    expect(screen.getByText('Alpha session')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Today' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('does not show group header create actions in time display mode', () => {
    preferenceMocks.values.set('agent.session.display_mode', 'time')

    render(<SessionsForTest />)

    const todayHeader = screen.getByRole('button', { name: 'Today' }).closest('div')
    expect(todayHeader).toBeInTheDocument()
    expect(
      within(todayHeader as HTMLElement).queryByRole('button', { name: 'chat.conversation.new' })
    ).not.toBeInTheDocument()
  })

  it('starts a draft session from the header without creating inline', async () => {
    const onStartDraftSession = vi.fn()
    dataApiMocks.workspaces = [
      makeWorkspace('/Users/jd/project-b', { id: 'ws-b', name: 'Project B Workspace', orderKey: 'a' }),
      makeWorkspace('/Users/jd/project-a', { id: 'ws-a', name: 'Project A Workspace', orderKey: 'b' })
    ]
    agentDataMocks.useAgents.mockReturnValue({
      agents: [
        { id: 'agent-a', model: 'model-a', name: 'Alpha agent' },
        { id: 'agent-b', model: 'model-b', name: 'Beta agent' }
      ],
      isLoading: false,
      error: undefined
    })
    setupSessions({
      sessions: [
        createSession({
          id: 'session-a',
          name: 'Alpha session',
          agentId: 'agent-a',
          workspaceId: 'ws-a',
          workspace: makeWorkspace('/Users/jd/project-a', { id: 'ws-a' }),
          updatedAt: '2026-01-02T00:00:00.000Z'
        }),
        createSession({
          id: 'session-b',
          name: 'Beta session',
          agentId: 'agent-b',
          workspaceId: 'ws-b',
          workspace: makeWorkspace('/Users/jd/project-b', { id: 'ws-b' }),
          updatedAt: '2026-01-03T00:00:00.000Z'
        })
      ]
    })

    render(<SessionsForTest onStartDraftSession={onStartDraftSession} />)

    fireEvent.click(screen.getByRole('button', { name: 'Add task' }))

    expect(sessionDataMocks.createSession).not.toHaveBeenCalled()
    expect(onStartDraftSession).toHaveBeenCalledWith({
      agentId: 'agent-b',
      workspace: { type: 'user', workspaceId: 'ws-b' }
    })
    await vi.waitFor(() => expect(cacheMocks.setActiveSessionId).toHaveBeenCalledWith(null, null))
  })

  it('toggles the left agent sidebar from the list options menu', () => {
    render(<SessionsForTest />)

    openSessionListOptions()
    fireEvent.click(screen.getByRole('button', { name: 'Toggle Left Sidebar' }))

    expect(preferenceMocks.setPreference).toHaveBeenCalledWith('topic.tab.show', false)
  })

  it('reveals a history-selected session hidden by search and show-more with row focus', async () => {
    setupSessions({
      sessions: Array.from({ length: 6 }, (_, index) =>
        createSession({
          id: `session-${index + 1}`,
          name: `Session ${index + 1}`,
          orderKey: `${index + 1}`
        })
      )
    })

    const { rerender } = render(<SessionsForTest />)

    expect(screen.queryByText('Session 6')).not.toBeInTheDocument()

    vi.useFakeTimers()
    rerender(
      <SessionsForTest revealRequest={{ itemId: 'session-6', requestId: 1, clearFilters: true, clearQuery: true }} />
    )

    expect(screen.getByText('Session 6')).toBeInTheDocument()
    const revealedRow = screen.getByText('Session 6').closest('[role="option"]')
    expect(revealedRow).not.toBeNull()
    expect(revealedRow!).toHaveAttribute('data-reveal-focus', 'true')
    expect(revealedRow!).toHaveClass('animation-resource-list-reveal-focus')
    expect(virtualMocks.scrollToIndex).toHaveBeenCalledWith(expect.any(Number), { align: 'center' })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(999)
    })
    expect(revealedRow!).toHaveAttribute('data-reveal-focus', 'true')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(revealedRow!).not.toHaveAttribute('data-reveal-focus')
  })

  it('renames sessions through the shared update session hook', async () => {
    render(<SessionsForTest />)

    fireEvent.doubleClick(screen.getByText('Alpha session'))
    const input = screen.getByLabelText('Edit task')
    expect(input).toHaveFocus()
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

  it('renames sessions from the context menu dialog', async () => {
    render(<SessionsForTest />)

    fireEvent.contextMenu(screen.getByText('Alpha session'))
    const alphaMenu = screen.getByText('Alpha session').closest('[data-testid="context-menu"]')
    const menuContent = alphaMenu?.querySelector('[data-testid="context-menu-content"]')
    fireEvent.click(within(menuContent as HTMLElement).getByRole('menuitem', { name: 'Rename' }))

    expect(sessionDataMocks.updateSession).not.toHaveBeenCalled()

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('Edit task')
    const input = within(dialog).getByLabelText('Name')
    expect(sessionDataMocks.updateSession).not.toHaveBeenCalled()

    fireEvent.change(input, { target: { value: 'Renamed from menu' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await vi.waitFor(() =>
      expect(sessionDataMocks.updateSession).toHaveBeenCalledWith(
        { id: 'session-a', name: 'Renamed from menu' },
        { showSuccessToast: false }
      )
    )
  })

  it('opens a session message page in a new app tab from the context menu', async () => {
    render(<SessionsForTest />)

    fireEvent.contextMenu(screen.getByText('Beta session'))
    const betaMenu = screen.getByText('Beta session').closest('[data-testid="context-menu"]')
    const menuContent = betaMenu?.querySelector('[data-testid="context-menu-content"]')
    const animationFrameCallbacks: FrameRequestCallback[] = []
    const requestAnimationFrameSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      animationFrameCallbacks.push(callback)
      return animationFrameCallbacks.length
    })

    fireEvent.click(within(menuContent as HTMLElement).getByRole('menuitem', { name: 'Open in new tab' }))

    expect(tabsContextMocks.openTab).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(animationFrameCallbacks.length).toBeGreaterThan(0))
    act(() => {
      for (const callback of animationFrameCallbacks.splice(0)) {
        callback(0)
      }
    })
    expect(tabsContextMocks.openTab).toHaveBeenCalledWith('/app/agents', {
      forceNew: true,
      title: 'Beta session',
      metadata: { instanceAppId: 'agents', instanceKey: 'session-b' }
    })
    requestAnimationFrameSpy.mockRestore()
  })

  it('hides open-in-new-tab for the active session context menu', () => {
    render(<SessionsForTest />)

    fireEvent.contextMenu(screen.getByText('Alpha session'))
    const alphaMenu = screen.getByText('Alpha session').closest('[data-testid="context-menu"]')
    const menuContent = alphaMenu?.querySelector('[data-testid="context-menu-content"]')

    expect(menuContent).not.toHaveTextContent('Open in new tab')
  })

  it('hides the inline delete action for pinned sessions', () => {
    setupSessions({
      sessions: [
        createSession({ id: 'session-a', name: 'Alpha session', orderKey: 'a' }),
        createSession({ id: 'session-pinned', name: 'Pinned session', orderKey: 'b' })
      ],
      pinIdBySessionId: new Map([['session-pinned', 'pin-session-pinned']])
    })

    render(<SessionsForTest />)

    const pinnedRow = screen.getByText('Pinned session').closest('[role="option"]')
    expect(pinnedRow).not.toBeNull()
    const unpinButton = within(pinnedRow as HTMLElement).getByLabelText('Unpin task')
    expect(unpinButton).toBeInTheDocument()
    expect(unpinButton.closest('[data-resource-list-item-actions="true"]')).toBeInTheDocument()
    expect(
      pinnedRow?.querySelector('[data-resource-list-leading-slot="true"] [aria-label="Unpin task"]') ?? null
    ).not.toBeInTheDocument()
    expect(within(pinnedRow as HTMLElement).queryByLabelText('Delete')).not.toBeInTheDocument()
  })

  it('requires a second inline click before deleting a session', async () => {
    render(<SessionsForTest />)

    const sessionRow = screen.getByText('Alpha session').closest('[role="option"]')
    const deleteButton = within(sessionRow as HTMLElement).getByLabelText('Delete')

    act(() => {
      fireEvent.click(deleteButton)
    })

    expect(sessionDataMocks.deleteSession).not.toHaveBeenCalled()
    expect(deleteButton).toHaveAttribute('data-deleting', 'true')

    act(() => {
      fireEvent.click(deleteButton)
    })

    await vi.waitFor(() => expect(sessionDataMocks.deleteSession).toHaveBeenCalledWith('session-a'))
  })

  it('subscribes stream status only for visible session rows', () => {
    preferenceMocks.values.set('agent.session.display_mode', 'workdir')
    setSessionGroupExpansionCache({
      ...createExpandedSessionGroupExpansionFixture(),
      // Collapse the workspace groups; sections stay expanded.
      workdir: ['session:workspace:ws-a', 'session:workspace:ws-b']
    })

    render(<SessionsForTest />)

    expect(screen.getByRole('button', { name: 'Project A Workspace' })).toBeInTheDocument()
    expect(screen.queryByText('Alpha session')).not.toBeInTheDocument()
    expect(topicStreamStatusMocks.useTopicStreamStatus).not.toHaveBeenCalledWith('agent-session:session-a')
    expect(topicStreamStatusMocks.useTopicStreamStatus).not.toHaveBeenCalledWith('agent-session:session-b')
  })

  it('keeps fulfilled session stream indicators static while pending indicators pulse', () => {
    topicStreamStatusMocks.useTopicStreamStatus.mockImplementation((topicId: string) =>
      createTopicStreamStatusMock(topicId === 'agent-session:session-b' ? { isFulfilled: true } : { isPending: true })
    )

    const { unmount } = render(<SessionsForTest />)

    const indicator = screen.getByTestId('agent-session-stream-indicator')
    expect(indicator.firstElementChild).toHaveClass('bg-success')
    expect(indicator.firstElementChild).not.toHaveClass('animation-pulse')

    topicStreamStatusMocks.useTopicStreamStatus.mockImplementation((topicId: string) =>
      createTopicStreamStatusMock(topicId === 'agent-session:session-b' ? { isPending: true } : {})
    )

    unmount()
    render(<SessionsForTest />)

    expect(screen.getByTestId('agent-session-stream-indicator').firstElementChild).toHaveClass('animation-pulse')
  })

  it('persists display mode selection from the header menu', () => {
    render(<SessionsForTest />)

    const displayModeContent = openSessionListOptions()
    fireEvent.click(within(displayModeContent as HTMLElement).getByRole('button', { name: 'Work directory' }))

    expect(preferenceMocks.setPreference).toHaveBeenCalledWith('agent.session.display_mode', 'workdir')
  })

  it('blocks cross-workspace groups from drag start while preserving same-workspace reorder', async () => {
    preferenceMocks.values.set('agent.session.display_mode', 'workdir')
    setupSessions({
      sessions: [
        createSession({
          id: 'session-a',
          name: 'Alpha session',
          workspaceId: 'ws-a',
          workspace: makeWorkspace('/Users/jd/project-a', { id: 'ws-a' }),
          orderKey: 'a'
        }),
        createSession({
          id: 'session-b',
          name: 'Beta session',
          workspaceId: 'ws-a',
          workspace: makeWorkspace('/Users/jd/project-a', { id: 'ws-a' }),
          orderKey: 'b'
        }),
        createSession({
          id: 'session-c',
          name: 'Gamma session',
          workspaceId: 'ws-b',
          workspace: makeWorkspace('/Users/jd/project-b', { id: 'ws-b' }),
          orderKey: 'c'
        })
      ],
      pinIdBySessionId: new Map([['session-c', 'pin-session-c']])
    })

    render(<SessionsForTest />)

    expect(screen.getByTestId('dnd-context')).toBeInTheDocument()
    startDraggingSession('session-a')

    expectGroupBlocked('Pinned')
    expectSessionBlocked('Gamma session')
    expect(screen.getByRole('button', { name: 'Project A Workspace' }).closest('[data-drop-blocked="true"]')).toBeNull()
    expect(screen.getByText('Beta session').closest('[data-drop-blocked="true"]')).toBeNull()

    act(() => {
      dndMocks.onDragEnd?.({
        active: {
          data: sortableData('item:session-a'),
          id: 'item:session-a',
          rect: { current: { initial: null, translated: { top: 100, height: 20 } } }
        },
        over: { data: sortableData('item:session-b'), id: 'item:session-b', rect: { top: 10, height: 20 } }
      })
    })

    await vi.waitFor(() =>
      expect(sessionDataMocks.reorderSession).toHaveBeenCalledWith('session-a', { after: 'session-b' })
    )
  })

  it('blocks cross-agent groups while preserving same-agent reorder', async () => {
    preferenceMocks.values.set('agent.session.display_mode', 'agent')
    agentDataMocks.useAgents.mockReturnValue({
      agents: [
        { id: 'agent-a', model: 'model-a', name: 'Alpha agent' },
        { id: 'agent-b', model: 'model-b', name: 'Beta agent' }
      ],
      isLoading: false,
      error: undefined
    })
    setupSessions({
      sessions: [
        createSession({ id: 'session-a', name: 'Alpha session', agentId: 'agent-a', orderKey: 'a' }),
        createSession({ id: 'session-b', name: 'Beta session', agentId: 'agent-a', orderKey: 'b' }),
        createSession({ id: 'session-c', name: 'Gamma session', agentId: 'agent-b', orderKey: 'c' })
      ]
    })

    render(<SessionsForTest />)

    expect(screen.getByTestId('dnd-context')).toBeInTheDocument()
    startDraggingSession('session-a')

    expectSessionBlocked('Gamma session')
    expect(screen.getByText('Beta session').closest('[data-drop-blocked="true"]')).toBeNull()

    act(() => {
      dndMocks.onDragEnd?.({
        active: {
          data: sortableData('item:session-a'),
          id: 'item:session-a',
          rect: { current: { initial: null, translated: { top: 100, height: 20 } } }
        },
        over: { data: sortableData('item:session-b'), id: 'item:session-b', rect: { top: 10, height: 20 } }
      })
    })

    await vi.waitFor(() =>
      expect(sessionDataMocks.reorderSession).toHaveBeenCalledWith('session-a', { after: 'session-b' })
    )
  })

  it('reorders workspace groups through the workspace order endpoint', async () => {
    preferenceMocks.values.set('agent.session.display_mode', 'workdir')
    setupSessions({
      sessions: [
        createSession({
          id: 'session-a',
          name: 'Alpha session',
          workspaceId: 'ws-a',
          workspace: makeWorkspace('/Users/jd/project-a', { id: 'ws-a' }),
          orderKey: 'a'
        }),
        createSession({
          id: 'session-b',
          name: 'Beta session',
          workspaceId: 'ws-b',
          workspace: makeWorkspace('/Users/jd/project-b', { id: 'ws-b' }),
          orderKey: 'b'
        })
      ]
    })

    render(<SessionsForTest />)

    const projectAGroupId = 'session:workspace:ws-a'
    const projectBGroupId = 'session:workspace:ws-b'
    startDraggingGroup(projectAGroupId)

    act(() => {
      dndMocks.onDragEnd?.({
        active: {
          data: sortableData(`group:${projectAGroupId}`),
          id: `group:${projectAGroupId}`
        },
        over: {
          data: sortableData(`group:${projectBGroupId}`),
          id: `group:${projectBGroupId}`
        }
      })
    })

    await vi.waitFor(() =>
      expect(dataApiMocks.reorderWorkspace).toHaveBeenCalledWith({
        body: { after: 'ws-b' },
        params: { id: 'ws-a' }
      })
    )
    expect(dataApiMocks.refetchWorkspaces).toHaveBeenCalled()
  })

  it('reorders agent groups through the agent order endpoint', async () => {
    preferenceMocks.values.set('agent.session.display_mode', 'agent')
    agentDataMocks.useAgents.mockReturnValue({
      agents: [
        { id: 'agent-a', model: 'model-a', name: 'Alpha agent', orderKey: 'a' },
        { id: 'agent-b', model: 'model-b', name: 'Beta agent', orderKey: 'b' }
      ],
      isLoading: false,
      error: undefined,
      refetch: dataApiMocks.refetchAgents
    })
    setupSessions({
      sessions: [
        createSession({ id: 'session-a', name: 'Alpha session', agentId: 'agent-a', orderKey: 'a' }),
        createSession({ id: 'session-b', name: 'Beta session', agentId: 'agent-b', orderKey: 'b' })
      ]
    })

    render(<SessionsForTest />)

    const alphaGroupId = 'session:agent:agent-a'
    const betaGroupId = 'session:agent:agent-b'
    startDraggingGroup(alphaGroupId)

    act(() => {
      dndMocks.onDragEnd?.({
        active: {
          data: sortableData(`group:${alphaGroupId}`),
          id: `group:${alphaGroupId}`
        },
        over: {
          data: sortableData(`group:${betaGroupId}`),
          id: `group:${betaGroupId}`
        }
      })
    })

    await vi.waitFor(() =>
      expect(dataApiMocks.reorderAgent).toHaveBeenCalledWith({
        body: { after: 'agent-b' },
        params: { id: 'agent-a' }
      })
    )
    expect(dataApiMocks.refetchAgents).toHaveBeenCalled()
  })

  it('opens a workspace group from the more menu without collapsing the group', async () => {
    render(<SessionsForTest />)

    const workdirGroupButton = screen.getByRole('button', { name: 'Project A Workspace' })
    const workdirGroup = workdirGroupButton.closest('div')
    expect(workdirGroup).not.toBeNull()
    expect(
      within(workdirGroup as HTMLElement).queryByRole('button', { name: 'Delete work directory' })
    ).not.toBeInTheDocument()

    fireEvent.pointerDown(within(workdirGroup as HTMLElement).getByRole('button', { name: 'More' }))
    expect(workdirGroupButton).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Open in Files' }))

    await vi.waitFor(() => expect(window.api.file.openPath).toHaveBeenCalledWith('/Users/jd/project-a'))
  })

  it('collapses workspace groups from the display options menu', async () => {
    // Seed an unrelated collapsed entry to verify collapse-all only adds the visible group.
    setSessionGroupExpansionCache({
      ...createExpandedSessionGroupExpansionFixture(),
      workdir: ['session:workspace:ws-b']
    })
    setupSessions({
      sessions: Array.from({ length: 6 }, (_, index) =>
        createSession({
          id: index === 0 ? 'session-a' : `workspace-session-${index + 1}`,
          name: `Workspace session ${index + 1}`,
          workspaceId: 'ws-a',
          workspace: makeWorkspace('/Users/jd/project-a', { id: 'ws-a' }),
          orderKey: String(index + 1).padStart(3, '0')
        })
      )
    })

    const view = render(<SessionsForTest />)

    expect(screen.getByText('Workspace session 1')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Display mode' }))
    fireEvent.click(screen.getByRole('button', { name: 'Collapse all' }))
    await vi.waitFor(() => {
      expect(getSessionGroupExpansionCache().workdir).toContain('session:workspace:ws-a')
    })
    const collapsedWorkdirIds = getSessionGroupExpansionCache().workdir
    expect(collapsedWorkdirIds).not.toContain(SESSION_WORKDIR_SECTION_ID)
    expect(collapsedWorkdirIds).toContain('session:workspace:ws-b')
    expect(collapsedWorkdirIds).toContain('session:workspace:ws-a')
    view.rerender(<SessionsForTest key="collapsed-project-groups" />)

    await vi.waitFor(() =>
      expect(screen.getByRole('button', { name: 'Project A Workspace' })).toHaveAttribute('aria-expanded', 'false')
    )
    await vi.waitFor(() => expect(screen.queryByText('Workspace session 1')).not.toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Expand display' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Display mode' }))
    expect(screen.getByRole('button', { name: 'Expand all' })).toBeInTheDocument()
  })

  it('opens the workspace group more menu from the group header context menu', () => {
    render(<SessionsForTest />)

    const workdirGroupButton = screen.getByRole('button', { name: 'Project A Workspace' })
    const workdirGroup = workdirGroupButton.closest('div')
    expect(workdirGroup).not.toBeNull()

    fireEvent.contextMenu(workdirGroup as HTMLElement, { clientX: 123, clientY: 456 })

    expect(
      screen
        .getAllByRole('menuitem', { name: 'Open in Files' })
        .some((item) => item.getAttribute('data-slot') !== 'dropdown-menu-item')
    ).toBe(true)
    expect(workdirGroupButton).toHaveAttribute('aria-expanded', 'true')
  })

  it('renames a workspace group through the workspace update endpoint', async () => {
    render(<SessionsForTest />)

    const workdirGroup = screen.getByRole('button', { name: 'Project A Workspace' }).closest('div')
    expect(workdirGroup).not.toBeNull()
    fireEvent.pointerDown(within(workdirGroup as HTMLElement).getByRole('button', { name: 'More' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Rename work directory' }))

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('Rename work directory')
    const input = within(dialog).getByLabelText('Name')
    expect(input).toHaveValue('Project A Workspace')

    fireEvent.change(input, { target: { value: 'Renamed Workspace' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await vi.waitFor(() =>
      expect(dataApiMocks.updateWorkspace).toHaveBeenCalledWith({
        body: { name: 'Renamed Workspace' },
        params: { workspaceId: 'ws-a' }
      })
    )
    expect(dataApiMocks.mutationOptions.get('PATCH /agent-workspaces/:workspaceId')?.refresh).toEqual([
      '/agent-workspaces',
      '/agent-sessions'
    ])
    expect(window.toast.success).toHaveBeenCalledWith('Saved')
  })

  it('deletes a workspace group through the workspace delete endpoint', async () => {
    const callOrder: string[] = []
    dataApiMocks.deleteWorkspace.mockImplementationOnce(async () => {
      callOrder.push('workspace')
    })
    agentDataMocks.useAgents.mockReturnValue({
      agents: [],
      isLoading: false,
      error: undefined
    })
    setupSessions({
      sessions: [
        createSession({
          agentId: null,
          id: 'session-a',
          name: 'Alpha session',
          workspaceId: 'ws-a',
          workspace: makeWorkspace('/Users/jd/project-a', { id: 'ws-a' }),
          orderKey: 'a'
        }),
        createSession({
          agentId: null,
          id: 'session-pinned',
          name: 'Pinned Alpha session',
          workspaceId: 'ws-a',
          workspace: makeWorkspace('/Users/jd/project-a', { id: 'ws-a' }),
          orderKey: 'b'
        }),
        createSession({
          agentId: null,
          id: 'session-b',
          name: 'Beta session',
          workspaceId: 'ws-b',
          workspace: makeWorkspace('/Users/jd/project-b', { id: 'ws-b' }),
          orderKey: 'c'
        })
      ],
      pinIdBySessionId: new Map([['session-pinned', 'pin-session-pinned']])
    })

    render(<SessionsForTest />)

    const workdirGroup = screen.getByRole('button', { name: 'Project A Workspace' }).closest('div')
    expect(workdirGroup).not.toBeNull()
    fireEvent.pointerDown(within(workdirGroup as HTMLElement).getByRole('button', { name: 'More' }))
    const deleteWorkspaceButton = within(workdirGroup as HTMLElement).getByRole('menuitem', {
      name: 'Delete work directory'
    })
    expect(deleteWorkspaceButton.querySelector('svg')).toHaveClass('lucide-custom', 'text-destructive')
    fireEvent.click(deleteWorkspaceButton)

    await vi.waitFor(() =>
      expect(dataApiMocks.deleteWorkspace).toHaveBeenCalledWith({
        params: { workspaceId: 'ws-a' }
      })
    )
    expect(window.modal.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'Deleting this work directory also deletes tasks under it. The actual folder is not deleted.'
      })
    )
    expect(dataApiMocks.mutationOptions.get('DELETE /agent-workspaces/:workspaceId')?.refresh).toEqual([
      '/agent-sessions',
      '/agent-workspaces',
      '/pins',
      '/agent-channels'
    ])
    expect(sessionDataMocks.deleteSession).not.toHaveBeenCalled()
    expect(callOrder).toEqual(['workspace'])
    expect(cacheMocks.setActiveSessionId).toHaveBeenCalledWith(
      'session-b',
      expect.objectContaining({ id: 'session-b' })
    )
    expect(dataApiMocks.refetchWorkspaces).toHaveBeenCalled()
    expect(sessionDataMocks.reload).toHaveBeenCalled()
  })

  it('creates sessions from workspace group actions', async () => {
    const onStartDraftSession = vi.fn()
    preferenceMocks.values.set('agent.session.display_mode', 'workdir')
    cacheMocks.state.activeSessionId = 'session-b'
    setupSessions({
      sessions: [
        createSession({
          id: 'session-a',
          name: 'Alpha session',
          agentId: 'agent-a',
          workspaceId: 'ws-a',
          workspace: makeWorkspace('/Users/jd/project-a', { id: 'ws-a' }),
          orderKey: 'b',
          updatedAt: '2026-01-03T00:00:00.000Z'
        }),
        createSession({
          id: 'session-b',
          name: 'Beta session',
          agentId: 'agent-b',
          workspaceId: 'ws-a',
          workspace: makeWorkspace('/Users/jd/project-a', { id: 'ws-a' }),
          orderKey: 'a',
          updatedAt: '2026-01-02T00:00:00.000Z'
        })
      ]
    })
    render(<SessionsForTest onStartDraftSession={onStartDraftSession} />)

    const workdirGroup = screen.getByRole('button', { name: 'Project A Workspace' }).closest('div')
    expect(workdirGroup).not.toBeNull()
    fireEvent.click(within(workdirGroup as HTMLElement).getByRole('button', { name: 'chat.conversation.new' }))

    await vi.waitFor(() =>
      expect(onStartDraftSession).toHaveBeenCalledWith({
        agentId: 'agent-a',
        workspace: { type: 'user', workspaceId: 'ws-a' }
      })
    )
    expect(dataApiMocks.findOrCreateWorkspace).not.toHaveBeenCalled()
  })

  it('opens agent group edit and toggles agent pin from the more menu', async () => {
    const toggleAgentPin = vi.fn().mockResolvedValue(undefined)
    const refetchPins = vi.fn().mockResolvedValue(undefined)
    preferenceMocks.values.set('agent.session.display_mode', 'agent')
    pinMocks.usePins.mockReturnValue({
      isLoading: false,
      isRefreshing: false,
      isMutating: false,
      error: undefined,
      pinnedIds: [],
      refetch: refetchPins,
      togglePin: toggleAgentPin
    })
    agentDataMocks.useAgents.mockReturnValue({
      agents: [{ id: 'agent-a', model: 'model-a', name: 'Alpha agent' }],
      isLoading: false,
      error: undefined,
      refetch: dataApiMocks.refetchAgents
    })
    setupSessions({
      sessions: [createSession({ id: 'session-a', name: 'Alpha session', agentId: 'agent-a', orderKey: 'a' })]
    })

    render(<SessionsForTest />)

    expect(pinMocks.usePins).toHaveBeenCalledWith('agent', { enabled: true })
    const agentGroup = screen.getByRole('button', { name: 'Alpha agent' }).closest('div')
    expect(agentGroup).not.toBeNull()
    expect(agentGroup).toHaveClass('border', 'border-transparent')
    expect(agentGroup).toHaveAttribute('title', 'Drag to reorder. Drag tasks to adjust display and hidden groups.')
    expect(within(agentGroup as HTMLElement).getByRole('button', { name: 'chat.conversation.new' })).toBeInTheDocument()

    const moreButton = within(agentGroup as HTMLElement).getByRole('button', { name: 'More' })
    fireEvent.pointerDown(moreButton)
    const editMenuItem = (await screen.findAllByRole('menuitem', { name: 'Edit Agent' })).find(
      (button) => button.getAttribute('data-slot') === 'dropdown-menu-item'
    )
    expect(editMenuItem).toBeDefined()
    fireEvent.click(editMenuItem as HTMLElement)
    await vi.waitFor(() =>
      expect(screen.getByTestId('resource-edit-dialog-host')).toHaveAttribute('data-kind', 'agent')
    )
    expect(screen.getByTestId('resource-edit-dialog-host')).toHaveAttribute('data-id', 'agent-a')
    expect(tabsContextMocks.openTab).not.toHaveBeenCalledWith(
      '/app/library?resourceType=agent&action=edit&id=agent-a',
      expect.anything()
    )

    fireEvent.pointerDown(moreButton)
    const pinMenuItem = screen
      .getAllByRole('menuitem', { name: 'Pin Agent' })
      .find((button) => button.getAttribute('data-slot') === 'dropdown-menu-item')
    expect(pinMenuItem).toBeDefined()
    fireEvent.click(pinMenuItem as HTMLElement)

    await vi.waitFor(() => expect(toggleAgentPin).toHaveBeenCalledWith('agent-a'))
    await vi.waitFor(() => expect(dataApiMocks.refetchAgents).toHaveBeenCalled())
  })

  it('deletes agent group sessions through the agent-scoped batch endpoint', async () => {
    preferenceMocks.values.set('agent.session.display_mode', 'agent')
    agentDataMocks.useAgents.mockReturnValue({
      agents: [
        { id: 'agent-a', model: 'model-a', name: 'Alpha agent' },
        { id: 'agent-b', model: 'model-b', name: 'Beta agent' }
      ],
      isLoading: false,
      error: undefined,
      refetch: dataApiMocks.refetchAgents
    })
    setupSessions({
      sessions: [
        createSession({ id: 'session-a', name: 'Alpha session', agentId: 'agent-a', orderKey: 'a' }),
        createSession({ id: 'session-b', name: 'Beta session', agentId: 'agent-b', orderKey: 'b' })
      ]
    })
    dataApiMocks.deleteAgentSessions.mockResolvedValueOnce({ deletedIds: ['session-a'], deletedCount: 1 })

    render(<SessionsForTest />)

    const agentGroup = screen.getByRole('button', { name: 'Alpha agent' }).closest('div')
    expect(agentGroup).not.toBeNull()
    fireEvent.pointerDown(within(agentGroup as HTMLElement).getByRole('button', { name: 'More' }))
    const deleteMenuItem = screen
      .getAllByRole('menuitem', { name: 'Delete agent tasks' })
      .find((button) => button.getAttribute('data-slot') === 'dropdown-menu-item')
    expect(deleteMenuItem).toBeDefined()
    expect(deleteMenuItem?.querySelector('svg')).toHaveClass('lucide-custom', 'text-destructive')
    fireEvent.click(deleteMenuItem as HTMLElement)

    await vi.waitFor(() =>
      expect(dataApiMocks.deleteAgentSessions).toHaveBeenCalledWith({
        params: { agentId: 'agent-a' }
      })
    )
    expect(window.modal.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        content:
          "Deleting this agent's tasks will delete all tasks associated with this agent. The agent itself will not be deleted.",
        title: 'Delete agent tasks'
      })
    )
    expect(dataApiMocks.mutationOptions.get('DELETE /agents/:agentId/sessions')?.refresh).toEqual([
      '/agent-sessions',
      '/agent-workspaces',
      '/pins',
      '/agent-channels'
    ])
    expect(sessionDataMocks.deleteSession).not.toHaveBeenCalled()
    expect(cacheMocks.setActiveSessionId).toHaveBeenCalledWith(
      'session-b',
      expect.objectContaining({ id: 'session-b' })
    )
    await vi.waitFor(() => expect(sessionDataMocks.reload).toHaveBeenCalled())
  })

  it('blocks concurrent agent group delete confirmations', async () => {
    let resolveConfirm!: (value: boolean) => void
    const confirmPromise = new Promise<boolean>((resolve) => {
      resolveConfirm = resolve
    })
    const confirm = vi.fn().mockReturnValue(confirmPromise)
    Object.assign(window, { modal: { confirm } })
    preferenceMocks.values.set('agent.session.display_mode', 'agent')
    agentDataMocks.useAgents.mockReturnValue({
      agents: [
        { id: 'agent-a', model: 'model-a', name: 'Alpha agent' },
        { id: 'agent-b', model: 'model-b', name: 'Beta agent' }
      ],
      isLoading: false,
      error: undefined,
      refetch: dataApiMocks.refetchAgents
    })
    setupSessions({
      sessions: [
        createSession({ id: 'session-a', name: 'Alpha session', agentId: 'agent-a', orderKey: 'a' }),
        createSession({ id: 'session-b', name: 'Beta session', agentId: 'agent-b', orderKey: 'b' })
      ]
    })
    dataApiMocks.deleteAgentSessions.mockResolvedValueOnce({ deletedIds: ['session-a'], deletedCount: 1 })

    render(<SessionsForTest />)

    const alphaGroup = screen.getByRole('button', { name: 'Alpha agent' }).closest('div')
    const betaGroup = screen.getByRole('button', { name: 'Beta agent' }).closest('div')
    expect(alphaGroup).not.toBeNull()
    expect(betaGroup).not.toBeNull()
    fireEvent.pointerDown(within(alphaGroup as HTMLElement).getByRole('button', { name: 'More' }))
    fireEvent.click(within(alphaGroup as HTMLElement).getByRole('menuitem', { name: 'Delete agent tasks' }))

    await vi.waitFor(() => expect(confirm).toHaveBeenCalledTimes(1))
    fireEvent.pointerDown(within(betaGroup as HTMLElement).getByRole('button', { name: 'More' }))
    const betaDeleteMenuItem = within(betaGroup as HTMLElement).getByRole('menuitem', { name: 'Delete agent tasks' })
    await vi.waitFor(() => expect(betaDeleteMenuItem).toBeDisabled())
    fireEvent.click(betaDeleteMenuItem)

    expect(confirm).toHaveBeenCalledTimes(1)
    expect(dataApiMocks.deleteAgentSessions).not.toHaveBeenCalled()

    await act(async () => {
      resolveConfirm(true)
      await confirmPromise
    })

    await vi.waitFor(() => expect(dataApiMocks.deleteAgentSessions).toHaveBeenCalledTimes(1))
    expect(dataApiMocks.deleteAgentSessions).toHaveBeenCalledWith({ params: { agentId: 'agent-a' } })
  })

  it('collapses agent groups from the display options menu', async () => {
    preferenceMocks.values.set('agent.session.display_mode', 'agent')
    // Seed an unrelated collapsed entry to verify collapse-all only adds the visible group.
    setSessionGroupExpansionCache({
      ...createExpandedSessionGroupExpansionFixture(),
      agent: ['session:agent:agent-b']
    })
    setupSessions({
      sessions: Array.from({ length: 6 }, (_, index) =>
        createSession({
          id: index === 0 ? 'session-a' : `agent-session-${index + 1}`,
          name: `Agent session ${index + 1}`,
          agentId: 'agent-a',
          orderKey: String(index + 1).padStart(3, '0')
        })
      )
    })

    const view = render(<SessionsForTest />)

    expect(screen.getByText('Agent session 1')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Display mode' }))
    fireEvent.click(screen.getByRole('button', { name: 'Collapse all' }))
    await vi.waitFor(() => {
      expect(getSessionGroupExpansionCache().agent).toContain('session:agent:agent-a')
    })
    const collapsedAgentIds = getSessionGroupExpansionCache().agent
    expect(collapsedAgentIds).not.toContain(SESSION_AGENT_SECTION_ID)
    expect(collapsedAgentIds).toContain('session:agent:agent-b')
    expect(collapsedAgentIds).toContain('session:agent:agent-a')
    view.rerender(<SessionsForTest key="collapsed-agent-groups" />)

    await vi.waitFor(() =>
      expect(screen.getByRole('button', { name: 'Alpha agent' })).toHaveAttribute('aria-expanded', 'false')
    )
    await vi.waitFor(() => expect(screen.queryByText('Agent session 1')).not.toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Expand display' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Display mode' }))
    expect(screen.getByRole('button', { name: 'Expand all' })).toBeInTheDocument()
  })

  it('opens the agent group more menu from the group header context menu', async () => {
    const toggleAgentPin = vi.fn().mockResolvedValue(undefined)
    preferenceMocks.values.set('agent.session.display_mode', 'agent')
    pinMocks.usePins.mockReturnValue({
      isLoading: false,
      isRefreshing: false,
      isMutating: false,
      error: undefined,
      pinnedIds: [],
      refetch: vi.fn(),
      togglePin: toggleAgentPin
    })
    agentDataMocks.useAgents.mockReturnValue({
      agents: [{ id: 'agent-a', model: 'model-a', name: 'Alpha agent' }],
      isLoading: false,
      error: undefined,
      refetch: dataApiMocks.refetchAgents
    })
    setupSessions({
      sessions: [createSession({ id: 'session-a', name: 'Alpha session', agentId: 'agent-a', orderKey: 'a' })]
    })

    render(<SessionsForTest />)

    const agentGroupButton = screen.getByRole('button', { name: 'Alpha agent' })
    const agentGroup = agentGroupButton.closest('div')
    expect(agentGroup).not.toBeNull()

    fireEvent.contextMenu(agentGroup as HTMLElement, { clientX: 123, clientY: 456 })

    const contextEditItem = screen
      .getAllByRole('menuitem', { name: 'Edit Agent' })
      .find((item) => item.getAttribute('data-slot') !== 'dropdown-menu-item')
    expect(contextEditItem).toBeDefined()
    const contextPinItem = screen
      .getAllByRole('menuitem', { name: 'Pin Agent' })
      .find((item) => item.getAttribute('data-slot') !== 'dropdown-menu-item')
    expect(contextPinItem).toBeDefined()
    fireEvent.click(contextPinItem as HTMLElement)

    await vi.waitFor(() => expect(toggleAgentPin).toHaveBeenCalledWith('agent-a'))
    expect(agentGroupButton).toHaveAttribute('aria-expanded', 'true')
  })

  it('disables agent group pin action while agent pins are mutating', async () => {
    preferenceMocks.values.set('agent.session.display_mode', 'agent')
    pinMocks.usePins.mockReturnValue({
      isLoading: false,
      isRefreshing: false,
      isMutating: true,
      error: undefined,
      pinnedIds: ['agent-a'],
      refetch: vi.fn(),
      togglePin: vi.fn()
    })
    agentDataMocks.useAgents.mockReturnValue({
      agents: [{ id: 'agent-a', model: 'model-a', name: 'Alpha agent' }],
      isLoading: false,
      error: undefined,
      refetch: dataApiMocks.refetchAgents
    })
    setupSessions({
      sessions: [createSession({ id: 'session-a', name: 'Alpha session', agentId: 'agent-a', orderKey: 'a' })]
    })

    render(<SessionsForTest />)

    const agentGroup = screen.getByRole('button', { name: 'Alpha agent' }).closest('div')
    expect(agentGroup).not.toBeNull()
    fireEvent.pointerDown(within(agentGroup as HTMLElement).getByRole('button', { name: 'More' }))

    expect(await screen.findByRole('menuitem', { name: 'Unpin Agent' })).toHaveAttribute('data-disabled')
  })
})
