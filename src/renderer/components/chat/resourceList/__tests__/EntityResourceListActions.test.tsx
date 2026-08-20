import type { ResolvedAction } from '@renderer/components/chat/actions/actionTypes'
import type { ResourceEntityRailItem } from '@renderer/components/chat/resourceList/ResourceEntityRail'
import type { AgentSessionsSource, AssistantTopicsSource } from '@renderer/hooks/resourceViewSources'
import { popup } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'
import { MockUseCacheUtils } from '@test-mocks/renderer/useCache'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AgentResourceList } from '../AgentResourceList'
import { AssistantResourceList } from '../AssistantResourceList'

const assistantDataMocks = vi.hoisted(() => ({
  deleteTopicsByAssistantId: vi.fn(),
  deleteAssistant: vi.fn(),
  refetchAssistants: vi.fn(),
  topics: [
    { id: 'topic-1', assistantId: 'assistant-1', name: 'Topic 1' },
    { id: 'topic-2', assistantId: 'assistant-2', name: 'Topic 2' }
  ] as Array<{ id: string; assistantId?: string; name: string }>
}))

const agentDataMocks = vi.hoisted(() => ({
  agents: [
    {
      id: 'agent-1',
      name: 'Agent 1',
      orderKey: 'a',
      configuration: {},
      model: 'anthropic::claude-sonnet-4',
      modelName: 'Claude Sonnet 4'
    }
  ],
  deleteAgent: vi.fn(),
  deleteAgentSessions: vi.fn(),
  invalidate: vi.fn(),
  ipcRequest: vi.fn(),
  refetchAgents: vi.fn(),
  toggleAgentPin: vi.fn()
}))

const loggerMocks = vi.hoisted(() => ({
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn()
}))

const preferenceMocks = vi.hoisted(() => ({
  setPreference: vi.fn(),
  sortType: 'list' as 'list' | 'tags',
  setSortType: vi.fn(),
  values: new Map<string, unknown>()
}))

const resourceEntityRailMocks = vi.hoisted(() => ({
  collapsedGroupId: 'resource-entity-rail:section:["group","group-work"]'
}))

const tabsContextMocks = vi.hoisted(() => ({
  closeConversationTabs: vi.fn()
}))

vi.mock('@cherrystudio/ui', () => ({
  BlurCancelPointerSensor: class BlurCancelPointerSensor {},
  Button: ({ children, onClick, ...props }: { children?: ReactNode; onClick?: () => void }) => (
    <button {...props} type="button" onClick={onClick}>
      {children}
    </button>
  ),
  MenuItem: ({ icon, label, onClick }: { icon?: ReactNode; label: ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>
      {icon}
      {label}
    </button>
  ),
  Tooltip: ({ children }: { children?: ReactNode }) => <>{children}</>,
  MenuDivider: () => <hr />,
  MenuList: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DropdownMenu: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DropdownMenuCheckboxItem: ({
    children,
    checked,
    onCheckedChange,
    ...props
  }: {
    children?: ReactNode
    checked?: boolean
    onCheckedChange?: (checked: boolean) => void
    role?: string
  }) => (
    <button
      type="button"
      aria-checked={checked}
      role={props.role ?? 'menuitemcheckbox'}
      onClick={() => onCheckedChange?.(!checked)}>
      {checked && <span className="lucide-check" />}
      {children}
    </button>
  ),
  DropdownMenuItem: ({
    children,
    disabled,
    onSelect
  }: {
    children?: ReactNode
    disabled?: boolean
    onSelect?: (event: unknown) => void
  }) => (
    <button type="button" disabled={disabled} onClick={(event) => onSelect?.(event)}>
      {children}
    </button>
  ),
  DropdownMenuRadioGroup: ({
    children,
    onValueChange
  }: {
    children?: ReactNode
    onValueChange?: (value: string) => void
  }) => (
    <div
      onClick={(event) => {
        const value = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-value]')?.dataset.value
        if (value) onValueChange?.(value)
      }}>
      {children}
    </div>
  ),
  DropdownMenuRadioItem: ({ children, value }: { children?: ReactNode; value: string }) => (
    <button type="button" data-value={value}>
      {children}
    </button>
  ),
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuSub: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DropdownMenuSubContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DropdownMenuSubTrigger: ({ children }: { children?: ReactNode }) => <button type="button">{children}</button>,
  DropdownMenuTrigger: ({ children }: { children?: ReactNode }) => <>{children}</>,
  Popover: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  PopoverContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children?: ReactNode }) => <>{children}</>
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) =>
      key === 'assistants.clear.success_title' ? `${key}:${options?.count}` : key
  })
}))

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: (key: string) => {
    if (key === 'assistant.tab.sort_type') {
      return [
        preferenceMocks.sortType,
        (value: unknown) => {
          preferenceMocks.sortType = value as 'list' | 'tags'
          preferenceMocks.setSortType(value)
          preferenceMocks.setPreference(key, value)
        }
      ]
    }

    const defaultValue =
      key === 'topic.tab.display_mode'
        ? 'assistant'
        : key === 'topic.sort_type'
          ? 'createdAt'
          : key === 'agent.session.display_mode'
            ? 'agent'
            : key === 'agent.session.sort_type'
              ? 'createdAt'
              : undefined

    return [
      preferenceMocks.values.get(key) ?? defaultValue,
      (value: unknown) => {
        preferenceMocks.values.set(key, value)
        preferenceMocks.setPreference(key, value)
      }
    ]
  }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => loggerMocks
  }
}))

