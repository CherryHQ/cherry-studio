import type { ResolvedAction } from '@renderer/components/chat/actions/actionTypes'
import type { ResourceEntityRailItem } from '@renderer/components/chat/resourceList/ResourceEntityRail'
import type * as UseAgentModule from '@renderer/hooks/agent/useAgent'
import type { AgentSessionsSource, AssistantTopicsSource } from '@renderer/hooks/resourceViewSources'
import { popup } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ComponentProps, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AgentResourceList } from '../AgentResourceList'
import { AssistantResourceList } from '../AssistantResourceList'

const assistantDataMocks = vi.hoisted(() => ({
  deleteTopicsByAssistantId: vi.fn(),
  deleteAssistant: vi.fn(),
  refreshTopics: vi.fn(),
  refetchAssistants: vi.fn(),
  topics: [
    { id: 'topic-1', assistantId: 'assistant-1', name: 'Topic 1' },
    { id: 'topic-2', assistantId: 'assistant-2', name: 'Topic 2' }
  ] as Array<{ id: string; assistantId?: string; name: string }>
}))

const agentDataMocks = vi.hoisted(() => ({
  deleteAgent: vi.fn(),
  refetchAgents: vi.fn()
}))

const preferenceMocks = vi.hoisted(() => ({
  setPreference: vi.fn(),
  sortType: 'list' as 'list' | 'tags',
  setSortType: vi.fn(),
  values: new Map<string, unknown>()
}))

