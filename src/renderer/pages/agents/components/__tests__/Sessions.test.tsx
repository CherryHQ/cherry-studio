import type * as CherryStudioUi from '@cherrystudio/ui'
import { dataApiService } from '@renderer/data/DataApiService'
import type * as UseAgentModule from '@renderer/hooks/agent/useAgent'
import type * as ImageCaptureTargetsHook from '@renderer/hooks/useImageCaptureTargets'
import { popup } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import type { AgentWorkspaceEntity } from '@shared/data/api/schemas/agentWorkspaces'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import type { ComponentProps, ReactNode } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@cherrystudio/ui', async (importOriginal) => {
  const React = await import('react')
  const actual = await importOriginal<typeof CherryStudioUi>()
  const ContextMenuContext = React.createContext<{ onOpenChange?: (open: boolean) => void }>({})
  const DropdownMenuRadioContext = React.createContext<{
    onValueChange?: (value: string) => void
    value?: string
  }>({})
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

        // eslint-disable-next-line @eslint-react/no-clone-element -- mock reproduces Radix asChild slot behavior
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
    DropdownMenuCheckboxItem: ({ children, checked, onCheckedChange, role, ...props }: any) => (
      <button
        {...props}
        aria-checked={checked}
        data-slot="dropdown-menu-checkbox-item"
        role={role ?? 'menuitemcheckbox'}
        type="button"
        onClick={() => onCheckedChange?.(!checked)}>
        {checked && <span className="lucide-check" />}
        {children}
      </button>
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
    DropdownMenuRadioGroup: ({
      children,
      onValueChange,
      value
    }: {
      children?: ReactNode
      onValueChange?: (value: string) => void
      value?: string
    }) => <DropdownMenuRadioContext value={{ onValueChange, value }}>{children}</DropdownMenuRadioContext>,
    DropdownMenuRadioItem: ({ children, value, ...props }: { children?: ReactNode; value: string }) => {
      const context = React.use(DropdownMenuRadioContext)
      return (
        <button
          {...props}
          aria-checked={context.value === value}
          data-slot="dropdown-menu-radio-item"
          role="menuitemradio"
          type="button"
          onClick={() => context.onValueChange?.(value)}>
          {children}
        </button>
      )
    },
    DropdownMenuSeparator: (props: any) => <hr data-testid="dropdown-menu-separator" {...props} />,
    DropdownMenuSub: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    DropdownMenuSubContent: ({ children, ...props }: { children?: ReactNode }) => <div {...props}>{children}</div>,
    DropdownMenuSubTrigger: ({ children, disabled, ...props }: any) => (
      <button
        data-disabled={disabled ? '' : undefined}
        data-slot="dropdown-menu-sub-trigger"
        disabled={disabled || undefined}
        role="menuitem"
        type="button"
        {...props}>
        {children}
      </button>
    ),
    DropdownMenuTrigger: ({ children }: { children?: ReactNode }) => <>{children}</>
  }
})

vi.mock('@renderer/components/Avatar/ModelAvatar', () => ({
  default: ({ model, size }: { model: { id: string; providerId: string }; size: number }) => (
    <span data-model-id={model.id} data-provider-id={model.providerId} data-size={size} data-testid="model-avatar" />
  )
}))

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
  source: null as unknown,
  stats: { total: 0, pinnedCount: 0, byAgent: [], byWorkspace: [] } as {
    total: number
    pinnedCount: number
    byAgent: Array<{ agentId: string | null; count: number; pinnedCount: number }>
    byWorkspace: Array<{ workspaceId: string; count: number; pinnedCount: number }>
  },
  togglePin: vi.fn().mockResolvedValue(undefined),
  updateSession: vi.fn().mockResolvedValue(undefined),
  useUpdateSession: vi.fn(),
  useSessions: vi.fn()
}))

const agentDataMocks = vi.hoisted(() => ({
  useAgents: vi.fn()
}))

const pinMocks = vi.hoisted(() => ({
  usePins: vi.fn(),
  usePinMutations: vi.fn(() => ({ pin: vi.fn(), unpin: vi.fn(), isMutating: false, error: undefined }))
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
  closeConversationTabs: vi.fn(),
  openTab: vi.fn(),
  setActiveTab: vi.fn(),
  tabs: [] as Array<{ id: string; type: string; url: string }>
}))
const windowFrameMocks = vi.hoisted(() => ({ mode: 'embedded' as 'embedded' | 'window' }))

const dataApiMocks = vi.hoisted(() => ({
  deleteAgent: vi.fn().mockResolvedValue(undefined),
  deleteWorkspace: vi.fn().mockResolvedValue({ deletedIds: [] as string[] }),
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

const agentSessionImageCaptureHostMocks = vi.hoisted(() => ({
  render: vi.fn()
}))

const imageCaptureTargetsMock = vi.hoisted(() => ({
  targets: undefined as Array<{ requestId: number; target: AgentSessionEntity }> | undefined
}))

const createTopicStreamStatusMock = (overrides: { isFulfilled?: boolean; isPending?: boolean } = {}) => ({
  activeExecutions: [],
  isFulfilled: overrides.isFulfilled ?? false,
  isPending: overrides.isPending ?? false,
  markSeen: vi.fn(),
  status: undefined
})

vi.mock('@renderer/hooks/agent/useSession', () => ({
  useAgentSessionStats: () => ({
    stats: sessionDataMocks.stats,
    isLoading: false,
    error: undefined,
    refetch: vi.fn().mockResolvedValue(undefined)
  }),
  useSessions: sessionDataMocks.useSessions,
  useUpdateSession: sessionDataMocks.useUpdateSession
}))

const cursorGroupWindowMocks = vi.hoisted(() => ({
  options: undefined as
    | undefined
    | {
        continuityKey: string
        fetchPage: (groupId: string, cursor?: string) => Promise<{ items: unknown[] }>
        groupIds: readonly string[]
        queryKey: string
      }
}))

vi.mock('@renderer/hooks/useCursorGroupWindows', () => ({
  useCursorGroupWindows: (options: NonNullable<typeof cursorGroupWindowMocks.options>) => {
    cursorGroupWindowMocks.options = options
    return {
      items: (sessionDataMocks.source as { sessions?: AgentSessionEntity[] } | null)?.sessions ?? [],
      loadGroup: vi.fn().mockResolvedValue(null),
      loadMoreGroup: vi.fn().mockResolvedValue(undefined),
      reset: vi.fn(),
      windows: {}
    }
  }
}))

vi.mock('@renderer/hooks/agent/useAgent', async (importOriginal) => ({
  // Keep the real useDeleteAgent so it registers its mutation (and refresh
  // contract) through the mocked useMutation below.
  ...(await importOriginal<typeof UseAgentModule>()),
  useAgents: agentDataMocks.useAgents
}))

vi.mock('@renderer/hooks/tab', () => ({
  useCloseConversationTabs: () => tabsContextMocks.closeConversationTabs,
  useOptionalTabsContext: () => tabsContextMocks,
  useCurrentTabId: () => null
}))

vi.mock('@renderer/hooks/useWindowFrame', () => ({
  useWindowFrame: () => ({ mode: windowFrameMocks.mode })
}))

vi.mock('@renderer/components/resourceCatalog/dialogs/edit', () => ({
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
  useMultiplePreferences: (keys: Record<string, string>) => [
    Object.fromEntries(Object.entries(keys).map(([name, key]) => [name, preferenceMocks.values.get(key)])),
    vi.fn()
  ]
}))

vi.mock('@renderer/pages/agents/messages/AgentSessionImageCaptureHost', () => {
  const React = require('react')
  return {
    default: (props: { modelFallback?: unknown; session: AgentSessionEntity }) => {
      agentSessionImageCaptureHostMocks.render(props)
      return React.createElement('div', {
        'data-testid': 'agent-session-image-capture-host',
        'data-session-id': props.session.id
      })
    }
  }
})

vi.mock('@renderer/hooks/useImageCaptureTargets', async () => {
  const actual = await vi.importActual<typeof ImageCaptureTargetsHook>('@renderer/hooks/useImageCaptureTargets')

  return {
    ...actual,
    useImageCaptureTargets: (options: Parameters<typeof actual.useImageCaptureTargets>[0]) => {
      const actualResult = actual.useImageCaptureTargets(options)

      return imageCaptureTargetsMock.targets
        ? { ...actualResult, targets: imageCaptureTargetsMock.targets as typeof actualResult.targets }
        : actualResult
    }
  }
})

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
  useMutation: vi.fn(
    (
      method: string,
      path: string,
      options?: { refresh?: Array<string | { path: string; strategy: 'reset-cursor' }> }
    ) => {
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
                  : method === 'DELETE' && path === '/agents/:agentId'
                    ? dataApiMocks.deleteAgent
                    : dataApiMocks.findOrCreateWorkspace,
        isLoading: false,
        error: undefined
      }
    }
  )
}))