vi.mock('@renderer/components/EmojiIcon', () => ({
  default: ({ emoji }: { emoji: string }) => <span>{emoji}</span>
}))

vi.mock('@renderer/components/Avatar/ModelAvatar', () => ({
  default: () => <span data-testid="model-avatar" />
}))

vi.mock('@renderer/components/resourceCatalog/dialogs/edit', () => ({
  ResourceEditDialogHost: () => null
}))

vi.mock('@renderer/components/chat/resourceList/useResourceEntityRail', () => ({
  useResourceEntityRail: ({
    activeEntityId,
    entities
  }: {
    activeEntityId?: string | null
    entities: ResourceEntityRailItem[]
  }) => ({
    handleReorder: vi.fn(),
    handleSelect: vi.fn(),
    items: entities,
    listStatus: 'idle',
    selectedId: activeEntityId ?? null
  })
}))

vi.mock('@renderer/components/chat/resourceList/ResourceEntityRail', () => ({
  ResourceEntityRail: ({
    collapsedState,
    getContextMenuActions,
    groupByGroup,
    headerActions,
    items,
    onCollapsedStateChange,
    onContextMenuAction,
    onGroupReorder,
    onReorder,
    reorderEnabled = true,
    selectedId,
    selectionSuppressed
  }: {
    collapsedState?: readonly string[]
    getContextMenuActions?: (item: ResourceEntityRailItem) => readonly ResolvedAction[]
    groupByGroup?: boolean
    headerActions?: ReactNode
    items: readonly ResourceEntityRailItem[]
    onCollapsedStateChange?: (collapsedIds: string[]) => void
    onContextMenuAction?: (item: ResourceEntityRailItem, action: ResolvedAction) => void | Promise<void>
    onGroupReorder?: (groupId: string, anchor: { before: string }) => void | Promise<void>
    onReorder?: unknown
    reorderEnabled?: boolean
    selectedId?: string | null
    selectionSuppressed?: boolean
  }) => {
    const flattenActions = (actions: readonly ResolvedAction[]): readonly ResolvedAction[] =>
      actions.flatMap((action) => [action, ...flattenActions(action.children)])

    return (
      <div
        data-testid="resource-entity-rail"
        data-group-by-group={String(!!groupByGroup)}
        data-reorder={(onReorder || onGroupReorder) && reorderEnabled ? 'enabled' : 'disabled'}
        data-item-reorder={onReorder && reorderEnabled ? 'enabled' : 'disabled'}
        data-group-reorder={onGroupReorder && reorderEnabled ? 'enabled' : 'disabled'}
        data-sortable-container={onReorder || onGroupReorder ? 'enabled' : 'disabled'}
        data-collapsed-state={collapsedState?.join(',') ?? 'uncontrolled'}
        data-selected-id={selectionSuppressed ? '' : (selectedId ?? '')}
        data-selection-suppressed={String(!!selectionSuppressed)}>
        <button
          type="button"
          aria-label="Collapse work group"
          onClick={() => onCollapsedStateChange?.([resourceEntityRailMocks.collapsedGroupId])}
        />
        {headerActions}
        {items.map((item) => {
          const actions = getContextMenuActions?.(item) ?? []
          const renderedActions = flattenActions(actions)

          return (
            <section key={item.id} aria-label={item.name} title={item.tooltip}>
              {item.icon}
              <div data-testid={`${item.id}-context-menu`}>
                {renderedActions.map((action) => (
                  <button
                    key={`context-${action.id}`}
                    type="button"
                    disabled={!action.availability.enabled}
                    onClick={() => onContextMenuAction?.(item, action)}>
                    {action.label}
                  </button>
                ))}
              </div>
              <div data-testid={`${item.id}-more-menu`}>
                {renderedActions.map((action) => (
                  <button
                    key={`more-${action.id}`}
                    type="button"
                    disabled={!action.availability.enabled}
                    onClick={() => onContextMenuAction?.(item, action)}>
                    {action.label}
                  </button>
                ))}
              </div>
              {item.trailingAction}
            </section>
          )
        })}
      </div>
    )
  }
}))