vi.mock('@cherrystudio/ui', () => ({
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
    withContext: () => ({
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn()
    })
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
    getContextMenuActions,
    groupByTag,
    headerActions,
    items,
    onContextMenuAction,
    onReorder,
    resourceMenuItems,
    selectedId
  }: {
    getContextMenuActions?: (item: ResourceEntityRailItem) => readonly ResolvedAction[]
    groupByTag?: boolean
    headerActions?: ReactNode
    items: readonly ResourceEntityRailItem[]
    onContextMenuAction?: (item: ResourceEntityRailItem, action: ResolvedAction) => void | Promise<void>
    onReorder?: unknown
    resourceMenuItems?: readonly { active?: boolean; id: string }[]
    selectedId?: string | null
  }) => {
    const flattenActions = (actions: readonly ResolvedAction[]): readonly ResolvedAction[] =>
      actions.flatMap((action) => [action, ...flattenActions(action.children)])
    const hasActiveResourceMenuItem = resourceMenuItems?.some((item) => item.active) ?? false

    return (
      <div
        data-testid="resource-entity-rail"
        data-active-resource-menu={String(hasActiveResourceMenuItem)}
        data-group-by-tag={String(!!groupByTag)}
        data-reorder={onReorder ? 'enabled' : 'disabled'}
        data-selected-id={selectedId ?? ''}>
        {headerActions}
        {items.map((item) => {
          const actions = getContextMenuActions?.(item) ?? []
          const renderedActions = flattenActions(actions)

          return (
            <section key={item.id} aria-label={item.name}>
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
    isLoading: false,
    refetch: assistantDataMocks.refetchAssistants
  })
}))

vi.mock('@renderer/hooks/agent/useAgent', async (importOriginal) => ({
  // Keep the real useDeleteAgent so it registers its mutation (and refresh
  // contract) through the mocked useMutation below.
  ...(await importOriginal<typeof UseAgentModule>()),
  useAgents: () => ({
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
    togglePin: vi.fn()
  })
}))

function createAgentSessionsSource(): AgentSessionsSource {
  return {
    createSession: vi.fn(),
    deleteSession: vi.fn(),
    deleteSessions: vi.fn(),
    error: null,
    hasMore: false,
    isFullyLoaded: true,
    isLoading: false,
    isLoadingAll: false,
    isLoadingMore: false,
    isPinsLoading: false,
    isValidating: false,
    loadMore: vi.fn(),
    pinIdBySessionId: new Map(),
    reload: vi.fn(),
    reorderSession: vi.fn(),
    reorderSessions: vi.fn(),
    sessions: [{ id: 'session-1', agentId: 'agent-1', name: 'Session 1' }],
    togglePin: vi.fn(),
    total: 1
  } as unknown as AgentSessionsSource
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
    isStatsLoading: false,
    statsError: null,
    refetchStats: vi.fn(),
    loadLatestTopic: vi.fn().mockResolvedValue(null),
    loadTopicSeedCandidates: vi.fn().mockResolvedValue([])
  } as unknown as AssistantTopicsSource
}

function TestAssistantResourceList({
  assistantTopicsSource = createAssistantTopicsSource(),
  ...props
}: Omit<ComponentProps<typeof AssistantResourceList>, 'assistantTopicsSource'> & {
  assistantTopicsSource?: AssistantTopicsSource
}) {
  return <AssistantResourceList assistantTopicsSource={assistantTopicsSource} {...props} />
}

vi.mock('@renderer/hooks/useTopic', () => ({
  mapApiTopicToRendererTopic: (topic: unknown) => topic,
  useTopicMutations: () => ({
    deleteTopicsByAssistantId: assistantDataMocks.deleteTopicsByAssistantId,
    refreshTopics: assistantDataMocks.refreshTopics
  })
}))

vi.mock('@renderer/data/hooks/useDataApi', () => ({
  useMutation: (_method: string, path: string) => ({
    trigger: path === '/agents/:agentId' ? agentDataMocks.deleteAgent : vi.fn()
  })
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
    assistantDataMocks.refreshTopics.mockResolvedValue(undefined)
    assistantDataMocks.refreshTopics.mockClear()
    assistantDataMocks.refetchAssistants.mockResolvedValue(undefined)
    assistantDataMocks.refetchAssistants.mockClear()
    agentDataMocks.deleteAgent.mockResolvedValue({ deleted: true, deletedSessionIds: [] })
    agentDataMocks.deleteAgent.mockClear()
    agentDataMocks.refetchAgents.mockResolvedValue(undefined)
    agentDataMocks.refetchAgents.mockClear()
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
    const onClearActiveTopic = vi.fn()

    render(
      <TestAssistantResourceList
        activeAssistantId="assistant-1"
        onSelectTopic={onSelectTopic}
        onClearActiveTopic={onClearActiveTopic}
        onCreateTopic={vi.fn()}
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
    await waitFor(() => expect(assistantDataMocks.refreshTopics).toHaveBeenCalledTimes(1))
    expect(onClearActiveTopic).toHaveBeenCalledWith('assistant-1')
    expect(onSelectTopic).not.toHaveBeenCalled()
    expect(toast.success).toHaveBeenCalledWith('assistants.clear.success_title:1')
  })

  it('does not clear assistant topics when the list empties while the confirm dialog is open', async () => {
    assistantDataMocks.topics = [
      { id: 'topic-1', assistantId: 'assistant-1', name: 'Topic 1' },
      { id: 'topic-2', assistantId: 'assistant-2', name: 'Topic 2' }
    ]
    let resolveConfirm!: (value: boolean) => void
    const confirmPromise = new Promise<boolean>((resolve) => {
      resolveConfirm = resolve
    })
    vi.mocked(popup.confirm).mockReturnValue(confirmPromise)
    const onClearActiveTopic = vi.fn()

    const props = {
      activeAssistantId: 'assistant-1',
      onSelectTopic: vi.fn(),
      onClearActiveTopic,
      onCreateTopic: vi.fn()
    }
    const { rerender } = render(<TestAssistantResourceList {...props} />)

    fireEvent.click(
      within(screen.getByTestId('assistant-1-context-menu')).getByRole('button', {
        name: 'assistants.clear.menu_title'
      })
    )
    await waitFor(() => expect(popup.confirm).toHaveBeenCalledTimes(1))

    // While the confirm dialog is open the topic list drains (e.g. cleared elsewhere).
    // Re-render so the rail sees the latest topics before the user confirms.
    assistantDataMocks.topics = [{ id: 'topic-2', assistantId: 'assistant-2', name: 'Topic 2' }]
    rerender(<TestAssistantResourceList {...props} />)

    await act(async () => {
      resolveConfirm(true)
      await confirmPromise
    })

    expect(assistantDataMocks.deleteTopicsByAssistantId).not.toHaveBeenCalled()
    expect(assistantDataMocks.refreshTopics).not.toHaveBeenCalled()
    expect(onClearActiveTopic).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('keeps the default assistant visible in the classic assistant rail without a create action', () => {
    assistantDataMocks.topics = [
      { id: 'topic-default', name: 'Default topic' },
      { id: 'topic-1', assistantId: 'assistant-1', name: 'Topic 1' }
    ]
    const onCreateTopic = vi.fn()

    render(<TestAssistantResourceList activeAssistantId={null} onSelectTopic={vi.fn()} onCreateTopic={onCreateTopic} />)

    const defaultAssistantRegion = screen.getByRole('region', { name: 'chat.default.name' })
    const assistantRegion = screen.getByRole('region', { name: 'Assistant 1' })

    expect(defaultAssistantRegion).toBeInTheDocument()
    expect(assistantRegion).toBeInTheDocument()
    expect(
      assistantRegion.compareDocumentPosition(defaultAssistantRegion) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(screen.getByTestId('assistant-entity:default-context-menu')).not.toHaveTextContent('assistants.edit.title')
    expect(screen.getByTestId('assistant-entity:default-context-menu')).not.toHaveTextContent('assistants.delete.title')
    expect(screen.getByTestId('assistant-entity:default-context-menu')).not.toHaveTextContent(
      'assistants.clear.menu_title'
    )

    // The default group is a display-only bucket for legacy assistant-less topics: no "new topic"
    // action, since a null-assistant create can't reuse an empty placeholder and would stack blanks.
    expect(within(defaultAssistantRegion).queryByRole('button', { name: 'chat.conversation.new' })).toBeNull()
  })

  it('clears the active topic after clearing the only classic assistant topics', async () => {
    assistantDataMocks.topics = [{ id: 'topic-2', assistantId: 'assistant-2', name: 'Topic 2' }]
    assistantDataMocks.deleteTopicsByAssistantId.mockResolvedValueOnce({ deletedIds: ['topic-2'], deletedCount: 1 })
    const onClearActiveTopic = vi.fn()

    render(
      <TestAssistantResourceList
        activeAssistantId="assistant-2"
        onSelectTopic={vi.fn()}
        onClearActiveTopic={onClearActiveTopic}
        onCreateTopic={vi.fn()}
      />
    )

    fireEvent.click(
      within(screen.getByTestId('assistant-2-context-menu')).getByRole('button', {
        name: 'assistants.clear.menu_title'
      })
    )

    await waitFor(() => expect(popup.confirm).toHaveBeenCalled())
    await waitFor(() => expect(assistantDataMocks.deleteTopicsByAssistantId).toHaveBeenCalledWith('assistant-2'))
    await waitFor(() => expect(assistantDataMocks.refreshTopics).toHaveBeenCalledTimes(1))
    expect(onClearActiveTopic).toHaveBeenCalledWith('assistant-2')
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('disables classic assistant rail reorder while grouping by tag', () => {
    const props = { activeAssistantId: 'assistant-1', onSelectTopic: vi.fn(), onCreateTopic: vi.fn() }

    preferenceMocks.sortType = 'list'
    const { rerender } = render(<TestAssistantResourceList {...props} />)
    const railInList = screen.getByTestId('resource-entity-rail')
    expect(railInList).toHaveAttribute('data-group-by-tag', 'false')
    expect(railInList).toHaveAttribute('data-reorder', 'enabled')

    // Reorder persists the global assistant orderKey, so it must be disabled under tag
    // grouping to avoid moving assistants across unrelated tags in the global order.
    preferenceMocks.sortType = 'tags'
    rerender(<TestAssistantResourceList {...props} />)
    const railInTags = screen.getByTestId('resource-entity-rail')
    expect(railInTags).toHaveAttribute('data-group-by-tag', 'true')
    expect(railInTags).toHaveAttribute('data-reorder', 'disabled')
  })

  it('toggles assistant tag grouping from the context menu (list → tags)', () => {
    render(
      <TestAssistantResourceList activeAssistantId="assistant-1" onSelectTopic={vi.fn()} onCreateTopic={vi.fn()} />
    )

    // sort_type === 'list' → the menu offers "group by tag".
    const menu = screen.getByTestId('assistant-1-context-menu')
    expect(menu).toHaveTextContent('assistants.tags.group_by')
    expect(menu).not.toHaveTextContent('assistants.tags.ungroup')

    fireEvent.click(screen.getAllByRole('button', { name: 'assistants.tags.group_by' })[0])
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

    expect(screen.getByTestId('assistant-1-context-menu')).toHaveTextContent('assistants.tags.ungroup')

    fireEvent.click(screen.getAllByRole('button', { name: 'assistants.tags.ungroup' })[0])
    expect(preferenceMocks.setSortType).toHaveBeenCalledWith('list')
  })

  it('lets the classic assistant rail switch back to the time topic view', async () => {
    render(
      <TestAssistantResourceList activeAssistantId="assistant-1" onSelectTopic={vi.fn()} onCreateTopic={vi.fn()} />
    )

    fireEvent.click(screen.getByRole('menuitemradio', { name: 'chat.topics.display.time' }))

    await waitFor(() => {
      expect(preferenceMocks.setPreference).toHaveBeenCalledWith('topic.tab.display_mode', 'time')
    })
  })

  it('persists topic sorting from the classic assistant rail menu', async () => {
    render(
      <TestAssistantResourceList activeAssistantId="assistant-1" onSelectTopic={vi.fn()} onCreateTopic={vi.fn()} />
    )

    fireEvent.click(screen.getByRole('menuitemradio', { name: 'common.sort.updated_at' }))

    await waitFor(() => {
      expect(preferenceMocks.setPreference).toHaveBeenCalledWith('topic.sort_type', 'updatedAt')
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
        resourceMenuItems={[
          {
            active: true,
            id: 'assistant-resource-view',
            label: 'Manage assistants',
            onSelect: onManageAssistants
          }
        ]}
        onSelectTopic={vi.fn()}
        onCreateTopic={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'assistants.presets.manage.title' }))

    // Selection is deferred until after the menu closes (runAfterMenuClose → setTimeout).
    await waitFor(() => expect(onManageAssistants).toHaveBeenCalledTimes(1))
    expect(screen.getByTestId('resource-entity-rail')).toHaveAttribute('data-active-resource-menu', 'false')
    expect(screen.getByTestId('resource-entity-rail')).toHaveAttribute('data-selected-id', '')
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
    // Classic layout resets via the dedicated callback, never the draft compose.
    await waitFor(() => expect(onActiveAgentDeleted).toHaveBeenCalledWith('agent-1'))
    expect(onShowMissingAgentSelection).not.toHaveBeenCalled()
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

    // Display-mode options render as radio items (role="menuitemradio"), not plain buttons.
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'agent.session.display.workdir' }))

    await waitFor(() => {
      expect(preferenceMocks.setPreference).toHaveBeenCalledWith('agent.session.display_mode', 'workdir')
    })
  })

  it('persists session sorting from the classic agent rail menu', async () => {
    render(
      <AgentResourceList
        activeAgentId="agent-1"
        agentSessionsSource={createAgentSessionsSource()}
        onSelectSession={vi.fn()}
        onCreateSession={vi.fn()}
        onShowMissingAgentSelection={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('menuitemradio', { name: 'common.sort.updated_at' }))

    await waitFor(() => {
      expect(preferenceMocks.setPreference).toHaveBeenCalledWith('agent.session.sort_type', 'updatedAt')
    })
  })

  it('passes skill management entries into the classic agent rail display menu', async () => {
    const onManageSkills = vi.fn()

    render(
      <AgentResourceList
        activeAgentId="agent-1"
        agentSessionsSource={createAgentSessionsSource()}
        resourceMenuItems={[
          {
            id: 'agent-resource-view',
            label: 'Manage agents',
            onSelect: vi.fn()
          },
          {
            id: 'skill-resource-view',
            label: 'Manage skills',
            onSelect: onManageSkills
          }
        ]}
        onSelectSession={vi.fn()}
        onCreateSession={vi.fn()}
        onShowMissingAgentSelection={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'agent.skill.manage.title' }))

    // Selection is deferred until after the menu closes (runAfterMenuClose → setTimeout).
    await waitFor(() => expect(onManageSkills).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('button', { name: 'agent.manage.title' })).toBeInTheDocument()
  })

  it('clears the active agent selection while a resource view is active', () => {
    render(
      <AgentResourceList
        activeAgentId="agent-1"
        agentSessionsSource={createAgentSessionsSource()}
        resourceMenuItems={[
          {
            active: true,
            id: 'agent-resource-view',
            label: 'Manage agents',
            onSelect: vi.fn()
          }
        ]}
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