vi.mock('@renderer/hooks/usePins', () => ({
  usePins: pinMocks.usePins,
  usePinMutations: pinMocks.usePinMutations
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
        'agent.add.title': 'Add Agent',
        'agent.session.display.agent': 'Agent',
        'agent.session.display.time': 'Time',
        'agent.session.display.title': 'Display mode',
        'agent.session.display.workdir': 'Work directory',
        'common.list_options': 'List options',
        'common.sort.created_at': 'Creation time',
        'common.sort.manual_order': 'Manual order',
        'common.sort.title': 'Sort order',
        'common.sort.updated_at': 'Updated time',
        'agent.session.empty.description': 'Tasks will appear here after you start one.',
        'agent.session.empty.title': 'No tasks',
        'agent.manage.title': 'Manage Agents',
        'agent.delete.content': 'Delete this agent and its tasks?',
        'agent.delete.error.failed': 'Failed to delete agent',
        'agent.delete.title': 'Delete Agent',
        'agent.edit.title': 'Edit Agent',
        'agent.icon.type': 'Agent icon',
        'agent.session.auto_rename': 'Generate task name',
        'agent.session.edit.title': 'Edit task name',
        'agent.session.file_manager.file_explorer': 'File Explorer',
        'agent.session.file_manager.files': 'Files',
        'agent.session.file_manager.finder': 'Finder',
        'agent.session.get.error.failed': 'Failed to get tasks',
        'agent.session.group.collapse': 'Collapse display',
        'agent.session.group.collapse_all': 'Collapse all',
        'agent.session.group.conversation': 'Conversations',
        'agent.session.group.drag_hint': 'Drag to reorder. Drag tasks to adjust display and hidden groups.',
        'agent.session.group.expand_all': 'Expand all',
        'agent.session.group.no_workdir': 'No work directory',
        'agent.session.group.show_more': 'Expand display',
        'agent.session.group.unknown_agent': 'Unknown agent',
        'agent.session.list.title': 'Tasks',
        'agent.session.new': 'New task',
        'agent.skill.manage.title': 'Manage skills',
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
        'chat.topics.copy.image': 'Copy as Image',
        'chat.topics.copy.md': 'Copy as Markdown',
        'chat.topics.copy.plain_text': 'Copy as Plain Text',
        'chat.topics.copy.title': 'Copy',
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
        'settings.agent.position.label': 'Session position',
        'settings.agent.position.left': 'Left',
        'settings.agent.position.right': 'Right',
        'settings.assistant.icon.type.emoji': 'Emoji',
        'settings.assistant.icon.type.model': 'Model',
        'settings.assistant.icon.type.none': 'None',
        'selector.agent.create_new': 'Create agent',
        'selector.agent.empty_text': 'No agents',
        'selector.agent.search_placeholder': 'Search agents',
        'selector.common.edit': 'Edit',
        'selector.common.pin': 'Pin',
        'selector.common.pinned_title': 'Pinned',
        'selector.common.sort.asc': 'Oldest first',
        'selector.common.sort.desc': 'Newest first',
        'selector.common.sort_label': 'Sort',
        'selector.common.unpin': 'Unpin'
      }
      return labels[key] ?? key
    }
  })
}))

import {
  SESSION_AGENT_SECTION_ID,
  SESSION_PINNED_SECTION_ID,
  SESSION_WORKDIR_SECTION_ID
} from '@renderer/utils/chat/sessionListHelpers'

import Sessions from '../Sessions'

const CURRENT_SESSION_ISO = new Date().toISOString()
const SESSION_EXPANSION_AGENT_KEY = 'ui.agent.session.expansion.agent'
const SESSION_EXPANSION_WORKDIR_KEY = 'ui.agent.session.expansion.workdir'

type SessionsForTestProps = Partial<ComponentProps<typeof Sessions>> & {
  activeSessionId?: string | null
  setActiveSessionId?: (id: string | null, session?: AgentSessionEntity | null) => void
}

function SessionsForTest({
  activeSessionId = cacheMocks.state.activeSessionId,
  agentSessionsSource = sessionDataMocks.source as ComponentProps<typeof Sessions>['agentSessionsSource'],
  setActiveSessionId = cacheMocks.setActiveSessionId,
  ...props
}: SessionsForTestProps) {
  return (
    <Sessions
      activeSessionId={activeSessionId ?? null}
      agentSessionsSource={agentSessionsSource}
      setActiveSessionId={setActiveSessionId}
      {...props}
    />
  )
}

function getHeaderNewTaskButton() {
  const button = screen
    .getAllByRole('button', { name: 'New task' })
    .find((candidate) => candidate.textContent?.includes('New task'))

  expect(button).toBeDefined()
  return button as HTMLButtonElement
}

type SessionGroupCollapseFixture = {
  agent: string[] | null
  workdir: string[] | null
}

// Default fixture: nothing collapsed (everything expanded).
function createExpandedSessionGroupExpansionFixture(): SessionGroupCollapseFixture {
  return {
    agent: [],
    workdir: []
  }
}

function setSessionGroupExpansionCache(value: SessionGroupCollapseFixture) {
  cacheMocks.values.set(SESSION_EXPANSION_AGENT_KEY, value.agent)
  cacheMocks.values.set(SESSION_EXPANSION_WORKDIR_KEY, value.workdir)
}