vi.mock('@renderer/hooks/useAssistant', () => ({
  useAssistantMutations: () => ({
    deleteAssistant: assistantDataMocks.deleteAssistant
  }),
  useAssistantsApi: () => ({
    assistants: [
      {
        id: 'assistant-1',
        name: 'Assistant 1',
        orderKey: 'a',
        emoji: 'A',
        modelId: 'openai::gpt-4o',
        modelName: 'GPT-4o'
      },
      {
        id: 'assistant-2',
        name: 'Assistant 2',
        orderKey: 'b',
        emoji: 'B',
        modelId: 'openai::gpt-4o',
        modelName: 'GPT-4o'
      }
    ],
    error: null,
    hasLoaded: true,
    isLoading: false,
    refetch: assistantDataMocks.refetchAssistants
  })
}))

vi.mock('@renderer/hooks/agent/useAgent', () => ({
  useAgents: () => ({
    agents: agentDataMocks.agents,
    deleteAgent: agentDataMocks.deleteAgent,
    error: null,
    isLoading: false,
    refetch: agentDataMocks.refetchAgents
  })
}))

vi.mock('@renderer/hooks/usePins', () => ({
  usePins: () => ({
    isLoading: false,
    isMutating: false,
    isRefreshing: false,
    pinnedIds: [],
    togglePin: agentDataMocks.toggleAgentPin
  })
}))

vi.mock('@renderer/hooks/tab', () => ({
  useCloseConversationTabs: () => tabsContextMocks.closeConversationTabs
}))

vi.mock('@renderer/hooks/useGroups', () => ({
  useGroups: () => ({ groups: [], isLoading: false, error: undefined }),
  useGroupReorder: () => ({ reorderGroup: vi.fn() })
}))

function createAgentSessionsSource(overrides: Partial<AgentSessionsSource> = {}): AgentSessionsSource {
  return {
    stats: {
      total: 1,
      pinnedCount: 0,
      byAgent: [{ agentId: 'agent-1', count: 1, pinnedCount: 0 }],
      byWorkspace: []
    },
    loadLatestSession: vi.fn().mockResolvedValue(null),
    reuseOrCreateSession: vi.fn(),
    ...overrides
  }
}

function createAssistantTopicsSource(): AssistantTopicsSource {
  const byAssistantCounts = new Map<string | null, number>()
  for (const topic of assistantDataMocks.topics) {
    const key = topic.assistantId ?? null
    byAssistantCounts.set(key, (byAssistantCounts.get(key) ?? 0) + 1)
  }
  return {
    stats: {
      total: assistantDataMocks.topics.length,
      pinnedCount: 0,
      byAssistant: Array.from(byAssistantCounts, ([assistantId, count]) => ({ assistantId, count, pinnedCount: 0 }))
    },
    loadLatestTopic: vi.fn().mockResolvedValue(null),
    reuseOrCreateTopic: vi.fn()
  }
}

function TestAssistantResourceList({
  assistantTopicsSource = createAssistantTopicsSource(),
  onAddAssistant = vi.fn(),
  ...props
}: Omit<ComponentProps<typeof AssistantResourceList>, 'assistantTopicsSource' | 'onAddAssistant'> & {
  assistantTopicsSource?: AssistantTopicsSource
  onAddAssistant?: ComponentProps<typeof AssistantResourceList>['onAddAssistant']
}) {
  return (
    <AssistantResourceList assistantTopicsSource={assistantTopicsSource} onAddAssistant={onAddAssistant} {...props} />
  )
}

vi.mock('@renderer/hooks/useTopic', () => ({
  mapApiTopicToRendererTopic: (topic: unknown) => topic,
  useTopicMutations: () => ({
    deleteTopicsByAssistantId: assistantDataMocks.deleteTopicsByAssistantId
  })
}))

