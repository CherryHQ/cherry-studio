import type * as DndKitUtilities from '@dnd-kit/utilities'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { Activity, type ComponentProps, type ReactNode } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'
import type * as ImageCaptureTargetsHook from '@renderer/hooks/useImageCaptureTargets'
import { popup } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'
import type { TopicStreamStatus } from '@shared/ai/transport'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import { AGENT_WORKSPACE_TYPE, type AgentWorkspaceEntity } from '@shared/data/api/schemas/agentWorkspaces'

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
        setActivatorNodeRef: vi.fn(),
        setNodeRef: vi.fn(),
        transform: null,
        transition: undefined,
        isDragging: false
      }
    },
    verticalListSortingStrategy: {}
  }
})

vi.mock('@dnd-kit/utilities', async (importOriginal) => ({
  ...(await importOriginal<typeof DndKitUtilities>()),
  CSS: {
    Transform: {
      toString: () => undefined
    }
  }
}))

const sessionDataMocks = vi.hoisted(() => ({
  createSession: vi.fn().mockResolvedValue({ id: 'created-session' }),
  deleteSession: vi.fn().mockResolvedValue(true),
  deleteSessions: vi.fn().mockResolvedValue({ deletedIds: [] as string[] }),
  reload: vi.fn().mockResolvedValue(undefined),
  reorderSession: vi.fn().mockResolvedValue(true),
  source: null as unknown,
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

const fileNavigationMocks = vi.hoisted(() => ({
  request: null as null | ((transition: () => void) => void)
}))

vi.mock('../AgentRightPane', () => ({
  useOptionalAgentFileNavigation: () => fileNavigationMocks.request
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
  deleteAgentSessions: vi.fn().mockResolvedValue({ deletedIds: [] as string[] }),
  deleteWorkspace: vi.fn().mockResolvedValue({ deletedIds: [] as string[] }),
  invalidate: vi.fn().mockResolvedValue(undefined),
  ipcRequest: vi.fn(),
  findOrCreateWorkspace: vi.fn(async ({ body }: { body: { path: string } }) => {
    const workspace = dataApiMocks.workspaces.find((candidate) => candidate.path === body.path)
    return workspace ?? { id: 'ws-test', name: 'Test Workspace', path: body.path }
  }),
  refetchWorkspaces: vi.fn().mockResolvedValue(undefined),
  refetchAgents: vi.fn().mockResolvedValue(undefined),
  reorderAgent: vi.fn().mockResolvedValue(undefined),
  reorderWorkspace: vi.fn().mockResolvedValue(undefined),
  updateWorkspace: vi.fn().mockResolvedValue(undefined),
  useQuery: vi.fn(),
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
    awaitingApprovalAnchors: [],
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

const agentSessionExportMocks = vi.hoisted(() => ({
  copyAgentSessionAsMarkdown: vi.fn().mockResolvedValue(undefined),
  moduleLoads: 0
}))

vi.mock('@renderer/services/agentSessionExport', () => {
  agentSessionExportMocks.moduleLoads += 1

  return {
    agentSessionToMarkdown: vi.fn().mockResolvedValue('markdown'),
    copyAgentSessionAsMarkdown: agentSessionExportMocks.copyAgentSessionAsMarkdown,
    copyAgentSessionAsPlainText: vi.fn().mockResolvedValue(undefined),
    exportAgentSessionAsMarkdown: vi.fn().mockResolvedValue(undefined),
    getAgentSessionExportTitle: vi.fn((session: AgentSessionEntity) => session.name),
    getAgentSessionMessagesForExport: vi.fn().mockResolvedValue([])
  }
})

const createTopicStreamStatusMock = (
  overrides: {
    awaitingApprovalAnchors?: Array<{ executionId: string; anchorMessageId?: string }>
    isFulfilled?: boolean
    isPending?: boolean
    status?: TopicStreamStatus
  } = {}
) => ({
  activeExecutions: [],
  awaitingApprovalAnchors: overrides.awaitingApprovalAnchors ?? [],
  isFulfilled: overrides.isFulfilled ?? false,
  isPending: overrides.isPending ?? false,
  markSeen: vi.fn(),
  status: overrides.status
})

vi.mock('@renderer/hooks/agent/useSession', () => ({
  useSessions: sessionDataMocks.useSessions,
  useUpdateSession: sessionDataMocks.useUpdateSession
}))

vi.mock('@renderer/hooks/agent/useAgent', () => ({
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
      return Promise.resolve()
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
  useInvalidateCache: () => dataApiMocks.invalidate,
  useQuery: vi.fn((path: string, options?: { enabled?: boolean }) => {
    dataApiMocks.useQuery(path, options)
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
                : method === 'DELETE' && path === '/agents/:agentId'
                  ? dataApiMocks.deleteAgent
                  : method === 'DELETE' && path === '/agents/:agentId/sessions'
                    ? dataApiMocks.deleteAgentSessions
                    : dataApiMocks.findOrCreateWorkspace,
      isLoading: false,
      error: undefined
    }
  })
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: {
    request: dataApiMocks.ipcRequest,
    on: vi.fn(() => () => undefined)
  }
}))

vi.mock('@renderer/hooks/usePins', () => ({
  usePins: pinMocks.usePins
}))

vi.mock('@renderer/utils/agentSession', () => ({
  buildAgentFileWorkspaceKey: (workspaceId?: string | null, workspacePath?: string) =>
    `${workspaceId ?? ''}\0${workspacePath ?? ''}`,
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
        'agent.session.empty.description': 'Tasks will appear here after you start one.',
        'agent.session.empty.title': 'No tasks',
        'agent.manage.title': 'Manage Agents',
        'agent.delete.content': 'Delete this agent and its tasks?',
        'agent.delete.error.failed': 'Failed to delete agent',
        'agent.delete.title': 'Delete Agent',
        'launchpad.pin_to_sidebar': 'Add to sidebar',
        'launchpad.unpin_from_sidebar': 'Remove from sidebar',
        'agent.session.agent.delete.content': 'Delete all tasks for this agent. The agent itself will not be deleted.',
        'agent.session.agent.delete.title': 'Delete agent tasks',
        'agent.session.agent.delete.trigger': 'Delete agent tasks',
        'agent.edit.title': 'Edit Agent',
        'agent.icon.type': 'Agent icon',
        'agent.session.auto_rename': 'Generate task name',
        'agent.toolPermission.pending': 'Waiting for confirmation',
        'agent.toolPermission.pendingBadge': 'Pending',
        'agent.session.edit.title': 'Edit task name',
        'agent.session.file_manager.file_explorer': 'File Explorer',
        'agent.session.file_manager.files': 'Files',
        'agent.session.file_manager.finder': 'Finder',
        'agent.session.get.error.failed': 'Failed to get tasks',
        'agent.session.group.collapse': 'Collapse display',
        'agent.session.group.collapse_all': 'Collapse all',
        'agent.session.group.conversation': 'Conversations',
        'agent.session.group.earlier': 'Earlier',
        'agent.session.group.expand_all': 'Expand all',
        'agent.session.group.no_workdir': 'No work directory',
        'agent.session.group.show_more': 'Expand display',
        'agent.session.group.tasks': 'Tasks',
        'agent.session.group.this_week': 'This week',
        'agent.session.group.today': 'Today',
        'agent.session.group.unknown_agent': 'Unlinked Agent',
        'agent.session.group.unknown_agent_tip': 'Historical sessions without an agent',
        'agent.session.group.yesterday': 'Yesterday',
        'agent.session.list.title': 'Tasks',
        'agent.session.new': 'New task',
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
        'message.tools.status.done': 'Done',
        'message.tools.status.error': 'Error',
        'message.tools.status.running': 'Running',
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
// Time groups only label themselves when the list spans more than one bucket, so fixtures that
// assert on a bucket header need something older to contrast with.
const EARLIER_SESSION_ISO = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
const SESSION_EXPANSION_TIME_KEY = 'ui.agent.session.expansion.time'
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
  time: string[]
  agent: string[] | null
  workdir: string[] | null
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
    ...overrides,
    lastActivityAt: overrides.lastActivityAt ?? overrides.updatedAt ?? CURRENT_SESSION_ISO,
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
  fireEvent.click(screen.getByLabelText('Display mode'))
  const title = screen.getByText('Display mode')
  return title.closest('[data-radix-popper-content-wrapper]') ?? title.parentElement
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
    deleteSessions: sessionDataMocks.deleteSessions,
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
  }
  sessionDataMocks.source = source
  sessionDataMocks.useSessions.mockReturnValue(source)
}

/**
 * An entity group header (agent / assistant) switches away when clicked, so its fold control is a
 * separate button beside the label and `aria-expanded` lives there. Bucket headers (workdir, time
 * ranges, pinned) still toggle as one row and keep the attribute on the header button itself.
 */
function groupChevron(groupHeaderButton: HTMLElement): HTMLElement {
  const chevron = groupHeaderButton.parentElement?.querySelector(':scope > button[aria-expanded]')
  if (!chevron) throw new Error('group header has no chevron button')
  return chevron as HTMLElement
}

describe('Sessions', () => {
  beforeEach(() => {
    preferenceMocks.values.clear()
    cacheMocks.values.clear()
    imageCaptureTargetsMock.targets = undefined
    preferenceMocks.values.set('agent.session.display_mode', 'workdir')
    preferenceMocks.values.set('agent.icon_type', 'emoji')
    preferenceMocks.values.set('agent.session.position', 'left')
    setSessionGroupExpansionCache(createExpandedSessionGroupExpansionFixture())
    preferenceMocks.values.set('topic.tab.show', true)
    dataApiMocks.workspaces = [
      makeWorkspace('/Users/jd/project-a', { id: 'ws-a', name: 'Project A Workspace', orderKey: 'a' }),
      makeWorkspace('/Users/jd/project-b', { id: 'ws-b', name: 'Project B Workspace', orderKey: 'b' })
    ]
    dataApiMocks.workspacesError = undefined
    dataApiMocks.workspacesLoading = false
    dataApiMocks.workspacesRefreshing = false
    dataApiMocks.deleteAgent.mockResolvedValue({ deleted: true, deletedSessionIds: [] })
    dataApiMocks.deleteAgentSessions.mockResolvedValue({ deletedIds: [] })
    dataApiMocks.deleteWorkspace.mockResolvedValue({ deletedIds: [] })
    dataApiMocks.refetchAgents.mockResolvedValue(undefined)
    dataApiMocks.reorderAgent.mockResolvedValue(undefined)
    dataApiMocks.updateWorkspace.mockResolvedValue(undefined)
    dataApiMocks.mutationOptions.clear()
    sessionDataMocks.deleteSession.mockResolvedValue(true)
    sessionDataMocks.deleteSessions.mockResolvedValue({ deletedIds: [] })
    Object.assign(window, {
      api: {
        file: {
          openPath: vi.fn().mockResolvedValue(undefined)
        }
      }
    })
    cacheMocks.state.activeSessionId = 'session-a'
    fileNavigationMocks.request = null
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
    dataApiMocks.invalidate.mockResolvedValue(undefined)
    dataApiMocks.ipcRequest.mockImplementation((route: string, input: Record<string, unknown>) => {
      if (route === 'ai.agent.delete') {
        return dataApiMocks.deleteAgent({
          params: { agentId: input.agentId },
          query: { deleteSessions: input.deleteSessions }
        })
      }
      if (route === 'ai.agent.sessions.delete') {
        return dataApiMocks.deleteAgentSessions({ params: { agentId: input.agentId } })
      }
      if (route === 'ai.agent.workspace.delete') {
        return dataApiMocks.deleteWorkspace({ params: { workspaceId: input.workspaceId } })
      }
      return Promise.resolve(undefined)
    })
    tabsContextMocks.openTab.mockClear()
    windowFrameMocks.mode = 'embedded'
  })

  it('loads agent session export code only when an export action runs', async () => {
    expect(agentSessionExportMocks.moduleLoads).toBe(0)

    render(<SessionsForTest />)

    const sessionRow = screen.getByText('Alpha session').closest('[role="option"]')
    expect(sessionRow).not.toBeNull()
    fireEvent.contextMenu(sessionRow as HTMLElement)

    const copyMarkdownItem = screen
      .getAllByRole('menuitem', { name: 'Copy as Markdown' })
      .find((item) => item.getAttribute('data-slot') !== 'dropdown-menu-item')
    expect(copyMarkdownItem).toBeDefined()
    fireEvent.click(copyMarkdownItem as HTMLElement)

    await vi.waitFor(() => {
      expect(agentSessionExportMocks.moduleLoads).toBe(1)
      expect(agentSessionExportMocks.copyAgentSessionAsMarkdown).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'session-a' }),
        expect.any(Object)
      )
    })
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

    expect(sessionDataMocks.useSessions).not.toHaveBeenCalled()
    expect(screen.getByTestId('resource-list-session')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Search tasks')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Project A Workspace' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: 'project-a' })).not.toBeInTheDocument()
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
  })

  it('never paints a workdir group as selected, collapsed or not', () => {
    cacheMocks.state.activeSessionId = 'session-a'
    setSessionGroupExpansionCache({
      ...createExpandedSessionGroupExpansionFixture(),
      workdir: ['session:workspace:ws-a']
    })

    const view = render(<SessionsForTest />)

    // A folder holds sessions from any agent — "which folder am I in" isn't a state the user tracks,
    // so the header stays plain even while it hides the open session.
    const collapsedGroup = screen.getByRole('button', { name: 'Project A Workspace' })
    expect(collapsedGroup).toHaveAttribute('aria-expanded', 'false')
    expect(collapsedGroup.parentElement).not.toHaveClass('bg-resource-list-row-selected')
    expect(collapsedGroup).not.toHaveAttribute('aria-current')

    setSessionGroupExpansionCache(createExpandedSessionGroupExpansionFixture())
    view.rerender(<SessionsForTest key="expanded-workdir" />)
    const expandedGroup = screen.getByRole('button', { name: 'Project A Workspace' })
    expect(expandedGroup).toHaveAttribute('aria-expanded', 'true')
    expect(expandedGroup.parentElement).not.toHaveClass('bg-resource-list-row-selected')
  })

  it('keeps channel and agent-pin reads inactive while the navigation pane is closed', () => {
    preferenceMocks.values.set('agent.session.display_mode', 'agent')

    render(<SessionsForTest dataEnabled={false} />)

    expect(dataApiMocks.useQuery).toHaveBeenCalledWith('/agent-channels', { enabled: false })
    expect(pinMocks.usePins).toHaveBeenCalledWith('agent', { enabled: false })
  })

  it('keeps the sortable session list mounted and preserves scroll position during refresh', () => {
    const view = render(<SessionsForTest />)
    const listbox = screen.getByRole('listbox')
    listbox.scrollTop = 640

    setupSessions({ isValidating: true })
    view.rerender(<SessionsForTest />)

    expect(screen.getByTestId('dnd-context')).toBeInTheDocument()
    expect(screen.getByRole('listbox')).toBe(listbox)
    expect(listbox.scrollTop).toBe(640)
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

  it('passes the header creation defaults through when there are no agents', () => {
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

    expect(onCreateSession).toHaveBeenCalledWith({
      agentId: null,
      workspace: { type: 'system' }
    })
    expect(onShowMissingAgentSelection).not.toHaveBeenCalled()
  })

  it('uses only the redesigned search control in right panel mode', () => {
    setupSessions()

    render(<SessionsForTest agentIdFilter="agent-a" presentation="right-panel" />)

    expect(screen.queryByText('New task')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Display mode')).not.toBeInTheDocument()

    // Behavior: the right panel exposes the search control and drops the sidebar's new/display-mode
    // affordances. (Styling specifics intentionally not pinned here.)
    expect(screen.getByPlaceholderText('Search tasks')).toBeInTheDocument()
  })

  it('forces time grouping in the right panel even when the agent display mode is stored', () => {
    preferenceMocks.values.set('agent.session.display_mode', 'agent')
    setupSessions()

    render(<SessionsForTest agentIdFilter="agent-a" presentation="right-panel" />)

    // The classic right panel is the parent switch and forces time grouping, so agent grouping is
    // never engaged and the agent pins query stays disabled. Reverting the `isRightPanel ? 'time' :`
    // force would flip displayMode back to the stored 'agent' and enable it.
    expect(pinMocks.usePins).toHaveBeenCalledWith('agent', { enabled: false })
    expect(pinMocks.usePins).not.toHaveBeenCalledWith('agent', { enabled: true })
  })

  it('keeps right-panel group expansion across an <Activity> hide/show and resets it when the agent filter changes', () => {
    // Two agents, each with a today + an earlier session, so the time buckets
    // render headers under either filter.
    setupSessions({
      sessions: [
        createSession({ id: 'session-a', name: 'Alpha session', orderKey: 'a' }),
        createSession({ id: 'session-a-old', name: 'Alpha older', orderKey: 'b', updatedAt: EARLIER_SESSION_ISO }),
        createSession({ agentId: 'agent-b', id: 'session-b', name: 'Beta session', orderKey: 'c' }),
        createSession({
          agentId: 'agent-b',
          id: 'session-b-old',
          name: 'Beta older',
          orderKey: 'd',
          updatedAt: EARLIER_SESSION_ISO
        })
      ]
    })

    const view = render(
      <Activity mode="visible">
        <SessionsForTest agentIdFilter="agent-a" presentation="right-panel" />
      </Activity>
    )

    fireEvent.click(screen.getByRole('button', { name: 'Today' }))
    expect(screen.getByRole('button', { name: 'Today' })).toHaveAttribute('aria-expanded', 'false')

    // Tab switch (hidden→visible with the same filter): effects re-run but the
    // user's collapsed state must survive.
    view.rerender(
      <Activity mode="hidden">
        <SessionsForTest agentIdFilter="agent-a" presentation="right-panel" />
      </Activity>
    )
    view.rerender(
      <Activity mode="visible">
        <SessionsForTest agentIdFilter="agent-a" presentation="right-panel" />
      </Activity>
    )
    expect(screen.getByRole('button', { name: 'Today' })).toHaveAttribute('aria-expanded', 'false')

    // Actual filter change: the stale per-agent collapsed state must reset.
    view.rerender(
      <Activity mode="visible">
        <SessionsForTest agentIdFilter="agent-b" presentation="right-panel" />
      </Activity>
    )
    expect(screen.getByRole('button', { name: 'Today' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('shows fifty sessions in left-panel time groups and loads five more per expansion', () => {
    preferenceMocks.values.set('agent.session.display_mode', 'time')
    setupSessions({
      sessions: [
        ...Array.from({ length: 56 }, (_, index) =>
          createSession({
            id: `session-${index + 1}`,
            name: `Session ${index + 1}`,
            orderKey: String(index + 1).padStart(3, '0'),
            updatedAt: CURRENT_SESSION_ISO
          })
        ),
        createSession({ id: 'session-old', name: 'Older session', orderKey: 'zzz', updatedAt: EARLIER_SESSION_ISO })
      ]
    })

    render(<SessionsForTest />)

    expect(screen.getByText('Today')).toBeInTheDocument()
    expect(screen.getByText('Session 50')).toBeInTheDocument()
    expect(screen.queryByText('Session 51')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Expand display' }))

    expect(screen.getByText('Session 55')).toBeInTheDocument()
    expect(screen.queryByText('Session 56')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Expand display' }))

    expect(screen.getByText('Session 56')).toBeInTheDocument()
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

    const emptyStateTexts = screen.getAllByText('No tasks')

    expect(emptyStateTexts).toHaveLength(2)
    expect(screen.queryByRole('heading', { name: 'No tasks' })).not.toBeInTheDocument()
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
    const noProjectSection = screen.getByRole('button', { name: 'Tasks' })
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

  it('creates a task in a work directory that does not have tasks', async () => {
    const onCreateSession = vi.fn()
    dataApiMocks.workspaces = [
      makeWorkspace('/Users/jd/project-a', { id: 'ws-a', name: 'Project A Workspace', orderKey: 'a' }),
      makeWorkspace('/Users/jd/project-empty', { id: 'ws-empty', name: 'Empty Workspace', orderKey: 'c' })
    ]

    render(<SessionsForTest onCreateSession={onCreateSession} />)

    const emptyWorkspaceGroup = screen.getByRole('button', { name: 'Empty Workspace' }).closest('div')
    expect(emptyWorkspaceGroup).not.toBeNull()
    expect(screen.getByText('No tasks')).toBeInTheDocument()
    fireEvent.click(within(emptyWorkspaceGroup as HTMLElement).getByRole('button', { name: 'New task' }))

    await vi.waitFor(() =>
      expect(onCreateSession).toHaveBeenCalledWith({
        agentId: 'agent-a',
        workspace: { type: 'user', workspaceId: 'ws-empty' }
      })
    )
  })

  it('passes an empty work directory to session creation when there are no agents', async () => {
    const onCreateSession = vi.fn()
    const onShowMissingAgentSelection = vi.fn()
    dataApiMocks.workspaces = [
      makeWorkspace('/Users/jd/project-empty', { id: 'ws-empty', name: 'Empty Workspace', orderKey: 'a' })
    ]
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

    const emptyWorkspaceGroup = screen.getByRole('button', { name: 'Empty Workspace' }).closest('div')
    expect(emptyWorkspaceGroup).not.toBeNull()
    fireEvent.click(within(emptyWorkspaceGroup as HTMLElement).getByRole('button', { name: 'New task' }))

    await vi.waitFor(() =>
      expect(onCreateSession).toHaveBeenCalledWith({
        agentId: null,
        workspace: { type: 'user', workspaceId: 'ws-empty' }
      })
    )
    expect(onShowMissingAgentSelection).not.toHaveBeenCalled()
  })

  it('deletes a work directory that does not have tasks', async () => {
    dataApiMocks.workspaces = [
      makeWorkspace('/Users/jd/project-empty', { id: 'ws-empty', name: 'Empty Workspace', orderKey: 'a' })
    ]
    setupSessions({ sessions: [] })

    render(<SessionsForTest />)

    const emptyWorkspaceGroup = screen.getByRole('button', { name: 'Empty Workspace' }).closest('div')
    expect(emptyWorkspaceGroup).not.toBeNull()
    fireEvent.pointerDown(within(emptyWorkspaceGroup as HTMLElement).getByRole('button', { name: 'More' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete work directory' }))

    await vi.waitFor(() =>
      expect(dataApiMocks.deleteWorkspace).toHaveBeenCalledWith({
        params: { workspaceId: 'ws-empty' }
      })
    )
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
        { id: 'agent-a', model: 'model-a', name: 'Alpha agent', configuration: { avatar: 'A' } },
        { id: 'agent-c', model: 'model-c', name: 'Gamma agent', configuration: { avatar: 'C' } }
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
    const gammaGroup = screen.getByRole('button', { name: 'Gamma agent' })
    expect(betaGroup.compareDocumentPosition(alphaGroup) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(groupChevron(betaGroup)).toHaveAttribute('aria-expanded', 'false')
    expect(groupChevron(alphaGroup)).toHaveAttribute('aria-expanded', 'false')
    expect(betaGroup).toHaveTextContent('B')
    expect(alphaGroup).toHaveTextContent('A')
    expect(groupChevron(gammaGroup)).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('No tasks')).toBeInTheDocument()
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
    expect(groupChevron(betaGroup)).toHaveAttribute('aria-expanded', 'false')

    cacheMocks.state.activeSessionId = 'session-b'
    view.rerender(<SessionsForTest key="selected-session-b" />)

    fireEvent.click(screen.getByRole('button', { name: 'Beta agent' }))

    // Expanding agent-b removes it from the collapsed list; sections stay expanded.
    expect(getSessionGroupExpansionCache().agent).not.toContain(SESSION_PINNED_SECTION_ID)
    expect(getSessionGroupExpansionCache().agent).not.toContain(SESSION_AGENT_SECTION_ID)
    expect(getSessionGroupExpansionCache().agent).not.toContain('session:agent:agent-b')
  })

  it('renders orphan sessions under the unlinked agent group without a virtual agent icon', () => {
    preferenceMocks.values.set('agent.session.display_mode', 'agent')
    setupSessions({
      sessions: [createSession({ id: 'session-orphan', name: 'Orphan session', agentId: null })]
    })

    render(<SessionsForTest />)

    const unlinkedAgentGroup = screen.getByRole('button', { name: 'Unlinked Agent' })
    expect(unlinkedAgentGroup.querySelector('[data-resource-list-leading-slot="true"]')).not.toBeInTheDocument()
    expect(unlinkedAgentGroup.closest('[data-slot="tooltip-trigger"]')).toBeInTheDocument()
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

    expect(groupChevron(screen.getByRole('button', { name: 'Alpha agent' }))).toHaveAttribute('aria-expanded', 'false')
    expect(groupChevron(screen.getByRole('button', { name: 'Beta agent' }))).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Alpha session')).not.toBeInTheDocument()
    expect(screen.queryByText('Beta session')).not.toBeInTheDocument()
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
    const requestFileNavigation = vi.fn()
    fileNavigationMocks.request = requestFileNavigation

    render(<SessionsForTest activeSessionId="session-a" setActiveSessionId={setActiveSessionId} />)
    fireEvent.click(screen.getByRole('button', { name: 'Beta agent' }))

    expect(setActiveSessionId).toHaveBeenCalledWith('session-b', expect.objectContaining({ id: 'session-b' }))
    expect(requestFileNavigation).not.toHaveBeenCalled()
    expect(cacheMocks.setActiveSessionId).not.toHaveBeenCalled()
    expect(cacheMocks.state.activeSessionId).toBe('session-a')
  })

  it('requests confirmation before switching to a session in another file workspace', () => {
    preferenceMocks.values.set('agent.session.display_mode', 'agent')
    setSessionGroupExpansionCache({
      ...createExpandedSessionGroupExpansionFixture(),
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
        createSession({
          id: 'session-b',
          name: 'Beta session',
          agentId: 'agent-b',
          orderKey: 'b',
          workspaceId: 'ws-b',
          workspace: makeWorkspace('/Users/jd/project-b', { id: 'ws-b', name: 'Embedded Project B' })
        })
      ]
    })
    const setActiveSessionId = vi.fn()
    let pendingTransition: (() => void) | undefined
    fileNavigationMocks.request = vi.fn((transition) => {
      pendingTransition = transition
    })

    render(<SessionsForTest activeSessionId="session-a" setActiveSessionId={setActiveSessionId} />)
    fireEvent.click(screen.getByRole('button', { name: 'Beta agent' }))

    expect(fileNavigationMocks.request).toHaveBeenCalledOnce()
    expect(setActiveSessionId).not.toHaveBeenCalled()

    pendingTransition?.()
    expect(setActiveSessionId).toHaveBeenCalledWith('session-b', expect.objectContaining({ id: 'session-b' }))
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

    expect(screen.queryByRole('button', { name: 'Tasks' })).not.toBeInTheDocument()
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

    const view = render(<SessionsForTest onCreateSession={vi.fn()} />)

    const betaGroupButton = screen.getByRole('button', { name: 'Beta agent' })
    expect(groupChevron(betaGroupButton)).toHaveAttribute('aria-expanded', 'true')
    // The collapse chevron rides along with the hover actions instead of being dropped for headers that have them.
    expect(groupChevron(betaGroupButton).querySelector('.lucide-chevron-right')).not.toBeNull()
    // "New task" is one action with one icon everywhere — the composer's, not a stray pencil.
    const createButton = screen.getAllByRole('button', { name: 'New task' })[0]
    expect(createButton.querySelector('.new-conversation-icon')).not.toBeNull()
    expect(createButton.querySelector('.lucide-square-pen')).toBeNull()

    fireEvent.click(betaGroupButton)

    expect(cacheMocks.setActiveSessionId).toHaveBeenCalledWith(
      'session-b',
      expect.objectContaining({ id: 'session-b' })
    )
    expect(groupChevron(betaGroupButton)).toHaveAttribute('aria-expanded', 'true')
    expect(getSessionGroupExpansionCache().agent).not.toContain('session:agent:agent-b')

    cacheMocks.state.activeSessionId = 'session-b'
    view.rerender(<SessionsForTest key="selected-session-b" />)

    const selectedBetaGroupButton = screen.getByRole('button', { name: 'Beta agent' })
    // With the group open the row announces the selection; the header stays quiet so screen readers
    // hear one "current", not two.
    expect(selectedBetaGroupButton).not.toHaveAttribute('aria-current')
    expect(selectedBetaGroupButton.closest('[data-selected]')).toHaveAttribute('data-selected', 'true')
    // While the group is open the session row carries the selection; the header must not repeat it.
    expect(selectedBetaGroupButton.parentElement).not.toHaveClass('bg-resource-list-row-selected')

    fireEvent.click(selectedBetaGroupButton)
    expect(getSessionGroupExpansionCache().agent).toContain('session:agent:agent-b')

    view.rerender(<SessionsForTest key="collapsed-session-b" />)
    const collapsedBetaGroupButton = screen.getByRole('button', { name: 'Beta agent' })
    expect(groupChevron(collapsedBetaGroupButton)).toHaveAttribute('aria-expanded', 'false')
    // Collapsed, the header stands in for the hidden session row: same fill AND same weight a
    // selected row gets anywhere else in the list.
    expect(collapsedBetaGroupButton.parentElement).toHaveClass('bg-resource-list-row-selected')
    expect(within(collapsedBetaGroupButton).getByText('Beta agent')).toHaveClass('font-medium')
  })

  it('clears session selection while agent management is active', () => {
    cacheMocks.state.activeSessionId = 'session-a'
    const onSelectResourceView = vi.fn()
    setupSessions({
      sessions: [createSession({ id: 'session-a', name: 'Alpha session', orderKey: 'a' })]
    })

    render(<SessionsForTest manageAgentsActive onManageAgents={onSelectResourceView} />)

    expect(screen.queryByRole('button', { name: 'Manage Agents' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Display mode' }))
    fireEvent.click(screen.getByRole('button', { name: 'Manage Agents' }))
    expect(onSelectResourceView).toHaveBeenCalled()
    expect(screen.getByText('Alpha session').closest('[role="option"]')).not.toHaveAttribute('data-selected')
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
  })

  it('guards creation of a new system session because it receives a distinct file workspace', async () => {
    const onCreateSession = vi.fn()
    preferenceMocks.values.set('agent.session.display_mode', 'agent')
    agentDataMocks.useAgents.mockReturnValue({
      agents: [{ id: 'agent-a', model: 'model-a', name: 'Alpha agent' }],
      isLoading: false,
      error: undefined
    })
    setupSessions({
      sessions: [
        createSession({
          id: 'session-a',
          agentId: 'agent-a',
          workspaceId: null,
          workspace: makeWorkspace('/system/session-a', { type: AGENT_WORKSPACE_TYPE.SYSTEM })
        })
      ]
    })
    let pendingTransition: (() => void) | undefined
    fileNavigationMocks.request = vi.fn((transition) => {
      pendingTransition = transition
    })
    render(<SessionsForTest activeSessionId="session-a" onCreateSession={onCreateSession} />)

    const agentGroup = screen.getByRole('button', { name: 'Alpha agent' }).closest('div')
    fireEvent.click(within(agentGroup as HTMLElement).getByRole('button', { name: 'New task' }))

    expect(fileNavigationMocks.request).toHaveBeenCalledOnce()
    expect(onCreateSession).not.toHaveBeenCalled()

    pendingTransition?.()
    await vi.waitFor(() =>
      expect(onCreateSession).toHaveBeenCalledWith({
        agentId: 'agent-a',
        workspace: { type: AGENT_WORKSPACE_TYPE.SYSTEM }
      })
    )
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

  it('shows the first grouped session page while the remaining pages load', () => {
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
    expect(screen.getByRole('button', { name: 'Project A Workspace' })).toBeInTheDocument()
    expect(screen.getByText('First page session')).toBeInTheDocument()
    expect(screen.queryAllByTestId('agent-session-row')).toHaveLength(1)
    expect(document.querySelectorAll('[data-resource-list-loading-group]')).toHaveLength(0)
    expect(document.querySelectorAll('[data-resource-list-loading-item]')).toHaveLength(0)
    expect(screen.getByText('Loading...')).toBeInTheDocument()
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
    // One rule for both themes: titles sit at `foreground`, no per-theme override.
    expect(screen.getByText('Beta session')).toHaveClass('text-foreground')
    expect(screen.getByText('Beta session')).not.toHaveClass('dark:text-muted-foreground')
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
    setupSessions({
      sessions: [
        createSession({ id: 'session-a', name: 'Alpha session', orderKey: 'a' }),
        createSession({ id: 'session-old', name: 'Older session', orderKey: 'b', updatedAt: EARLIER_SESSION_ISO })
      ]
    })
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
    setupSessions({
      sessions: [
        createSession({ id: 'session-a', name: 'Alpha session', orderKey: 'a' }),
        createSession({ id: 'session-old', name: 'Older session', orderKey: 'b', updatedAt: EARLIER_SESSION_ISO })
      ]
    })

    render(<SessionsForTest />)

    const todayHeader = screen.getByRole('button', { name: 'Today' }).closest('div')
    expect(todayHeader).toBeInTheDocument()
    expect(within(todayHeader as HTMLElement).queryByRole('button', { name: 'New task' })).not.toBeInTheDocument()
  })

  it('requests a new session from the header without creating inline', () => {
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

  it('renames sessions optimistically and rolls back when the update fails', async () => {
    let resolveRename!: (session: AgentSessionEntity | undefined) => void
    sessionDataMocks.updateSession.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRename = resolve
      })
    )
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
    expect(screen.getByText('Renamed session')).toBeInTheDocument()
    expect(screen.queryByText('Alpha session')).not.toBeInTheDocument()
    expect(sessionDataMocks.reorderSession).not.toHaveBeenCalled()

    await act(async () => resolveRename(undefined))

    expect(screen.getByText('Alpha session')).toBeInTheDocument()
    expect(screen.queryByText('Renamed session')).not.toBeInTheDocument()
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

  it('closes the rename dialog without updating when its session is deleted', async () => {
    const { rerender } = render(<SessionsForTest />)

    fireEvent.contextMenu(screen.getByText('Alpha session'))
    const alphaMenu = screen.getByText('Alpha session').closest('[data-testid="context-menu"]')
    const menuContent = alphaMenu?.querySelector('[data-testid="context-menu-content"]')
    fireEvent.click(within(menuContent as HTMLElement).getByRole('menuitem', { name: 'Edit task name' }))

    expect(await screen.findByRole('dialog')).toBeInTheDocument()

    const sourceWithoutTarget = {
      ...(sessionDataMocks.source as ComponentProps<typeof Sessions>['agentSessionsSource']),
      sessions: [createSession({ id: 'session-b', name: 'Beta session', orderKey: 'b' })]
    }
    rerender(<SessionsForTest agentSessionsSource={sourceWithoutTarget} />)

    await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(sessionDataMocks.updateSession).not.toHaveBeenCalled()
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
    expect(tabsContextMocks.openTab).toHaveBeenCalledWith('/app/agents?sessionId=session-b', {
      forceNew: true,
      title: 'Beta session'
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
    // Pinned rows are lifted out of their workdir group, so they must not keep its icon indent.
    expect(pinnedRow?.querySelector('[data-resource-list-leading-slot="true"]') ?? null).not.toBeInTheDocument()
    expect(within(pinnedRow as HTMLElement).queryByLabelText('Delete')).not.toBeInTheDocument()
  })

  it('keeps the pinned group label when every session is pinned in time mode', () => {
    preferenceMocks.values.set('agent.session.display_mode', 'time')
    setupSessions({
      sessions: [createSession({ id: 'session-pinned', name: 'Pinned session', orderKey: 'a' })],
      pinIdBySessionId: new Map([['session-pinned', 'pin-session-pinned']])
    })

    render(<SessionsForTest />)

    expect(screen.getByRole('button', { name: 'Pinned' })).toBeInTheDocument()
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

  it('switches to the neighbour before deleting the active session so the by-id 404 never binds the route', async () => {
    // Regression: deleting the active session used to switch to the neighbour only AFTER awaiting
    // deleteSession, so the just-deleted id was still the URL-bound active session when its by-id
    // revalidation returned 404 and tripped AgentPage's route-recovery effect. The switch must
    // precede the delete.
    preferenceMocks.values.set('agent.session.display_mode', 'agent')
    agentDataMocks.useAgents.mockReturnValue({
      agents: [{ id: 'agent-a', model: 'model-a', name: 'Alpha agent', configuration: { avatar: 'A' } }],
      isLoading: false,
      error: undefined
    })
    setupSessions({
      sessions: [
        createSession({ id: 'session-a', name: 'A session', agentId: 'agent-a', orderKey: 'a' }),
        createSession({ id: 'session-b', name: 'B session', agentId: 'agent-a', orderKey: 'b' })
      ]
    })
    const setActiveSessionId = vi.fn()
    sessionDataMocks.deleteSession.mockResolvedValue(true)

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
    await vi.waitFor(() =>
      expect(setActiveSessionId).toHaveBeenCalledWith('session-a', expect.objectContaining({ id: 'session-a' }))
    )
    // The neighbour switch (session-a) must land before the delete (session-b); the inverse order
    // is exactly what let the route-recovery race create a stray session.
    const switchOrder = setActiveSessionId.mock.invocationCallOrder.at(-1)!
    const deleteOrder = sessionDataMocks.deleteSession.mock.invocationCallOrder.at(-1)!
    expect(switchOrder).toBeLessThan(deleteOrder)
  })

  it('defers the whole switch+delete transition behind the dirty-file guard instead of deleting while the neighbour switch is pending', async () => {
    // Regression: the neighbour switch used to be submitted through the file-navigation guard alone,
    // so with a dirty editor in another workspace the delete raced the URL while the doomed id was
    // still active. The delete must not start while the guard holds the transition.
    preferenceMocks.values.set('agent.session.display_mode', 'agent')
    agentDataMocks.useAgents.mockReturnValue({
      agents: [{ id: 'agent-a', model: 'model-a', name: 'Alpha agent', configuration: { avatar: 'A' } }],
      isLoading: false,
      error: undefined
    })
    setupSessions({
      sessions: [
        createSession({
          id: 'session-a',
          name: 'A session',
          agentId: 'agent-a',
          orderKey: 'a',
          workspaceId: 'ws-a',
          workspace: makeWorkspace('/Users/jd/project-a', { id: 'ws-a', name: 'Project A' })
        }),
        createSession({
          id: 'session-b',
          name: 'B session',
          agentId: 'agent-a',
          orderKey: 'b',
          workspaceId: 'ws-b',
          workspace: makeWorkspace('/Users/jd/project-b', { id: 'ws-b', name: 'Project B' })
        })
      ]
    })
    const setActiveSessionId = vi.fn()
    let pendingTransition: (() => void) | undefined
    fileNavigationMocks.request = vi.fn((transition) => {
      pendingTransition = transition
    })

    render(<SessionsForTest activeSessionId="session-a" setActiveSessionId={setActiveSessionId} />)

    const sessionRow = screen.getByText('A session').closest('[role="option"]')
    const deleteButton = within(sessionRow as HTMLElement).getByLabelText('Delete')
    act(() => {
      fireEvent.click(deleteButton)
    })
    act(() => {
      fireEvent.click(deleteButton)
    })

    // The guard is holding the transition: neither the switch nor the delete may have happened.
    await vi.waitFor(() => expect(fileNavigationMocks.request).toHaveBeenCalledOnce())
    expect(setActiveSessionId).not.toHaveBeenCalled()
    expect(sessionDataMocks.deleteSession).not.toHaveBeenCalled()

    // User confirms discarding the dirty editor: the switch lands before the delete runs.
    act(() => {
      pendingTransition?.()
    })
    await vi.waitFor(() => expect(sessionDataMocks.deleteSession).toHaveBeenCalledWith('session-a'))
    await vi.waitFor(() =>
      expect(setActiveSessionId).toHaveBeenCalledWith('session-b', expect.objectContaining({ id: 'session-b' }))
    )
    const switchOrder = setActiveSessionId.mock.invocationCallOrder.at(-1)!
    const deleteOrder = sessionDataMocks.deleteSession.mock.invocationCallOrder.at(-1)!
    expect(switchOrder).toBeLessThan(deleteOrder)
  })

  it('does not roll back to the deleted session when the user selected a different session during a failed delete', async () => {
    // Regression: the delete-failure rollback used to unconditionally switch back to the deleted id,
    // stomping a newer user selection made while the delete was in flight. The rollback must only fire
    // while the optimistic neighbour is still the active session.
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
    // In-flight delete that resolves to failure; the hook's real deleteSession swallows errors and
    // returns false, so the failure must be modelled as a resolution, not a rejection.
    let resolveDeleteFailure: (() => void) | undefined
    sessionDataMocks.deleteSession.mockImplementation(
      () => new Promise<boolean>((resolve) => (resolveDeleteFailure = () => resolve(false)))
    )
    const setActiveSessionId = vi.fn()

    const view = render(<SessionsForTest activeSessionId="session-a" setActiveSessionId={setActiveSessionId} />)

    const sessionRow = screen.getByText('A session').closest('[role="option"]')
    const deleteButton = within(sessionRow as HTMLElement).getByLabelText('Delete')
    act(() => {
      fireEvent.click(deleteButton)
    })
    act(() => {
      fireEvent.click(deleteButton)
    })

    await vi.waitFor(() => expect(sessionDataMocks.deleteSession).toHaveBeenCalledWith('session-a'))

    // The optimistic switch already landed on the neighbour via the controlled setter. The user then
    // picks session-c while the delete is still in flight; the parent re-renders with its new active
    // id, which is what moves the component's activeSessionIdRef.
    act(() => {
      view.rerender(<SessionsForTest activeSessionId="session-c" setActiveSessionId={setActiveSessionId} />)
    })

    // Let the delete fail now: the ref no longer matches the optimistic neighbour (session-c was
    // selected), so no rollback back to session-a — the user's newer selection must win.
    act(() => resolveDeleteFailure?.())
    await vi.waitFor(() => expect(setActiveSessionId).not.toHaveBeenCalledWith('session-a', expect.anything()))
  })

  it('rolls back the optimistic selection when deleting the active session fails immediately', async () => {
    preferenceMocks.values.set('agent.session.display_mode', 'agent')
    agentDataMocks.useAgents.mockReturnValue({
      agents: [{ id: 'agent-a', model: 'model-a', name: 'Alpha agent', configuration: { avatar: 'A' } }],
      isLoading: false,
      error: undefined
    })
    setupSessions({
      sessions: [
        createSession({ id: 'session-a', name: 'A session', agentId: 'agent-a', orderKey: 'a' }),
        createSession({ id: 'session-b', name: 'B session', agentId: 'agent-a', orderKey: 'b' })
      ]
    })
    sessionDataMocks.deleteSession.mockResolvedValue(false)
    const setActiveSessionId = vi.fn()

    render(<SessionsForTest activeSessionId="session-a" setActiveSessionId={setActiveSessionId} />)

    const sessionRow = screen.getByText('A session').closest('[role="option"]')
    const deleteButton = within(sessionRow as HTMLElement).getByLabelText('Delete')
    act(() => {
      fireEvent.click(deleteButton)
    })
    act(() => {
      fireEvent.click(deleteButton)
    })

    await vi.waitFor(() =>
      expect(setActiveSessionId).toHaveBeenLastCalledWith('session-a', expect.objectContaining({ id: 'session-a' }))
    )
  })

  it('switches to another agent latest session after deleting an agent last session in the modern sidebar', async () => {
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
          id: 'session-b-older',
          name: 'B Older session',
          agentId: 'agent-b',
          orderKey: 'b',
          updatedAt: '2026-01-02T01:00:00.000Z'
        }),
        createSession({
          id: 'session-b-latest',
          name: 'B Latest session',
          agentId: 'agent-b',
          orderKey: 'c',
          updatedAt: '2026-01-04T01:00:00.000Z'
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
    await vi.waitFor(() =>
      expect(setActiveSessionId).toHaveBeenCalledWith(
        'session-b-latest',
        expect.objectContaining({ id: 'session-b-latest' })
      )
    )
    expect(onCreateSession).not.toHaveBeenCalled()
  })

  it('switches to another agent latest session after deleting the active agent last session in the right panel', async () => {
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
      expect(setActiveSessionId).toHaveBeenCalledWith(
        'session-b-first',
        expect.objectContaining({ id: 'session-b-first' })
      )
    )
    expect(onCreateSession).not.toHaveBeenCalled()
  })

  it('switches to another workspace latest session after deleting the active workspace last session', async () => {
    preferenceMocks.values.set('agent.session.display_mode', 'workdir')
    setupSessions({
      sessions: [
        createSession({
          id: 'session-a-only',
          name: 'A Only session',
          workspaceId: 'ws-a',
          workspace: makeWorkspace('/Users/jd/project-a', { id: 'ws-a' }),
          updatedAt: '2026-01-03T01:00:00.000Z'
        }),
        createSession({
          id: 'session-b-older',
          name: 'B Older session',
          workspaceId: 'ws-b',
          workspace: makeWorkspace('/Users/jd/project-b', { id: 'ws-b' }),
          updatedAt: '2026-01-01T01:00:00.000Z'
        }),
        createSession({
          id: 'session-b-latest',
          name: 'B Latest session',
          workspaceId: 'ws-b',
          workspace: makeWorkspace('/Users/jd/project-b', { id: 'ws-b' }),
          updatedAt: '2026-01-04T01:00:00.000Z'
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
    await vi.waitFor(() =>
      expect(setActiveSessionId).toHaveBeenCalledWith(
        'session-b-latest',
        expect.objectContaining({ id: 'session-b-latest' })
      )
    )
    expect(onCreateSession).not.toHaveBeenCalled()
  })

  it('leaves an empty agent group after deleting its only non-active session without switching the view', async () => {
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
        createSession({ id: 'session-a-only', name: 'A Only session', agentId: 'agent-a', orderKey: 'a' }),
        createSession({ id: 'session-b-first', name: 'B First session', agentId: 'agent-b', orderKey: 'b' })
      ]
    })
    const onCreateSession = vi.fn()
    const setActiveSessionId = vi.fn()

    // Active session belongs to agent-b; the deleted session is agent-a's only one.
    render(
      <SessionsForTest
        activeSessionId="session-b-first"
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
    expect(setActiveSessionId).not.toHaveBeenCalled()
    expect(onCreateSession).not.toHaveBeenCalled()
  })

  it('clears the active session after deleting the final remaining session in the right panel', async () => {
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
    await vi.waitFor(() => expect(setActiveSessionId).toHaveBeenCalledWith(null, null))
    expect(onCreateSession).not.toHaveBeenCalled()
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

  it('announces fulfilled and pending stream states', () => {
    // Only session-b carries a status; session-a is the selected row and a
    // green completion dot is suppressed there (read-receipt).
    topicStreamStatusMocks.useTopicStreamStatus.mockImplementation((topicId: string) =>
      createTopicStreamStatusMock(topicId === 'agent-session:session-b' ? { isFulfilled: true } : {})
    )

    const { unmount } = render(<SessionsForTest />)

    const indicator = screen.getByTestId('agent-session-stream-indicator')
    expect(indicator).toHaveAccessibleName('Done')

    topicStreamStatusMocks.useTopicStreamStatus.mockImplementation((topicId: string) =>
      createTopicStreamStatusMock(topicId === 'agent-session:session-b' ? { isPending: true } : {})
    )

    unmount()
    render(<SessionsForTest />)

    const pendingIndicator = screen.getByTestId('agent-session-stream-indicator')
    expect(pendingIndicator).toHaveAccessibleName('Running')
  })

  it('keeps running and error indicators on the selected session row but suppresses the completion dot', () => {
    // session-a is the selected row in the default fixture.
    topicStreamStatusMocks.useTopicStreamStatus.mockImplementation((topicId: string) =>
      createTopicStreamStatusMock(topicId === 'agent-session:session-a' ? { isPending: true } : {})
    )

    let view = render(<SessionsForTest />)

    const selectedRow = screen
      .getAllByTestId('agent-session-row')
      .find((row) => row.getAttribute('data-selected') === 'true')
    expect(selectedRow).toBeDefined()
    expect(within(selectedRow as HTMLElement).getByTestId('agent-session-stream-indicator')).toHaveAccessibleName(
      'Running'
    )

    topicStreamStatusMocks.useTopicStreamStatus.mockImplementation((topicId: string) =>
      createTopicStreamStatusMock(topicId === 'agent-session:session-a' ? { status: 'error' } : {})
    )
    view.unmount()
    view = render(<SessionsForTest />)

    const erroredSelectedRow = screen
      .getAllByTestId('agent-session-row')
      .find((row) => row.getAttribute('data-selected') === 'true')
    const errorIndicator = within(erroredSelectedRow as HTMLElement).getByTestId('agent-session-stream-indicator')
    expect(errorIndicator).toHaveAccessibleName('Error')

    // A completion dot on the same selected row IS suppressed (read-receipt).
    topicStreamStatusMocks.useTopicStreamStatus.mockImplementation((topicId: string) =>
      createTopicStreamStatusMock(topicId === 'agent-session:session-a' ? { isFulfilled: true } : {})
    )
    view.unmount()
    render(<SessionsForTest />)

    const reselectedRow = screen
      .getAllByTestId('agent-session-row')
      .find((row) => row.getAttribute('data-selected') === 'true')
    expect(within(reselectedRow as HTMLElement).queryByTestId('agent-session-stream-indicator')).not.toBeInTheDocument()
  })

  it('announces an error when the last turn errored', () => {
    topicStreamStatusMocks.useTopicStreamStatus.mockImplementation((topicId: string) =>
      createTopicStreamStatusMock(topicId === 'agent-session:session-b' ? { status: 'error' } : {})
    )

    render(<SessionsForTest />)

    const indicator = screen.getByTestId('agent-session-stream-indicator')
    expect(indicator).toHaveAccessibleName('Error')
  })

  it('does not show a stream indicator for an aborted turn', () => {
    topicStreamStatusMocks.useTopicStreamStatus.mockImplementation((topicId: string) =>
      createTopicStreamStatusMock(topicId === 'agent-session:session-b' ? { status: 'aborted' } : {})
    )

    render(<SessionsForTest />)

    expect(screen.queryByTestId('agent-session-stream-indicator')).not.toBeInTheDocument()
  })

  it('shows an awaiting-approval badge without a stream indicator', () => {
    topicStreamStatusMocks.useTopicStreamStatus.mockImplementation((topicId: string) =>
      createTopicStreamStatusMock(topicId === 'agent-session:session-b' ? { status: 'awaiting-approval' } : {})
    )

    render(<SessionsForTest />)

    const badges = screen.getAllByTestId('agent-session-awaiting-approval-badge')
    expect(badges).toHaveLength(1)
    expect(badges[0]).toHaveTextContent('Pending')
    expect(screen.queryByTestId('agent-session-stream-indicator')).not.toBeInTheDocument()
  })

  it('shows only the pill (no spinner) while a live stream pauses for approval', () => {
    // claude-code runtime: stream stays 'streaming' during a permission pause;
    // only the awaiting-approval anchors mark the pause.
    topicStreamStatusMocks.useTopicStreamStatus.mockImplementation((topicId: string) =>
      createTopicStreamStatusMock(
        topicId === 'agent-session:session-b'
          ? { status: 'streaming', isPending: true, awaitingApprovalAnchors: [{ executionId: 'exec-1' }] }
          : {}
      )
    )

    render(<SessionsForTest />)

    const badges = screen.getAllByTestId('agent-session-awaiting-approval-badge')
    expect(badges).toHaveLength(1)
    expect(screen.queryByTestId('agent-session-stream-indicator')).not.toBeInTheDocument()
  })

  it('keeps the awaiting-approval badge on the selected session row', () => {
    // session-a is the active session in the default fixture. Awaiting-approval
    // is an ongoing state (unlike the completion dot), so it stays on the
    // selected row too — it only yields to hover actions.
    topicStreamStatusMocks.useTopicStreamStatus.mockImplementation((topicId: string) =>
      createTopicStreamStatusMock(topicId === 'agent-session:session-a' ? { status: 'awaiting-approval' } : {})
    )

    render(<SessionsForTest />)

    // Guard against a false negative: the row must be rendered and selected.
    const selectedRow = screen
      .getAllByTestId('agent-session-row')
      .find((row) => row.getAttribute('data-selected') === 'true')
    expect(selectedRow).toBeDefined()
    const badge = within(selectedRow as HTMLElement).getByTestId('agent-session-awaiting-approval-badge')
    expect(badge).toHaveTextContent('Pending')
  })

  it('persists display mode selection from the header menu', async () => {
    render(<SessionsForTest />)

    const displayModeContent = openSessionListOptions()
    expect(within(displayModeContent as HTMLElement).getByRole('button', { name: 'Time' })).toBeInTheDocument()
    expect(
      within(displayModeContent as HTMLElement).getByRole('button', { name: 'Work directory' })
    ).toBeInTheDocument()
    fireEvent.click(within(displayModeContent as HTMLElement).getByRole('button', { name: 'Agent' }))

    await vi.waitFor(() => {
      expect(preferenceMocks.setPreference).toHaveBeenCalledWith('agent.session.display_mode', 'agent')
    })
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
    dataApiMocks.workspaces = [
      makeWorkspace('/Users/jd/project-a', { id: 'ws-a', name: 'Project A Workspace', orderKey: 'a' })
    ]
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
    dataApiMocks.workspaces = [
      makeWorkspace('/Users/jd/project-a', { id: 'ws-a', name: 'Project A Workspace', orderKey: 'a' })
    ]
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
    expect(dataApiMocks.ipcRequest).toHaveBeenCalledWith('ai.agent.workspace.delete', { workspaceId: 'ws-a' })
    for (const key of ['/agent-sessions', '/agent-workspaces', '/pins', '/agent-channels']) {
      expect(dataApiMocks.invalidate).toHaveBeenCalledWith(key)
    }
    expect(sessionDataMocks.deleteSession).not.toHaveBeenCalled()
    expect(callOrder).toEqual(['workspace'])
    expect(tabsContextMocks.closeConversationTabs).toHaveBeenCalledWith('agents', ['session-a'])
    expect(cacheMocks.setActiveSessionId).toHaveBeenCalledWith(
      'session-pinned',
      expect.objectContaining({ id: 'session-pinned' })
    )
    expect(dataApiMocks.refetchWorkspaces).toHaveBeenCalled()
    expect(sessionDataMocks.reload).toHaveBeenCalled()
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

    render(<SessionsForTest onCreateSession={vi.fn()} />)

    expect(pinMocks.usePins).toHaveBeenCalledWith('agent', { enabled: true })
    const agentGroup = screen.getByRole('button', { name: 'Alpha agent' }).closest('div')
    expect(agentGroup).not.toBeNull()
    // Real agent rows carry no tooltip — only the unlinked-agent pseudo group needs explaining.
    expect(agentGroup?.closest('[data-slot="tooltip-trigger"]')).not.toBeInTheDocument()
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
    await vi.waitFor(() => expect(dataApiMocks.refetchAgents).toHaveBeenCalled())

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

  it('pins an agent to the sidebar from the agent group menu', async () => {
    preferenceMocks.values.set('agent.session.display_mode', 'agent')
    preferenceMocks.values.set('ui.sidebar.favorites', [])
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
    fireEvent.pointerDown(within(agentGroup as HTMLElement).getByRole('button', { name: 'More' }))
    const pinMenuItem = screen
      .getAllByRole('menuitem', { name: 'Add to sidebar' })
      .find((button) => button.getAttribute('data-slot') === 'dropdown-menu-item')
    expect(pinMenuItem).toBeDefined()

    fireEvent.click(pinMenuItem as HTMLElement)

    await vi.waitFor(() =>
      expect(preferenceMocks.setPreference).toHaveBeenCalledWith('ui.sidebar.favorites', [
        { type: 'agent', id: 'agent-a' }
      ])
    )
  })

  it('unpins an already pinned agent from the agent group menu', async () => {
    preferenceMocks.values.set('agent.session.display_mode', 'agent')
    preferenceMocks.values.set('ui.sidebar.favorites', [{ type: 'agent', id: 'agent-a' }])
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
    fireEvent.pointerDown(within(agentGroup as HTMLElement).getByRole('button', { name: 'More' }))
    const unpinMenuItem = screen
      .getAllByRole('menuitem', { name: 'Remove from sidebar' })
      .find((button) => button.getAttribute('data-slot') === 'dropdown-menu-item')
    expect(unpinMenuItem).toBeDefined()

    fireEvent.click(unpinMenuItem as HTMLElement)

    await vi.waitFor(() => expect(preferenceMocks.setPreference).toHaveBeenCalledWith('ui.sidebar.favorites', []))
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
    expect(dataApiMocks.ipcRequest).toHaveBeenCalledWith('ai.agent.delete', {
      agentId: 'agent-a',
      deleteSessions: true
    })
    for (const key of ['/agents', '/agent-sessions', '/agent-workspaces', '/pins', '/agent-channels']) {
      expect(dataApiMocks.invalidate).toHaveBeenCalledWith(key)
    }
    expect(sessionDataMocks.deleteSession).not.toHaveBeenCalled()
    expect(tabsContextMocks.closeConversationTabs).toHaveBeenCalledWith('agents', ['session-a'])
    expect(onActiveAgentDeleted).toHaveBeenCalledWith('agent-a')
    await vi.waitFor(() => expect(dataApiMocks.refetchAgents).toHaveBeenCalled())
    await vi.waitFor(() => expect(sessionDataMocks.reload).toHaveBeenCalled())
    expect(toast.success).toHaveBeenCalledWith('Deleted successfully')
  })

  it.each([
    { builtinRole: 'assistant' as const, name: 'Cherry Assistant' },
    { builtinRole: 'support' as const, name: 'Cherry Support' }
  ])('deletes only tasks from the protected built-in $name group', async ({ builtinRole, name }) => {
    const onActiveAgentDeleted = vi.fn()
    preferenceMocks.values.set('agent.session.display_mode', 'agent')
    agentDataMocks.useAgents.mockReturnValue({
      agents: [
        {
          id: 'agent-a',
          model: 'model-a',
          name,
          configuration: { builtin_role: builtinRole }
        }
      ],
      isLoading: false,
      error: undefined,
      refetch: dataApiMocks.refetchAgents
    })
    setupSessions({
      sessions: [createSession({ id: 'session-a', name: 'Alpha session', agentId: 'agent-a', orderKey: 'a' })]
    })
    dataApiMocks.deleteAgentSessions.mockResolvedValueOnce({ deletedIds: ['session-a', 'session-not-loaded'] })

    render(<SessionsForTest onActiveAgentDeleted={onActiveAgentDeleted} />)

    const agentGroup = screen.getByRole('button', { name }).closest('div')
    expect(agentGroup).not.toBeNull()
    fireEvent.pointerDown(within(agentGroup as HTMLElement).getByRole('button', { name: 'More' }))
    const deleteTasksMenuItem = screen
      .getAllByRole('menuitem', { name: 'Delete agent tasks' })
      .find((button) => button.getAttribute('data-slot') === 'dropdown-menu-item')
    expect(deleteTasksMenuItem).toBeDefined()
    expect(screen.queryByRole('menuitem', { name: 'Delete Agent' })).not.toBeInTheDocument()

    fireEvent.click(deleteTasksMenuItem as HTMLElement)

    await vi.waitFor(() =>
      expect(dataApiMocks.deleteAgentSessions).toHaveBeenCalledWith({ params: { agentId: 'agent-a' } })
    )
    expect(dataApiMocks.deleteAgent).not.toHaveBeenCalled()
    expect(tabsContextMocks.closeConversationTabs).toHaveBeenCalledWith('agents', ['session-a', 'session-not-loaded'])
    expect(popup.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'Delete all tasks for this agent. The agent itself will not be deleted.',
        title: 'Delete agent tasks'
      })
    )
    expect(onActiveAgentDeleted).toHaveBeenCalledWith('agent-a')
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
      expect(groupChevron(screen.getByRole('button', { name: 'Alpha agent' }))).toHaveAttribute(
        'aria-expanded',
        'false'
      )
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
    expect(groupChevron(agentGroupButton)).toHaveAttribute('aria-expanded', 'true')
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

  it('offers a retry entry point when a background refresh fails behind a served list', () => {
    setupSessions({ refreshError: new Error('refresh failed') })

    render(<SessionsForTest />)

    // The stale list stays on screen; the failure gets its own non-destructive strip.
    expect(screen.getByText('Alpha session')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    expect(sessionDataMocks.reload).toHaveBeenCalled()
  })
})