function getSessionGroupExpansionCache() {
  return {
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
    ...overrides,
    isNameManuallyEdited: overrides.isNameManuallyEdited ?? false
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
  fireEvent.click(screen.getByLabelText('List options'))
  return screen.getByText('Display mode').closest<HTMLElement>('[data-slot="dropdown-menu-content"]')
}

function setupSessions(overrides: Record<string, unknown> = {}) {
  const source = {
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
    loadFirstSession: vi.fn().mockResolvedValue(null),
    loadLatestSession: vi.fn().mockResolvedValue(null),
    reorderSession: sessionDataMocks.reorderSession,
    stats: sessionDataMocks.stats,
    togglePin: sessionDataMocks.togglePin,
    ...overrides
  }
  sessionDataMocks.source = source
  sessionDataMocks.useSessions.mockReturnValue(source)
  const sessions = source.sessions as AgentSessionEntity[]
  sessionDataMocks.stats = {
    total: sessions.length,
    pinnedCount: sessions.filter((session) => 'pinned' in session && session.pinned === true).length,
    byAgent: Array.from(new Set(sessions.map((session) => session.agentId))).map((agentId) => ({
      agentId,
      count: sessions.filter((session) => session.agentId === agentId).length,
      pinnedCount: 0
    })),
    byWorkspace: Array.from(
      new Set(sessions.map((session) => (session.workspace.type === 'system' ? 'system' : session.workspaceId)))
    ).map((workspaceId) => ({
      workspaceId,
      count: sessions.filter((session) =>
        workspaceId === 'system' ? session.workspace.type === 'system' : session.workspaceId === workspaceId
      ).length,
      pinnedCount: 0
    }))
  }
  source.stats = sessionDataMocks.stats
}

describe('Sessions', () => {
  beforeEach(() => {
    preferenceMocks.values.clear()
    cacheMocks.values.clear()
    imageCaptureTargetsMock.targets = undefined
    preferenceMocks.values.set('agent.session.display_mode', 'workdir')
    preferenceMocks.values.set('agent.session.sort_type', 'orderKey')
    preferenceMocks.values.set('agent.icon_type', 'emoji')
    preferenceMocks.values.set('agent.session.position', 'left')
    setSessionGroupExpansionCache(createExpandedSessionGroupExpansionFixture())
    preferenceMocks.values.set('topic.tab.show', true)
    cursorGroupWindowMocks.options = undefined
    dataApiMocks.workspaces = [
      makeWorkspace('/Users/jd/project-a', { id: 'ws-a', name: 'Project A Workspace', orderKey: 'a' }),
      makeWorkspace('/Users/jd/project-b', { id: 'ws-b', name: 'Project B Workspace', orderKey: 'b' })
    ]
    dataApiMocks.workspacesError = undefined
    dataApiMocks.workspacesLoading = false
    dataApiMocks.workspacesRefreshing = false
    dataApiMocks.deleteAgent.mockResolvedValue({ deleted: true, deletedSessionIds: [] })
    dataApiMocks.deleteWorkspace.mockResolvedValue({ deletedIds: [] })
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
      agents: [{ id: 'agent-a', model: 'provider-a::model-a', modelName: 'Model A', name: 'Alpha agent' }],
      isLoading: false,
      error: undefined,
      refetch: dataApiMocks.refetchAgents
    })
    vi.clearAllMocks()
    tabsContextMocks.openTab.mockClear()
    windowFrameMocks.mode = 'embedded'
  })

  afterEach(() => {
    dndMocks.droppableData.clear()
    dndMocks.sortableData.clear()
    virtualMocks.scrollToIndex.mockClear()
    vi.useRealTimers()
  })

  it('loads all sessions and renders collapsed workspace groups with drag in manual order', () => {
    setSessionGroupExpansionCache({
      ...createExpandedSessionGroupExpansionFixture(),
      // Collapse the workspace groups; sections stay expanded.
      workdir: ['session:workspace:ws-a', 'session:workspace:ws-b']
    })

    const view = render(<SessionsForTest />)

    expect(sessionDataMocks.useSessions).not.toHaveBeenCalled()
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

  it('defaults workspace display groups to collapsed before the user changes expansion', () => {
    setSessionGroupExpansionCache({
      ...createExpandedSessionGroupExpansionFixture(),
      workdir: null
    })

    render(<SessionsForTest />)

    expect(screen.getByRole('button', { name: 'Project A Workspace' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Alpha session')).not.toBeInTheDocument()
  })

  it('keeps the header new task action enabled without agents and shows missing-agent selection', () => {
    const onCreateSession = vi.fn()
    const onShowMissingAgentSelection = vi.fn()
    setupSessions({ sessions: [] })
    agentDataMocks.useAgents.mockReturnValue({
      agents: [],
      isLoading: false,
      error: undefined,
      refetch: dataApiMocks.refetchAgents
    })

    render(
      <SessionsForTest onCreateSession={onCreateSession} onShowMissingAgentSelection={onShowMissingAgentSelection} />
    )

    const newTaskButton = getHeaderNewTaskButton()
    expect(newTaskButton).not.toBeDisabled()

    fireEvent.click(newTaskButton)

    expect(onShowMissingAgentSelection).toHaveBeenCalledTimes(1)
    expect(onCreateSession).not.toHaveBeenCalled()
  })

  it('uses only the redesigned search control in right panel mode', () => {
    setupSessions()

    render(<SessionsForTest agentIdFilter="agent-a" presentation="right-panel" />)

    expect(screen.queryByText('New task')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('List options')).not.toBeInTheDocument()

    // Behavior: the right panel exposes the search control and drops the sidebar's new/display-mode
    // affordances. (Styling specifics intentionally not pinned here.)
    expect(screen.getByPlaceholderText('Search tasks')).toBeInTheDocument()
  })

  it('forces the flat time mode in the right panel even when the agent display mode is stored', () => {
    preferenceMocks.values.set('agent.session.display_mode', 'agent')
    setupSessions()

    render(<SessionsForTest agentIdFilter="agent-a" presentation="right-panel" />)

    // The classic right panel is the parent switch and forces the flat creation stream, so agent grouping is
    // never engaged and the agent pins query stays disabled. Reverting the `isRightPanel ? 'time' :`
    // force would flip displayMode back to the stored 'agent' and enable it.
    expect(pinMocks.usePins).toHaveBeenCalledWith('agent', { enabled: false })
    expect(pinMocks.usePins).not.toHaveBeenCalledWith('agent', { enabled: true })
  })

  it('shows every loaded session in the flat creation stream without group expansion controls', () => {
    preferenceMocks.values.set('agent.session.display_mode', 'time')
    setupSessions({
      sessions: Array.from({ length: 56 }, (_, index) =>
        createSession({
          id: `session-${index + 1}`,
          name: `Session ${index + 1}`,
          orderKey: String(index + 1).padStart(3, '0'),
          updatedAt: CURRENT_SESSION_ISO
        })
      )
    })

    render(<SessionsForTest />)

    expect(screen.getByText('Session 50')).toBeInTheDocument()
    expect(screen.getByText('Session 51')).toBeInTheDocument()
    expect(screen.getByText('Session 56')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Expand display' })).not.toBeInTheDocument()
  })

  it('requests separate pin-order and immutable creation-order streams in time mode', () => {
    preferenceMocks.values.set('agent.session.display_mode', 'time')
    preferenceMocks.values.set('agent.session.sort_type', 'createdAt')

    render(<SessionsForTest />)

    expect(sessionDataMocks.useSessions).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ pinned: true, pageSize: 50, enabled: true })
    )
    expect(sessionDataMocks.useSessions).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ pinned: false, sortBy: 'createdAt', pageSize: 50, enabled: true })
    )
  })

  it('keeps the pin-order stream independent when the session sort changes', () => {
    preferenceMocks.values.set('agent.session.display_mode', 'time')
    preferenceMocks.values.set('agent.session.sort_type', 'updatedAt')

    render(<SessionsForTest />)

    expect(sessionDataMocks.useSessions).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ pinned: true, pageSize: 50, enabled: true })
    )
    expect(sessionDataMocks.useSessions).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ pinned: false, sortBy: 'updatedAt', pageSize: 50, enabled: true })
    )
    const pinnedCall = sessionDataMocks.useSessions.mock.calls.find(([, options]) => options?.pinned === true)
    expect(pinnedCall?.[1]).not.toHaveProperty('sortBy')
  })

  it('passes session sorting to agent-group requests and cursor cache identity', async () => {
    preferenceMocks.values.set('agent.session.display_mode', 'agent')
    preferenceMocks.values.set('agent.session.sort_type', 'updatedAt')
    const getSpy = vi.spyOn(dataApiService, 'get').mockResolvedValue({ items: [] } as never)

    try {
      render(<SessionsForTest />)

      expect(JSON.parse(cursorGroupWindowMocks.options?.queryKey ?? '{}')).toEqual(
        expect.objectContaining({ mode: 'agent', sortBy: 'updatedAt' })
      )
      expect(JSON.parse(cursorGroupWindowMocks.options?.continuityKey ?? '{}')).toEqual({ mode: 'agent', q: '' })
      expect(cursorGroupWindowMocks.options?.groupIds).toContain('session:agent:agent-a')
      await cursorGroupWindowMocks.options?.fetchPage('session:agent:agent-a')
      expect(getSpy).toHaveBeenCalledWith(
        '/agent-sessions',
        expect.objectContaining({
          query: expect.objectContaining({ agentId: 'agent-a', pinned: false, sortBy: 'updatedAt' })
        })
      )
    } finally {
      getSpy.mockRestore()
    }
  })

  it('passes session sorting to work-directory group requests', async () => {
    preferenceMocks.values.set('agent.session.display_mode', 'workdir')
    preferenceMocks.values.set('agent.session.sort_type', 'createdAt')
    const getSpy = vi.spyOn(dataApiService, 'get').mockResolvedValue({ items: [] } as never)

    try {
      render(<SessionsForTest />)

      await cursorGroupWindowMocks.options?.fetchPage('session:workspace:ws-a')
      expect(getSpy).toHaveBeenCalledWith(
        '/agent-sessions',
        expect.objectContaining({
          query: expect.objectContaining({ workspaceId: 'ws-a', pinned: false, sortBy: 'createdAt' })
        })
      )
    } finally {
      getSpy.mockRestore()
    }
  })

  it('keeps a creation-stream retry available before any rows have loaded', async () => {
    preferenceMocks.values.set('agent.session.display_mode', 'time')
    sessionDataMocks.stats = { total: 0, pinnedCount: 0, byAgent: [], byWorkspace: [] }
    const retryCreatedSessions = vi.fn().mockResolvedValue(undefined)
    const baseSource = sessionDataMocks.source as Record<string, unknown>
    sessionDataMocks.useSessions.mockImplementation((_agentId, options) => {
      const pinned = (options as { pinned?: boolean }).pinned
      return {
        ...baseSource,
        sessions: [],
        error: pinned === false ? new Error('creation stream failed') : undefined,
        hasMore: false,
        reload: pinned === false ? retryCreatedSessions : vi.fn()
      }
    })

    render(<SessionsForTest />)

    const retryButton = screen.getByRole('button', { name: 'Expand display' })
    expect(retryButton).toHaveAttribute('data-error', 'true')

    fireEvent.click(retryButton)
    await vi.waitFor(() => expect(retryCreatedSessions).toHaveBeenCalledTimes(1))
  })

  it('retries the pinned stream before any rows have loaded instead of requesting a nonexistent next page', async () => {
    preferenceMocks.values.set('agent.session.display_mode', 'time')
    sessionDataMocks.stats = { total: 0, pinnedCount: 0, byAgent: [], byWorkspace: [] }
    const retryPinnedSessions = vi.fn().mockResolvedValue(undefined)
    const baseSource = sessionDataMocks.source as Record<string, unknown>
    sessionDataMocks.useSessions.mockImplementation((_agentId, options) => {
      const pinned = (options as { pinned?: boolean }).pinned
      return {
        ...baseSource,
        sessions: [],
        error: pinned === true ? new Error('pinned stream failed') : undefined,
        hasMore: false,
        reload: pinned === true ? retryPinnedSessions : vi.fn()
      }
    })

    render(<SessionsForTest />)

    const retryButton = screen.getByRole('button', { name: 'Expand display' })
    expect(retryButton).toHaveAttribute('data-error', 'true')

    fireEvent.click(retryButton)
    await vi.waitFor(() => expect(retryPinnedSessions).toHaveBeenCalledTimes(1))
  })

  it('creates a first-agent session from the header when there are agents but no sessions', async () => {
    const onCreateSession = vi.fn()
    const onShowMissingAgentSelection = vi.fn()
    setupSessions({ sessions: [] })

    render(
      <SessionsForTest onCreateSession={onCreateSession} onShowMissingAgentSelection={onShowMissingAgentSelection} />
    )

    fireEvent.click(getHeaderNewTaskButton())

    await vi.waitFor(() =>
      expect(onCreateSession).toHaveBeenCalledWith({
        agentId: 'agent-a',
        workspace: { type: 'system' }
      })
    )
    expect(onShowMissingAgentSelection).not.toHaveBeenCalled()
  })

  it('shows the empty task state without a creation action', () => {
    const onCreateSession = vi.fn()
    setupSessions({ sessions: [] })

    render(<SessionsForTest onCreateSession={onCreateSession} />)

    const emptyStateText = screen.getByText('No tasks')

    expect(emptyStateText).toHaveClass(
      'h-full',
      'w-full',
      'max-w-sm',
      'px-5',
      'py-10',
      'text-center',
      'text-xs',
      'text-muted-foreground',
      'break-words'
    )
    expect(screen.queryByRole('heading', { name: 'No tasks' })).not.toBeInTheDocument()
    expect(emptyStateText.querySelector('svg')).not.toBeInTheDocument()
    expect(screen.queryByText('Tasks will appear here after you start one.')).not.toBeInTheDocument()
    expect(getHeaderNewTaskButton()).toBeInTheDocument()
    expect(onCreateSession).not.toHaveBeenCalled()
  })

  it('uses the top header action to add an agent in agent display mode', () => {
    const onAddAgent = vi.fn()
    const onCreateSession = vi.fn()
    preferenceMocks.values.set('agent.session.display_mode', 'agent')
    setupSessions()

    render(<SessionsForTest onAddAgent={onAddAgent} onCreateSession={onCreateSession} />)

    fireEvent.click(screen.getByRole('button', { name: 'Add Agent' }))

    expect(onAddAgent).toHaveBeenCalledTimes(1)
    expect(onCreateSession).not.toHaveBeenCalled()
  })

  it('renders no-project sessions in a bottom no-project section', () => {
    const onCreateSession = vi.fn()
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

    render(<SessionsForTest onCreateSession={onCreateSession} />)

    const projectSection = screen.getByRole('button', { name: 'Work directory' })
    const noProjectSection = screen.getByRole('button', { name: 'No work directory' })
    expect(projectSection.compareDocumentPosition(noProjectSection) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByText('System session')).toBeInTheDocument()
    const systemSessionRow = screen.getByText('System session').closest('[role="option"]')
    expect(systemSessionRow?.querySelector('[data-resource-list-leading-slot="true"]') ?? null).not.toBeInTheDocument()

    const noProjectSectionHeader = noProjectSection.closest('[class*="group/resource-list-section"]')
    expect(noProjectSectionHeader).not.toBeNull()
    fireEvent.click(within(noProjectSectionHeader as HTMLElement).getByRole('button', { name: 'New task' }))

    expect(onCreateSession).toHaveBeenCalledWith({
      agentId: 'agent-a',
      workspace: { type: 'system' }
    })
  })

  it('does not reserve leading icon space for flat time-mode session rows', () => {
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

  it('defaults agent display groups to collapsed before the user changes expansion', () => {
    preferenceMocks.values.set('agent.session.display_mode', 'agent')
    setSessionGroupExpansionCache({
      ...createExpandedSessionGroupExpansionFixture(),
      agent: null
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

    render(<SessionsForTest />)

    expect(screen.getByRole('button', { name: 'Alpha agent' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('button', { name: 'Beta agent' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Alpha session')).not.toBeInTheDocument()
    expect(screen.queryByText('Beta session')).not.toBeInTheDocument()
  })

  it('uses the configured model icon for agent session groups', () => {
    preferenceMocks.values.set('agent.session.display_mode', 'agent')
    preferenceMocks.values.set('agent.icon_type', 'model')
    preferenceMocks.values.set('chat.default_model_id', 'provider-default::default-model')
    setSessionGroupExpansionCache({
      ...createExpandedSessionGroupExpansionFixture(),
      agent: ['session:agent:agent-a']
    })
    agentDataMocks.useAgents.mockReturnValue({
      agents: [
        {
          id: 'agent-a',
          model: 'provider-a::model-a',
          modelName: 'Model A',
          name: 'Alpha agent',
          configuration: { avatar: 'A' }
        }
      ],
      isLoading: false,
      error: undefined
    })
    setupSessions({
      sessions: [createSession({ id: 'session-a', name: 'Alpha session', agentId: 'agent-a', orderKey: 'a' })]
    })

    render(<SessionsForTest />)

    const agentHeader = screen.getByRole('button', { name: 'Alpha agent' }).closest('div')
    expect(agentHeader).toBeInTheDocument()
    expect(within(agentHeader as HTMLElement).getByTestId('model-avatar')).toHaveAttribute('data-model-id', 'model-a')
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
    expect(
      screen.getByRole('button', { name: /Alpha agent/ }).querySelector('[data-resource-list-leading-slot="true"]')
        ?.firstElementChild
    ).toHaveClass('rounded-full')
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

  it('clears session selection while a resource menu item is active', () => {
    cacheMocks.state.activeSessionId = 'session-a'
    const onSelectResourceView = vi.fn()
    setupSessions({
      sessions: [createSession({ id: 'session-a', name: 'Alpha session', orderKey: 'a' })]
    })

    render(
      <SessionsForTest
        resourceMenuItems={[
          {
            active: true,
            id: 'agent-resource-view',
            label: 'Agents',
            onSelect: onSelectResourceView
          }
        ]}
      />
    )

    expect(screen.queryByRole('button', { name: 'Manage Agents' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Display mode' }))
    fireEvent.click(screen.getByRole('button', { name: 'Manage Agents' }))
    expect(onSelectResourceView).toHaveBeenCalled()
    expect(screen.getByText('Alpha session').closest('[role="option"]')).not.toHaveAttribute('data-selected')
  })

  it('shows the skill resource menu entry with agent management in the display menu', () => {
    const onManageAgents = vi.fn()
    const onManageSkills = vi.fn()
    setupSessions({
      sessions: [createSession({ id: 'session-a', name: 'Alpha session', orderKey: 'a' })]
    })

    render(
      <SessionsForTest
        resourceMenuItems={[
          {
            id: 'agent-resource-view',
            label: 'Agents',
            onSelect: onManageAgents
          },
          {
            id: 'skill-resource-view',
            label: 'Skills',
            onSelect: onManageSkills
          }
        ]}
      />
    )

    expect(screen.queryByRole('button', { name: 'Manage skills' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Display mode' }))
    expect(screen.getByRole('button', { name: 'Manage Agents' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Manage skills' }))

    expect(onManageSkills).toHaveBeenCalledTimes(1)
    expect(onManageAgents).not.toHaveBeenCalled()
  })

  it('creates sessions from agent group actions', async () => {
    const onCreateSession = vi.fn()
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

    render(<SessionsForTest onCreateSession={onCreateSession} />)

    const betaGroup = screen.getByRole('button', { name: 'Beta agent' }).closest('div')
    expect(betaGroup).not.toBeNull()
    fireEvent.click(within(betaGroup as HTMLElement).getByRole('button', { name: 'New task' }))

    await vi.waitFor(() =>
      expect(onCreateSession).toHaveBeenCalledWith({
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

  it('renders the loaded group window without waiting for later pages', () => {
    preferenceMocks.values.set('agent.session.display_mode', 'workdir')
    setupSessions({
      sessions: [createSession({ id: 'session-first-page', name: 'First page session', agentId: 'agent-a' })],
      hasMore: true
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
    expect(screen.getByText('First page session')).toBeInTheDocument()
    expect(screen.queryAllByTestId('agent-session-row')).toHaveLength(1)
    expect(document.querySelectorAll('[data-resource-list-loading-item]')).toHaveLength(0)
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

  it('does not block the flat creation stream on workspace loading state', () => {
    preferenceMocks.values.set('agent.session.display_mode', 'time')
    setSessionGroupExpansionCache(createExpandedSessionGroupExpansionFixture())
    dataApiMocks.workspacesLoading = true
    dataApiMocks.workspacesError = new Error('Workspace request failed')

    render(<SessionsForTest />)

    expect(screen.getByText('Alpha session')).toBeInTheDocument()
    expect(screen.queryByText('Today')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('requests a new session from the header without creating inline', async () => {
    const onCreateSession = vi.fn()
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

    render(<SessionsForTest onCreateSession={onCreateSession} />)

    fireEvent.click(getHeaderNewTaskButton())

    expect(sessionDataMocks.createSession).not.toHaveBeenCalled()
    expect(onCreateSession).toHaveBeenCalledWith({
      agentId: 'agent-b',
      workspace: { type: 'user', workspaceId: 'ws-b' }
    })
    await vi.waitFor(() => expect(cacheMocks.setActiveSessionId).toHaveBeenCalledWith(null, null))
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
    const input = screen.getByLabelText('Edit task name')
    expect(input).toHaveFocus()
    fireEvent.change(input, { target: { value: 'Renamed session' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await vi.waitFor(() =>
      expect(sessionDataMocks.updateSession).toHaveBeenCalledWith(
        { id: 'session-a', name: 'Renamed session', isNameManuallyEdited: true },
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
    fireEvent.click(within(menuContent as HTMLElement).getByRole('menuitem', { name: 'Edit task name' }))

    expect(sessionDataMocks.updateSession).not.toHaveBeenCalled()

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('Edit task name')
    const input = within(dialog).getByLabelText('Name')
    expect(sessionDataMocks.updateSession).not.toHaveBeenCalled()

    fireEvent.change(input, { target: { value: 'Renamed from menu' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await vi.waitFor(() =>
      expect(sessionDataMocks.updateSession).toHaveBeenCalledWith(
        { id: 'session-a', name: 'Renamed from menu', isNameManuallyEdited: true },
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

  it('captures inactive session images offscreen without switching the active session', async () => {
    preferenceMocks.values.set('data.export.menus.image', true)
    const setActiveSessionId = vi.fn()

    render(<SessionsForTest activeSessionId="session-a" setActiveSessionId={setActiveSessionId} />)

    fireEvent.contextMenu(screen.getByText('Beta session'))
    const betaMenu = screen.getByText('Beta session').closest('[data-testid="context-menu"]')
    const menuContent = betaMenu?.querySelector('[data-testid="context-menu-content"]')

    fireEvent.click(within(menuContent as HTMLElement).getByRole('menuitem', { name: 'Copy as Image' }))

    expect(setActiveSessionId).not.toHaveBeenCalled()
    expect(await screen.findByTestId('agent-session-image-capture-host')).toHaveAttribute(
      'data-session-id',
      'session-b'
    )
    expect(agentSessionImageCaptureHostMocks.render).toHaveBeenCalledWith(
      expect.objectContaining({
        modelFallback: {
          id: 'model-a',
          name: 'Model A',
          provider: 'provider-a'
        },
        session: expect.objectContaining({ id: 'session-b' })
      })
    )
  })

  it('captures active session images offscreen without touching the visible message list', async () => {
    preferenceMocks.values.set('data.export.menus.image', true)
    const setActiveSessionId = vi.fn()

    render(<SessionsForTest activeSessionId="session-a" setActiveSessionId={setActiveSessionId} />)

    fireEvent.contextMenu(screen.getByText('Alpha session'))
    const alphaMenu = screen.getByText('Alpha session').closest('[data-testid="context-menu"]')
    const menuContent = alphaMenu?.querySelector('[data-testid="context-menu-content"]')

    fireEvent.click(within(menuContent as HTMLElement).getByRole('menuitem', { name: 'Copy as Image' }))

    expect(setActiveSessionId).not.toHaveBeenCalled()
    expect(await screen.findByTestId('agent-session-image-capture-host')).toHaveAttribute(
      'data-session-id',
      'session-a'
    )
    expect(agentSessionImageCaptureHostMocks.render).toHaveBeenCalledWith(
      expect.objectContaining({
        modelFallback: {
          id: 'model-a',
          name: 'Model A',
          provider: 'provider-a'
        },
        session: expect.objectContaining({ id: 'session-a' })
      })
    )
  })

  it('keeps separate capture hosts for repeated image requests on the same session', async () => {
    imageCaptureTargetsMock.targets = [
      {
        requestId: 1,
        target: createSession({ id: 'session-b', name: 'Beta session' })
      },
      {
        requestId: 2,
        target: createSession({ id: 'session-b', name: 'Beta session' })
      }
    ]

    render(<SessionsForTest activeSessionId="session-a" />)

    const hosts = screen.getAllByTestId('agent-session-image-capture-host')
    expect(hosts).toHaveLength(2)
    expect(hosts.map((host) => host.getAttribute('data-session-id'))).toEqual(['session-b', 'session-b'])
  })

  it('changes topic position from the session context menu', async () => {
    preferenceMocks.values.set('agent.session.display_mode', 'agent')
    render(<SessionsForTest />)

    fireEvent.contextMenu(screen.getByText('Alpha session'))
    const alphaMenu = screen.getByText('Alpha session').closest('[data-testid="context-menu"]')
    const menuContent = alphaMenu?.querySelector('[data-testid="context-menu-content"]')

    expect(menuContent).toHaveTextContent('Session position')

    fireEvent.click(within(menuContent as HTMLElement).getByText('Right'))

    await vi.waitFor(() => {
      expect(preferenceMocks.setPreference).toHaveBeenCalledWith('agent.session.position', 'right')
    })
  })

  it('hides session position actions when pane position is controlled without a setter', () => {
    preferenceMocks.values.set('agent.session.display_mode', 'agent')
    render(<SessionsForTest panePosition="left" />)

    fireEvent.contextMenu(screen.getByText('Alpha session'))
    const alphaMenu = screen.getByText('Alpha session').closest('[data-testid="context-menu"]')
    const menuContent = alphaMenu?.querySelector('[data-testid="context-menu-content"]')

    expect(menuContent ?? null).toBeInTheDocument()
    expect(menuContent).not.toHaveTextContent('Session position')
    expect(preferenceMocks.setPreference).not.toHaveBeenCalledWith('agent.session.position', expect.anything())
  })

  it('hides topic position actions from the workdir-mode session context menu', () => {
    preferenceMocks.values.set('agent.session.display_mode', 'workdir')
    render(<SessionsForTest />)

    fireEvent.contextMenu(screen.getByText('Alpha session'))
    const alphaMenu = screen.getByText('Alpha session').closest('[data-testid="context-menu"]')
    const menuContent = alphaMenu?.querySelector('[data-testid="context-menu-content"]')

    expect(menuContent ?? null).toBeInTheDocument()
    expect(menuContent).not.toHaveTextContent('Conversation position')
  })

  it('changes the right-panel session list to the left side from the context menu', async () => {
    const onSetPanePosition = vi.fn()
    render(
      <SessionsForTest
        agentIdFilter="agent-a"
        onSetPanePosition={onSetPanePosition}
        panePosition="right"
        presentation="right-panel"
      />
    )

    fireEvent.contextMenu(screen.getByText('Alpha session'))
    const alphaMenu = screen.getByText('Alpha session').closest('[data-testid="context-menu"]')
    const menuContent = alphaMenu?.querySelector('[data-testid="context-menu-content"]')

    expect(menuContent ?? null).toBeInTheDocument()
    const leftAction = within(menuContent as HTMLElement).getByRole('menuitem', { name: 'Left' })
    expect(leftAction).not.toBeDisabled()
    fireEvent.click(leftAction)

    await vi.waitFor(() => {
      expect(onSetPanePosition).toHaveBeenCalledWith('left')
    })
  })

  it('hides open-in-new-tab for the active session context menu', () => {
    render(<SessionsForTest />)

    fireEvent.contextMenu(screen.getByText('Alpha session'))
    const alphaMenu = screen.getByText('Alpha session').closest('[data-testid="context-menu"]')
    const menuContent = alphaMenu?.querySelector('[data-testid="context-menu-content"]')

    expect(menuContent).not.toHaveTextContent('Open in new tab')
  })

  it('hides open-in-new-tab but keeps open-in-new-window for inactive sessions in a detached window', () => {
    windowFrameMocks.mode = 'window'
    render(<SessionsForTest />)

    fireEvent.contextMenu(screen.getByText('Beta session'))
    const betaMenu = screen.getByText('Beta session').closest('[data-testid="context-menu"]')
    const menuContent = betaMenu?.querySelector('[data-testid="context-menu-content"]')

    expect(menuContent).not.toHaveTextContent('Open in new tab')
    expect(menuContent).toHaveTextContent('Open in New Window')
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

  it('selects the same agent neighbouring session after deleting the active session in the right panel', async () => {
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
        createSession({ id: 'session-a1-first', name: 'A1 First session', agentId: 'agent-a', orderKey: 'a' }),
        createSession({ id: 'session-a1-second', name: 'A1 Second session', agentId: 'agent-a', orderKey: 'b' }),
        createSession({ id: 'session-a2-first', name: 'A2 First session', agentId: 'agent-b', orderKey: 'c' })
      ]
    })
    const setActiveSessionId = vi.fn()

    render(
      <SessionsForTest
        agentIdFilter="agent-a"
        presentation="right-panel"
        activeSessionId="session-a1-second"
        setActiveSessionId={setActiveSessionId}
      />
    )

    const sessionRow = screen.getByText('A1 Second session').closest('[role="option"]')
    const deleteButton = within(sessionRow as HTMLElement).getByLabelText('Delete')
    act(() => {
      fireEvent.click(deleteButton)
    })
    act(() => {
      fireEvent.click(deleteButton)
    })

    await vi.waitFor(() => expect(sessionDataMocks.deleteSession).toHaveBeenCalledWith('session-a1-second'))
    await vi.waitFor(() =>
      expect(setActiveSessionId).toHaveBeenCalledWith(
        'session-a1-first',
        expect.objectContaining({ id: 'session-a1-first' })
      )
    )
    expect(setActiveSessionId).not.toHaveBeenCalledWith('session-a2-first', expect.anything())
  })

  it('selects the display-order neighbour (not the raw API head) after deleting the active sidebar session', async () => {
    preferenceMocks.values.set('agent.session.display_mode', 'agent')
    agentDataMocks.useAgents.mockReturnValue({
      agents: [{ id: 'agent-a', model: 'model-a', name: 'Alpha agent', configuration: { avatar: 'A' } }],
      isLoading: false,
      error: undefined
    })
    setupSessions({
      sessions: [
        createSession({ id: 'session-a', name: 'A session', agentId: 'agent-a', orderKey: 'a' }),
        createSession({ id: 'session-b', name: 'B session', agentId: 'agent-a', orderKey: 'b' }),
        createSession({ id: 'session-c', name: 'C session', agentId: 'agent-a', orderKey: 'c' })
      ]
    })
    const setActiveSessionId = vi.fn()

    // Modern sidebar (default presentation), deleting the middle session in display order.
    render(<SessionsForTest activeSessionId="session-b" setActiveSessionId={setActiveSessionId} />)

    const sessionRow = screen.getByText('B session').closest('[role="option"]')
    const deleteButton = within(sessionRow as HTMLElement).getByLabelText('Delete')
    act(() => {
      fireEvent.click(deleteButton)
    })
    act(() => {
      fireEvent.click(deleteButton)
    })

    await vi.waitFor(() => expect(sessionDataMocks.deleteSession).toHaveBeenCalledWith('session-b'))
    // Neighbour in the visible display order, not the raw API/orderKey head (session-a).
    await vi.waitFor(() =>
      expect(setActiveSessionId).toHaveBeenCalledWith('session-c', expect.objectContaining({ id: 'session-c' }))
    )
    expect(setActiveSessionId).not.toHaveBeenCalledWith('session-a', expect.anything())
  })

  it('selects the same-agent neighbour, not a cross-agent one, after deleting the active session in the modern sidebar', async () => {
    preferenceMocks.values.set('agent.session.display_mode', 'agent')
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
        createSession({ id: 'session-a1-first', name: 'A1 First session', agentId: 'agent-a', orderKey: 'a' }),
        createSession({ id: 'session-a1-second', name: 'A1 Second session', agentId: 'agent-a', orderKey: 'b' }),
        createSession({ id: 'session-a2-first', name: 'A2 First session', agentId: 'agent-b', orderKey: 'c' })
      ]
    })
    const setActiveSessionId = vi.fn()

    // Modern sidebar (default presentation): deleting the active session must stay inside its agent.
    render(<SessionsForTest activeSessionId="session-a1-second" setActiveSessionId={setActiveSessionId} />)

    const sessionRow = screen.getByText('A1 Second session').closest('[role="option"]')
    const deleteButton = within(sessionRow as HTMLElement).getByLabelText('Delete')
    act(() => {
      fireEvent.click(deleteButton)
    })
    act(() => {
      fireEvent.click(deleteButton)
    })

    await vi.waitFor(() => expect(sessionDataMocks.deleteSession).toHaveBeenCalledWith('session-a1-second'))
    await vi.waitFor(() =>
      expect(setActiveSessionId).toHaveBeenCalledWith(
        'session-a1-first',
        expect.objectContaining({ id: 'session-a1-first' })
      )
    )
    expect(setActiveSessionId).not.toHaveBeenCalledWith('session-a2-first', expect.anything())
  })

  it('creates an agent-scoped session, not a cross-agent jump, after deleting an agent last session in the modern sidebar', async () => {
    preferenceMocks.values.set('agent.session.display_mode', 'agent')
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
        createSession({
          id: 'session-a-only',
          name: 'A Only session',
          agentId: 'agent-a',
          orderKey: 'a',
          updatedAt: '2026-01-03T01:00:00.000Z'
        }),
        createSession({
          id: 'session-b-first',
          name: 'B First session',
          agentId: 'agent-b',
          orderKey: 'b',
          updatedAt: '2026-01-02T01:00:00.000Z'
        })
      ]
    })
    const onCreateSession = vi.fn()
    const setActiveSessionId = vi.fn()

    render(
      <SessionsForTest
        activeSessionId="session-a-only"
        onCreateSession={onCreateSession}
        setActiveSessionId={setActiveSessionId}
      />
    )

    const sessionRow = screen.getByText('A Only session').closest('[role="option"]')
    const deleteButton = within(sessionRow as HTMLElement).getByLabelText('Delete')
    act(() => {
      fireEvent.click(deleteButton)
    })
    act(() => {
      fireEvent.click(deleteButton)
    })

    await vi.waitFor(() => expect(sessionDataMocks.deleteSession).toHaveBeenCalledWith('session-a-only'))
    // The fresh replacement must exclude the just-deleted session from reuse, so a stale candidate
    // list can't reactivate the deleted id instead of creating a new session.
    await vi.waitFor(() =>
      expect(onCreateSession).toHaveBeenCalledWith(
        expect.objectContaining({ agentId: 'agent-a', excludeReuseSessionId: 'session-a-only' })
      )
    )
    expect(setActiveSessionId).not.toHaveBeenCalledWith('session-b-first', expect.anything())
  })

  it('creates an agent-scoped session after deleting the active agent last session in the right panel', async () => {
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
        createSession({
          id: 'session-a-only',
          name: 'A Only session',
          agentId: 'agent-a',
          orderKey: 'a',
          updatedAt: '2026-01-03T01:00:00.000Z'
        }),
        createSession({
          id: 'session-b-first',
          name: 'B First session',
          agentId: 'agent-b',
          orderKey: 'b',
          updatedAt: '2026-01-02T01:00:00.000Z'
        })
      ]
    })
    const onCreateSession = vi.fn()
    const setActiveSessionId = vi.fn()

    render(
      <SessionsForTest
        agentIdFilter="agent-a"
        presentation="right-panel"
        activeSessionId="session-a-only"
        onCreateSession={onCreateSession}
        setActiveSessionId={setActiveSessionId}
      />
    )

    const sessionRow = screen.getByText('A Only session').closest('[role="option"]')
    const deleteButton = within(sessionRow as HTMLElement).getByLabelText('Delete')
    act(() => {
      fireEvent.click(deleteButton)
    })
    act(() => {
      fireEvent.click(deleteButton)
    })

    await vi.waitFor(() => expect(sessionDataMocks.deleteSession).toHaveBeenCalledWith('session-a-only'))
    await vi.waitFor(() =>
      expect(onCreateSession).toHaveBeenCalledWith({
        agentId: 'agent-a',
        workspace: { type: 'user', workspaceId: 'ws-a' },
        // Excluded from reuse so the fresh replacement can't reactivate the just-deleted session.
        excludeReuseSessionId: 'session-a-only'
      })
    )
    expect(setActiveSessionId).not.toHaveBeenCalledWith('session-b-first', expect.anything())
  })

  it('clears the active session and toasts when the post-delete session create fails in the right panel', async () => {
    agentDataMocks.useAgents.mockReturnValue({
      agents: [{ id: 'agent-a', model: 'model-a', name: 'Alpha agent', configuration: { avatar: 'A' } }],
      isLoading: false,
      error: undefined
    })
    setupSessions({
      sessions: [
        createSession({
          id: 'session-a-only',
          name: 'A Only session',
          agentId: 'agent-a',
          orderKey: 'a',
          updatedAt: '2026-01-03T01:00:00.000Z'
        })
      ]
    })
    const onCreateSession = vi.fn().mockRejectedValue(new Error('workspace refetch failed'))
    const setActiveSessionId = vi.fn()

    render(
      <SessionsForTest
        agentIdFilter="agent-a"
        presentation="right-panel"
        activeSessionId="session-a-only"
        onCreateSession={onCreateSession}
        setActiveSessionId={setActiveSessionId}
      />
    )

    const sessionRow = screen.getByText('A Only session').closest('[role="option"]')
    const deleteButton = within(sessionRow as HTMLElement).getByLabelText('Delete')
    act(() => {
      fireEvent.click(deleteButton)
    })
    act(() => {
      fireEvent.click(deleteButton)
    })

    await vi.waitFor(() => expect(onCreateSession).toHaveBeenCalled())
    // The rejection must be surfaced and the active id cleared in `finally` so the view never
    // stays pointed at the just-deleted session.
    await vi.waitFor(() => expect(toast.error).toHaveBeenCalled())
    await vi.waitFor(() => expect(setActiveSessionId).toHaveBeenCalledWith(null, null))
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

  it('renders display and sort submenus before the existing session list actions', async () => {
    render(<SessionsForTest />)

    const optionsMenu = openSessionListOptions()
    expect(optionsMenu).not.toBeNull()
    const submenuTriggers = optionsMenu?.querySelectorAll('[data-slot="dropdown-menu-sub-trigger"]') ?? []
    expect(submenuTriggers[0]).toHaveTextContent('Display mode')
    expect(submenuTriggers[1]).toHaveTextContent('Sort order')
    expect(within(optionsMenu as HTMLElement).getByRole('menuitemradio', { name: 'Task' })).toBeInTheDocument()
    const selectedDisplayMode = within(optionsMenu as HTMLElement).getByRole('menuitemradio', {
      name: 'Work directory'
    })
    expect(selectedDisplayMode).toHaveAttribute('aria-checked', 'true')
    expect(selectedDisplayMode.querySelector('.lucide-check')).toBeInTheDocument()
    expect(
      within(optionsMenu as HTMLElement)
        .getByRole('menuitemradio', { name: 'Task' })
        .querySelector('.lucide-check')
    ).not.toBeInTheDocument()
    fireEvent.click(within(optionsMenu as HTMLElement).getByRole('menuitemradio', { name: 'Agent' }))

    await vi.waitFor(() => {
      expect(preferenceMocks.setPreference).toHaveBeenCalledWith('agent.session.display_mode', 'agent')
    })
  })

  it('persists the selected session sort independently from display mode', async () => {
    render(<SessionsForTest />)

    const optionsMenu = openSessionListOptions()
    expect(optionsMenu).not.toBeNull()
    const selectedSort = within(optionsMenu as HTMLElement).getByRole('menuitemradio', { name: 'Manual order' })
    expect(selectedSort).toHaveAttribute('aria-checked', 'true')
    expect(selectedSort.querySelector('.lucide-check')).toBeInTheDocument()
    fireEvent.click(within(optionsMenu as HTMLElement).getByRole('menuitemradio', { name: 'Updated time' }))

    await vi.waitFor(() => {
      expect(preferenceMocks.setPreference).toHaveBeenCalledWith('agent.session.sort_type', 'updatedAt')
      expect(preferenceMocks.values.get('agent.session.display_mode')).toBe('workdir')
    })
  })

  it('keeps workspace group drag but disables session item drag for timestamp sorting', () => {
    preferenceMocks.values.set('agent.session.display_mode', 'workdir')
    preferenceMocks.values.set('agent.session.sort_type', 'updatedAt')

    render(<SessionsForTest />)

    expect(dndMocks.sortableData.has('group:session:workspace:ws-a')).toBe(true)
    expect(dndMocks.sortableData.has('item:session-a')).toBe(false)
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
    expect(dataApiMocks.refetchAgents).not.toHaveBeenCalled()
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
    expect(toast.success).toHaveBeenCalledWith('Saved')
  })

  it('deletes a workspace group through the workspace delete endpoint', async () => {
    const callOrder: string[] = []
    dataApiMocks.deleteWorkspace.mockImplementationOnce(async () => {
      callOrder.push('workspace')
      return { deletedIds: ['session-a'] }
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
    expect(popup.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'Deleting this work directory also deletes tasks under it. The actual folder is not deleted.'
      })
    )
    expect(dataApiMocks.mutationOptions.get('DELETE /agent-workspaces/:workspaceId')?.refresh).toEqual([
      { path: '/agent-sessions', strategy: 'reset-cursor' },
      '/agent-sessions/stats',
      '/agent-workspaces',
      '/pins',
      '/agent-channels'
    ])
    expect(sessionDataMocks.deleteSession).not.toHaveBeenCalled()
    expect(callOrder).toEqual(['workspace'])
    expect(tabsContextMocks.closeConversationTabs).toHaveBeenCalledWith('agents', ['session-a'])
    expect(cacheMocks.setActiveSessionId).toHaveBeenCalledWith(
      'session-pinned',
      expect.objectContaining({ id: 'session-pinned' })
    )
    expect(dataApiMocks.refetchWorkspaces).not.toHaveBeenCalled()
    expect(sessionDataMocks.reload).not.toHaveBeenCalled()
  })

  it('creates sessions from workspace group actions', async () => {
    const onCreateSession = vi.fn()
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
    render(<SessionsForTest onCreateSession={onCreateSession} />)

    const workdirGroup = screen.getByRole('button', { name: 'Project A Workspace' }).closest('div')
    expect(workdirGroup).not.toBeNull()
    fireEvent.click(within(workdirGroup as HTMLElement).getByRole('button', { name: 'New task' }))

    await vi.waitFor(() =>
      expect(onCreateSession).toHaveBeenCalledWith({
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
    expect(within(agentGroup as HTMLElement).getByRole('button', { name: 'New task' })).toBeInTheDocument()

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
    expect(dataApiMocks.refetchAgents).not.toHaveBeenCalled()

    fireEvent.pointerDown(moreButton)
    const iconMenuItem = screen
      .getAllByRole('menuitem', { name: 'Agent icon' })
      .find((button) => button.getAttribute('data-slot') === 'dropdown-menu-sub-trigger')
    expect(iconMenuItem).toBeDefined()
    const modelIconMenuItem = screen
      .getAllByRole('menuitem', { name: 'Model' })
      .find((button) => button.getAttribute('data-slot') === 'dropdown-menu-item')
    expect(modelIconMenuItem).toBeDefined()
    fireEvent.click(modelIconMenuItem as HTMLElement)

    await vi.waitFor(() => expect(preferenceMocks.setPreference).toHaveBeenCalledWith('agent.icon_type', 'model'))
  })

  it('deletes an agent from the agent group menu', async () => {
    const onActiveAgentDeleted = vi.fn()
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

    render(<SessionsForTest onActiveAgentDeleted={onActiveAgentDeleted} />)

    const agentGroup = screen.getByRole('button', { name: 'Alpha agent' }).closest('div')
    expect(agentGroup).not.toBeNull()
    fireEvent.pointerDown(within(agentGroup as HTMLElement).getByRole('button', { name: 'More' }))
    expect(screen.queryByRole('menuitem', { name: 'Delete agent tasks' })).not.toBeInTheDocument()
    const deleteAgentMenuItem = screen
      .getAllByRole('menuitem', { name: 'Delete Agent' })
      .find((button) => button.getAttribute('data-slot') === 'dropdown-menu-item')
    expect(deleteAgentMenuItem).toBeDefined()
    expect(deleteAgentMenuItem?.querySelector('svg')).toHaveClass('lucide-custom', 'text-destructive')

    dataApiMocks.deleteAgent.mockResolvedValueOnce({ deleted: true, deletedSessionIds: ['session-a'] })

    fireEvent.click(deleteAgentMenuItem as HTMLElement)

    await vi.waitFor(() =>
      expect(dataApiMocks.deleteAgent).toHaveBeenCalledWith({
        params: { agentId: 'agent-a' },
        query: { deleteSessions: true }
      })
    )
    expect(popup.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'Delete this agent and its tasks?',
        title: 'Delete Agent'
      })
    )
    expect(onActiveAgentDeleted).toHaveBeenCalledWith('agent-a')
    expect(dataApiMocks.mutationOptions.get('DELETE /agents/:agentId')?.refresh).toEqual([
      '/agents',
      { path: '/agent-sessions', strategy: 'reset-cursor' },
      '/agent-sessions/stats',
      '/agent-workspaces',
      '/pins',
      '/agent-channels'
    ])
    expect(sessionDataMocks.deleteSession).not.toHaveBeenCalled()
    expect(tabsContextMocks.closeConversationTabs).toHaveBeenCalledWith('agents', ['session-a'])
    expect(dataApiMocks.refetchAgents).not.toHaveBeenCalled()
    expect(sessionDataMocks.reload).not.toHaveBeenCalled()
    expect(toast.success).toHaveBeenCalledWith('Deleted successfully')
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