vi.mock('@renderer/data/hooks/useDataApi', () => ({
  useInvalidateCache: () => agentDataMocks.invalidate,
  useMutation: () => ({ trigger: vi.fn() })
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: agentDataMocks.ipcRequest, on: vi.fn(() => () => undefined) }
}))

vi.mock('@renderer/utils/chat/topicsHelpers', () => ({
  sortTopicsForDisplayGroups: (topics: unknown[]) => topics
}))

vi.mock('@renderer/utils/chat/sessionListHelpers', () => ({
  sortSessionsForDisplayGroups: (sessions: unknown[]) => sessions
}))

vi.mock('@renderer/utils/agent', () => ({
  getAgentAvatarFromConfiguration: () => 'A'
}))

vi.mock('@renderer/utils/error', () => ({
  formatErrorMessageWithPrefix: (_error: unknown, prefix: string) => prefix
}))

describe('classic layout entity resource list actions', () => {
  beforeEach(() => {
    MockUseCacheUtils.resetMocks()
    agentDataMocks.agents = [
      {
        id: 'agent-1',
        name: 'Agent 1',
        orderKey: 'a',
        configuration: {},
        model: 'anthropic::claude-sonnet-4',
        modelName: 'Claude Sonnet 4'
      }
    ]
    preferenceMocks.sortType = 'list'
    preferenceMocks.values.clear()
    preferenceMocks.setPreference.mockClear()
    preferenceMocks.setSortType.mockClear()
    assistantDataMocks.topics = [
      { id: 'topic-1', assistantId: 'assistant-1', name: 'Topic 1' },
      { id: 'topic-2', assistantId: 'assistant-2', name: 'Topic 2' }
    ]
    assistantDataMocks.deleteTopicsByAssistantId.mockResolvedValue({ deletedIds: ['topic-1'], deletedCount: 1 })
    assistantDataMocks.deleteTopicsByAssistantId.mockClear()
    assistantDataMocks.deleteAssistant.mockResolvedValue({ deleted: true, deletedTopicIds: [] })
    assistantDataMocks.deleteAssistant.mockClear()
    assistantDataMocks.refetchAssistants.mockResolvedValue(undefined)
    assistantDataMocks.refetchAssistants.mockClear()
    agentDataMocks.deleteAgent.mockResolvedValue({ deleted: true, deletedSessionIds: [] })
    agentDataMocks.deleteAgent.mockClear()
    agentDataMocks.deleteAgentSessions.mockResolvedValue({ deletedIds: [] })
    agentDataMocks.deleteAgentSessions.mockClear()
    agentDataMocks.invalidate.mockResolvedValue(undefined)
    agentDataMocks.invalidate.mockClear()
    agentDataMocks.ipcRequest.mockImplementation((route, input) =>
      route === 'ai.agent.sessions.delete'
        ? agentDataMocks.deleteAgentSessions({ params: { agentId: input.agentId } })
        : agentDataMocks.deleteAgent({
            params: { agentId: input.agentId },
            query: { deleteSessions: input.deleteSessions }
          })
    )
    agentDataMocks.ipcRequest.mockClear()
    agentDataMocks.refetchAgents.mockResolvedValue(undefined)
    agentDataMocks.refetchAgents.mockClear()
    agentDataMocks.toggleAgentPin.mockResolvedValue(undefined)
    agentDataMocks.toggleAgentPin.mockClear()
    tabsContextMocks.closeConversationTabs.mockClear()
    loggerMocks.error.mockClear()
    loggerMocks.info.mockClear()
    loggerMocks.warn.mockClear()
  })

  it('shows assistants that do not own any topics', () => {
    assistantDataMocks.topics = []

    render(<TestAssistantResourceList activeAssistantId={null} onSelectTopic={vi.fn()} onCreateTopic={vi.fn()} />)

    expect(screen.getByRole('region', { name: 'Assistant 1' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Assistant 2' })).toBeInTheDocument()
  })

  it('shows agents that do not own any sessions', () => {
    render(
      <AgentResourceList
        activeAgentId="agent-1"
        agentSessionsSource={createAgentSessionsSource({
          stats: { total: 0, pinnedCount: 0, byAgent: [], byWorkspace: [] }
        })}
        onSelectSession={vi.fn()}
        onCreateSession={vi.fn()}
        onShowMissingAgentSelection={vi.fn()}
      />
    )

    expect(screen.getByRole('region', { name: 'Agent 1' })).toBeInTheDocument()
  })

  it('uses delete-assistant actions for the classic layout assistant context and more menus', async () => {
    const onCreateTopic = vi.fn()
    const onActiveAssistantDeleted = vi.fn()

    render(
      <TestAssistantResourceList
        activeAssistantId="assistant-1"
        onSelectTopic={vi.fn()}
        onCreateTopic={onCreateTopic}
        onActiveAssistantDeleted={onActiveAssistantDeleted}
      />
    )

    expect(screen.getByTestId('assistant-1-context-menu')).toHaveTextContent('assistants.delete.title')
    expect(screen.getByTestId('assistant-1-more-menu')).toHaveTextContent('assistants.delete.title')
    expect(screen.getByTestId('assistant-1-context-menu')).toHaveTextContent('assistants.clear.menu_title')
    expect(screen.getByTestId('assistant-1-more-menu')).toHaveTextContent('assistants.clear.menu_title')

    fireEvent.click(screen.getAllByRole('button', { name: 'assistants.delete.title' })[0])

    await waitFor(() =>
      expect(popup.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'assistants.delete.title' }))
    )
    await waitFor(() =>
      expect(assistantDataMocks.deleteAssistant).toHaveBeenCalledWith('assistant-1', { deleteTopics: true })
    )
    // Classic layout resets via the dedicated callback (page settles to the latest
    // remaining topic) and must NOT open the modern layout draft compose.
    await waitFor(() => expect(onActiveAssistantDeleted).toHaveBeenCalledWith('assistant-1'))
    expect(onCreateTopic).not.toHaveBeenCalled()
  })

  it('creates a new topic for the hovered assistant row', () => {
    const onCreateTopic = vi.fn()

    render(
      <TestAssistantResourceList
        activeAssistantId="assistant-1"
        onSelectTopic={vi.fn()}
        onCreateTopic={onCreateTopic}
      />
    )

    fireEvent.click(screen.getAllByRole('button', { name: 'chat.conversation.new' })[0])

    expect(onCreateTopic).toHaveBeenCalledWith('assistant-1')
  })

  it('clears assistant topics from the classic layout assistant context menu', async () => {
    const onSelectTopic = vi.fn()
    const onCreateTopic = vi.fn()

    render(
      <TestAssistantResourceList
        activeAssistantId="assistant-1"
        onSelectTopic={onSelectTopic}
        onCreateTopic={onCreateTopic}
      />
    )

    fireEvent.click(
      within(screen.getByTestId('assistant-1-context-menu')).getByRole('button', {
        name: 'assistants.clear.menu_title'
      })
    )

    await waitFor(() =>
      expect(popup.confirm).toHaveBeenCalledWith(
        expect.objectContaining({
          content: 'assistants.clear.content',
          title: 'assistants.clear.title'
        })
      )
    )
    await waitFor(() => expect(assistantDataMocks.deleteTopicsByAssistantId).toHaveBeenCalledWith('assistant-1'))
    expect(onCreateTopic).not.toHaveBeenCalled()
    expect(onSelectTopic).not.toHaveBeenCalled()
    expect(toast.success).toHaveBeenCalledWith('assistants.clear.success_title:1')
  })

  it('keeps assistant-less and dangling topics out of the real assistant rail', () => {
    assistantDataMocks.topics = [
      { id: 'topic-default', name: 'Default topic' },
      { id: 'topic-dangling', assistantId: 'missing-assistant', name: 'Dangling topic' },
      { id: 'topic-1', assistantId: 'assistant-1', name: 'Topic 1' }
    ]

    render(<TestAssistantResourceList activeAssistantId={null} onSelectTopic={vi.fn()} onCreateTopic={vi.fn()} />)

    expect(screen.getByRole('region', { name: 'Assistant 1' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Assistant 2' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'chat.topics.group.unknown_assistant' })).not.toBeInTheDocument()
  })

  it('switches from assistant reorder to group reorder while grouping by tag', () => {
    const props = { activeAssistantId: 'assistant-1', onSelectTopic: vi.fn(), onCreateTopic: vi.fn() }

    preferenceMocks.sortType = 'list'
    const { rerender } = render(<TestAssistantResourceList {...props} />)
    const railInList = screen.getByTestId('resource-entity-rail')
    expect(railInList).toHaveAttribute('data-group-by-group', 'false')
    expect(railInList).toHaveAttribute('data-item-reorder', 'enabled')
    expect(railInList).toHaveAttribute('data-group-reorder', 'disabled')

    preferenceMocks.sortType = 'tags'
    rerender(<TestAssistantResourceList {...props} />)
    const railInTags = screen.getByTestId('resource-entity-rail')
    expect(railInTags).toHaveAttribute('data-group-by-group', 'true')
    expect(railInTags).toHaveAttribute('data-item-reorder', 'disabled')
    expect(railInTags).toHaveAttribute('data-group-reorder', 'enabled')
  })

  it('restores collapsed assistant groups after the classic rail unmounts and remounts', () => {
    preferenceMocks.sortType = 'tags'
    const props = { activeAssistantId: 'assistant-1', onSelectTopic: vi.fn(), onCreateTopic: vi.fn() }
    const firstMount = render(<TestAssistantResourceList {...props} />)

    fireEvent.click(screen.getByRole('button', { name: 'Collapse work group' }))
    firstMount.unmount()
    render(<TestAssistantResourceList {...props} />)

    expect(screen.getByTestId('resource-entity-rail')).toHaveAttribute(
      'data-collapsed-state',
      resourceEntityRailMocks.collapsedGroupId
    )
  })

  it('toggles assistant tag grouping from the context menu (list → tags)', () => {
    render(
      <TestAssistantResourceList activeAssistantId="assistant-1" onSelectTopic={vi.fn()} onCreateTopic={vi.fn()} />
    )

    // sort_type === 'list' → the menu offers "group by tag".
    const menu = screen.getByTestId('assistant-1-context-menu')
    expect(menu).toHaveTextContent('assistants.groups.group_by')
    expect(menu).not.toHaveTextContent('assistants.groups.ungroup')

    fireEvent.click(screen.getAllByRole('button', { name: 'assistants.groups.group_by' })[0])
    expect(preferenceMocks.setSortType).toHaveBeenCalledWith('tags')
  })

  it('lets the classic assistant rail switch icon display mode from the context menu', () => {
    render(
      <TestAssistantResourceList activeAssistantId="assistant-1" onSelectTopic={vi.fn()} onCreateTopic={vi.fn()} />
    )

    expect(screen.getByTestId('assistant-1-context-menu')).toHaveTextContent('assistants.icon.type')

    fireEvent.click(screen.getAllByRole('button', { name: 'settings.assistant.icon.type.model' })[0])

    expect(preferenceMocks.setPreference).toHaveBeenCalledWith('assistant.icon_type', 'model')
  })

  it('offers turning tag grouping off when already grouping (tags → list)', () => {
    preferenceMocks.sortType = 'tags'

    render(
      <TestAssistantResourceList activeAssistantId="assistant-1" onSelectTopic={vi.fn()} onCreateTopic={vi.fn()} />
    )

    expect(screen.getByTestId('assistant-1-context-menu')).toHaveTextContent('assistants.groups.ungroup')

    fireEvent.click(screen.getAllByRole('button', { name: 'assistants.groups.ungroup' })[0])
    expect(preferenceMocks.setSortType).toHaveBeenCalledWith('list')
  })

  it('lets the classic assistant rail switch back to the time topic view', async () => {
    render(
      <TestAssistantResourceList activeAssistantId="assistant-1" onSelectTopic={vi.fn()} onCreateTopic={vi.fn()} />
    )

    fireEvent.click(screen.getByRole('button', { name: 'chat.topics.display.time' }))

    await waitFor(() => {
      expect(preferenceMocks.setPreference).toHaveBeenCalledWith('topic.tab.display_mode', 'time')
    })
  })

  it('keeps classic assistant rail history in the shared display menu', async () => {
    const onOpenHistoryRecords = vi.fn()

    render(
      <TestAssistantResourceList
        activeAssistantId="assistant-1"
        onOpenHistoryRecords={onOpenHistoryRecords}
        onSelectTopic={vi.fn()}
        onCreateTopic={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'history.records.shortTitle' }))

    // The shared display menu defers item selection until after the menu closes
    // (runAfterMenuClose → setTimeout), so the callback fires asynchronously.
    await waitFor(() => expect(onOpenHistoryRecords).toHaveBeenCalledTimes(1))
  })

  it('keeps assistant management in the shared display menu without adding a classic rail entry', async () => {
    const onManageAssistants = vi.fn()

    render(
      <TestAssistantResourceList
        activeAssistantId="assistant-1"
        manageAssistantsActive
        onManageAssistants={onManageAssistants}
        onSelectTopic={vi.fn()}
        onCreateTopic={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'assistants.presets.manage.title' }))

    expect(onManageAssistants).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('resource-entity-rail')).toHaveAttribute('data-selection-suppressed', 'true')
    expect(screen.getByTestId('resource-entity-rail')).toHaveAttribute('data-selected-id', '')
  })

  it('does not report a pin failure when the post-success agent refresh fails', async () => {
    const user = userEvent.setup()
    const refreshError = new Error('transient refresh failure')
    agentDataMocks.refetchAgents.mockRejectedValueOnce(refreshError)

    render(
      <AgentResourceList
        activeAgentId="agent-1"
        agentSessionsSource={createAgentSessionsSource()}
        onSelectSession={vi.fn()}
        onCreateSession={vi.fn()}
        onShowMissingAgentSelection={vi.fn()}
      />
    )

    await user.click(
      within(screen.getByTestId('agent-1-context-menu')).getByRole('button', { name: 'agent.pin.title' })
    )

    await waitFor(() => expect(agentDataMocks.toggleAgentPin).toHaveBeenCalledWith('agent-1'))
    await waitFor(() =>
      expect(loggerMocks.warn).toHaveBeenCalledWith(
        'Failed to refresh agents after toggling pin from classic-layout rail',
        { agentId: 'agent-1', err: refreshError }
      )
    )
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('reports a pin failure and skips the agent refresh when the pin mutation fails', async () => {
    const user = userEvent.setup()
    agentDataMocks.toggleAgentPin.mockRejectedValueOnce(new Error('pin mutation failed'))

    render(
      <AgentResourceList
        activeAgentId="agent-1"
        agentSessionsSource={createAgentSessionsSource()}
        onSelectSession={vi.fn()}
        onCreateSession={vi.fn()}
        onShowMissingAgentSelection={vi.fn()}
      />
    )

    await user.click(
      within(screen.getByTestId('agent-1-context-menu')).getByRole('button', { name: 'agent.pin.title' })
    )

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('common.error'))
    expect(agentDataMocks.refetchAgents).not.toHaveBeenCalled()
  })

  it('uses delete-agent actions for the classic layout agent context and more menus', async () => {
    const onShowMissingAgentSelection = vi.fn()
    const onActiveAgentDeleted = vi.fn()

    render(
      <AgentResourceList
        activeAgentId="agent-1"
        agentSessionsSource={createAgentSessionsSource()}
        onSelectSession={vi.fn()}
        onCreateSession={vi.fn()}
        onShowMissingAgentSelection={onShowMissingAgentSelection}
        onActiveAgentDeleted={onActiveAgentDeleted}
      />
    )

    expect(screen.getByTestId('agent-1-context-menu')).toHaveTextContent('agent.delete.title')
    expect(screen.getByTestId('agent-1-more-menu')).toHaveTextContent('agent.delete.title')
    expect(screen.getByTestId('agent-1-context-menu')).not.toHaveTextContent('agent.session.agent.delete.trigger')
    expect(screen.getByTestId('agent-1-more-menu')).not.toHaveTextContent('agent.session.agent.delete.trigger')

    fireEvent.click(screen.getAllByRole('button', { name: 'agent.delete.title' })[0])

    await waitFor(() =>
      expect(popup.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'agent.delete.title' }))
    )
    await waitFor(() =>
      expect(agentDataMocks.deleteAgent).toHaveBeenCalledWith({
        params: { agentId: 'agent-1' },
        query: { deleteSessions: true }
      })
    )
    expect(agentDataMocks.ipcRequest).toHaveBeenCalledWith('ai.agent.delete', {
      agentId: 'agent-1',
      deleteSessions: true
    })
    // Classic layout resets via the dedicated callback, never the draft compose.
    await waitFor(() => expect(onActiveAgentDeleted).toHaveBeenCalledWith('agent-1'))
    expect(onShowMissingAgentSelection).not.toHaveBeenCalled()
  })

  it('deletes only tasks for the built-in Cherry Assistant in the classic layout', async () => {
    agentDataMocks.agents = [
      {
        id: 'agent-1',
        name: 'Cherry Assistant',
        orderKey: 'a',
        configuration: { builtin_role: 'assistant' },
        model: 'anthropic::claude-sonnet-4',
        modelName: 'Claude Sonnet 4'
      }
    ]
    const onActiveAgentDeleted = vi.fn()
    agentDataMocks.deleteAgentSessions.mockResolvedValueOnce({ deletedIds: ['session-1', 'session-not-loaded'] })

    render(
      <AgentResourceList
        activeAgentId="agent-1"
        agentSessionsSource={createAgentSessionsSource()}
        onSelectSession={vi.fn()}
        onCreateSession={vi.fn()}
        onShowMissingAgentSelection={vi.fn()}
        onActiveAgentDeleted={onActiveAgentDeleted}
      />
    )

    expect(screen.getByTestId('agent-1-context-menu')).toHaveTextContent('agent.session.agent.delete.trigger')
    expect(screen.getByTestId('agent-1-context-menu')).not.toHaveTextContent('agent.delete.title')

    fireEvent.click(screen.getAllByRole('button', { name: 'agent.session.agent.delete.trigger' })[0])

    await waitFor(() =>
      expect(popup.confirm).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'agent.session.agent.delete.title',
          content: 'agent.session.agent.delete.content'
        })
      )
    )
    await waitFor(() =>
      expect(agentDataMocks.deleteAgentSessions).toHaveBeenCalledWith({ params: { agentId: 'agent-1' } })
    )
    expect(agentDataMocks.ipcRequest).toHaveBeenCalledWith('ai.agent.sessions.delete', { agentId: 'agent-1' })
    expect(agentDataMocks.deleteAgent).not.toHaveBeenCalled()
    expect(tabsContextMocks.closeConversationTabs).toHaveBeenCalledWith('agents', ['session-1', 'session-not-loaded'])
    expect(onActiveAgentDeleted).toHaveBeenCalledWith('agent-1')
  })

  it('creates a new session for the hovered agent row', () => {
    const onCreateSession = vi.fn()

    render(
      <AgentResourceList
        activeAgentId="agent-1"
        agentSessionsSource={createAgentSessionsSource()}
        onSelectSession={vi.fn()}
        onCreateSession={onCreateSession}
        onShowMissingAgentSelection={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'agent.session.new' }))

    expect(onCreateSession).toHaveBeenCalledWith('agent-1')
  })

  it('lets the classic agent rail switch icon display mode from the context menu', () => {
    render(
      <AgentResourceList
        activeAgentId="agent-1"
        agentSessionsSource={createAgentSessionsSource()}
        onSelectSession={vi.fn()}
        onCreateSession={vi.fn()}
        onShowMissingAgentSelection={vi.fn()}
      />
    )

    expect(screen.getByTestId('agent-1-context-menu')).toHaveTextContent('agent.icon.type')

    fireEvent.click(screen.getAllByRole('button', { name: 'settings.assistant.icon.type.none' })[0])

    expect(preferenceMocks.setPreference).toHaveBeenCalledWith('agent.icon_type', 'none')
  })

  it('lets the classic agent rail switch back to the workdir session view', async () => {
    render(
      <AgentResourceList
        activeAgentId="agent-1"
        agentSessionsSource={createAgentSessionsSource()}
        onSelectSession={vi.fn()}
        onCreateSession={vi.fn()}
        onShowMissingAgentSelection={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'agent.session.display.workdir' }))

    await waitFor(() => {
      expect(preferenceMocks.setPreference).toHaveBeenCalledWith('agent.session.display_mode', 'workdir')
    })
  })

  it('clears the active agent selection while a resource view is active', () => {
    render(
      <AgentResourceList
        activeAgentId="agent-1"
        agentSessionsSource={createAgentSessionsSource()}
        manageAgentsActive
        onManageAgents={vi.fn()}
        onSelectSession={vi.fn()}
        onCreateSession={vi.fn()}
        onShowMissingAgentSelection={vi.fn()}
      />
    )

    expect(screen.getByTestId('resource-entity-rail')).toHaveAttribute('data-selected-id', '')
  })

  it('keeps classic agent rail history in the shared display menu without section toggles', async () => {
    const onOpenHistoryRecords = vi.fn()

    render(
      <AgentResourceList
        activeAgentId="agent-1"
        agentSessionsSource={createAgentSessionsSource()}
        onOpenHistoryRecords={onOpenHistoryRecords}
        onSelectSession={vi.fn()}
        onCreateSession={vi.fn()}
        onShowMissingAgentSelection={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'history.records.shortTitle' }))

    // Selection is deferred until after the menu closes (runAfterMenuClose → setTimeout).
    await waitFor(() => expect(onOpenHistoryRecords).toHaveBeenCalledTimes(1))
    expect(screen.queryByText('agent.session.group.expand_all')).not.toBeInTheDocument()
    expect(screen.queryByText('agent.session.group.collapse_all')).not.toBeInTheDocument()
  })
})
