import type { ResolvedAction } from '@renderer/components/chat/actions/actionTypes'
import type { ResourceEntityRailItem } from '@renderer/components/chat/resourceList/ResourceEntityRail'
import type { AgentSessionsSource, AssistantTopicsSource } from '@renderer/hooks/resourceViewSources'
import { popup } from '@renderer/services/popup'
import type * as RecycleBinFeedback from '@renderer/services/recycleBinFeedback'
import { toast } from '@renderer/services/toast'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import { MockUseCacheUtils } from '@test-mocks/renderer/useCache'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AgentResourceList } from '../AgentResourceList'
import { AssistantResourceList } from '../AssistantResourceList'

const assistantDataMocks = vi.hoisted(() => ({
  deleteTopicsByAssistantId: vi.fn(),
  deleteAssistant: vi.fn(),
  restoreAssistant: vi.fn(),
  restoreTopic: vi.fn(),
  refreshTopics: vi.fn(),
  refetchAssistants: vi.fn(),
  topics: [
    { id: 'topic-1', assistantId: 'assistant-1', name: 'Topic 1' },
    { id: 'topic-2', assistantId: 'assistant-2', name: 'Topic 2' }
  ] as Array<{ id: string; assistantId?: string; name: string }>
}))

const agentDataMocks = vi.hoisted(() => ({
  getActiveResource: vi.fn(),
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
  restoreAgent: vi.fn(),
  restoreSession: vi.fn(),
  toggleAgentPin: vi.fn()
}))

const recycleBinFeedbackMocks = vi.hoisted(() => ({
  showRecycleBinBatchUndo: vi.fn(),
  showRecycleBinUndo: vi.fn()
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
  Popover: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  PopoverContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children?: ReactNode }) => <>{children}</>
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
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
      key === 'topic.tab.display_mode' ? 'assistant' : key === 'agent.session.display_mode' ? 'agent' : undefined

    return [
      preferenceMocks.values.get(key) ?? defaultValue,
      (value: unknown) => {
        preferenceMocks.values.set(key, value)
        preferenceMocks.setPreference(key, value)
        // Mutations through useSidebarFavorites call `.catch` on the returned
        // promise; resolve so those toggle paths do not throw.
        return Promise.resolve()
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
    deleteAssistant: assistantDataMocks.deleteAssistant,
    restoreAssistant: assistantDataMocks.restoreAssistant
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

vi.mock('@renderer/data/DataApiService', () => ({
  dataApiService: { get: agentDataMocks.getActiveResource }
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
    loadLatestSession: vi.fn().mockResolvedValue(null),
    reuseOrCreateSession: vi.fn(),
    loadMore: vi.fn(),
    pinIdBySessionId: new Map(),
    reload: vi.fn(),
    reorderSession: vi.fn(),
    reorderSessions: vi.fn(),
    sessions: [{ id: 'session-1', agentId: 'agent-1', name: 'Session 1' }],
    togglePin: vi.fn(),
    total: 1,
    ...overrides
  } as unknown as AgentSessionsSource
}

function createAssistantTopicsSource(overrides: Partial<AssistantTopicsSource> = {}): AssistantTopicsSource {
  return {
    error: null,
    hasNext: false,
    isFullyLoaded: true,
    isLoading: false,
    isLoadingAll: false,
    isRefreshing: false,
    loadNext: vi.fn(),
    mutate: vi.fn(),
    pages: [],
    refetch: vi.fn(),
    loadLatestTopic: vi.fn().mockResolvedValue(null),
    reuseOrCreateTopic: vi.fn(),
    topics: assistantDataMocks.topics,
    // The mocked mapApiTopicToRendererTopic is the identity, so the shared
    // renderer view is the same list.
    rendererTopics: assistantDataMocks.topics,
    orderSignature: '',
    ...overrides
  } as unknown as AssistantTopicsSource
}

function TestAssistantResourceList({
  assistantTopicsSource = createAssistantTopicsSource(),
  onClearActiveTopic = vi.fn(),
  ...props
}: Omit<ComponentProps<typeof AssistantResourceList>, 'assistantTopicsSource' | 'onClearActiveTopic'> & {
  assistantTopicsSource?: AssistantTopicsSource
  onClearActiveTopic?: ComponentProps<typeof AssistantResourceList>['onClearActiveTopic']
}) {
  return (
    <AssistantResourceList
      assistantTopicsSource={assistantTopicsSource}
      onClearActiveTopic={onClearActiveTopic}
      {...props}
    />
  )
}

vi.mock('@renderer/hooks/useTopic', () => ({
  mapApiTopicToRendererTopic: (topic: unknown) => topic,
  useTopicMutations: () => ({
    deleteTopicsByAssistantId: assistantDataMocks.deleteTopicsByAssistantId,
    refreshTopics: assistantDataMocks.refreshTopics,
    restoreTopic: assistantDataMocks.restoreTopic
  })
}))

vi.mock('@renderer/data/hooks/useDataApi', () => ({
  useInvalidateCache: () => agentDataMocks.invalidate,
  useMutation: (method: string, path: string) => ({
    trigger:
      method === 'POST' && path === '/agents/:agentId/restore'
        ? agentDataMocks.restoreAgent
        : method === 'POST' && path === '/agent-sessions/:sessionId/restore'
          ? agentDataMocks.restoreSession
          : vi.fn()
  })
}))

vi.mock('@renderer/services/recycleBinFeedback', async (importOriginal) => ({
  ...(await importOriginal<typeof RecycleBinFeedback>()),
  ...recycleBinFeedbackMocks
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
  formatErrorMessageWithPrefix: (_error: unknown, prefix: string) => prefix,
  getErrorMessage: (error: unknown) => (error instanceof Error ? error.message : String(error))
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
    assistantDataMocks.restoreAssistant.mockResolvedValue(undefined)
    assistantDataMocks.restoreAssistant.mockClear()
    assistantDataMocks.restoreTopic.mockResolvedValue(undefined)
    assistantDataMocks.restoreTopic.mockClear()
    assistantDataMocks.refreshTopics.mockResolvedValue(undefined)
    assistantDataMocks.refreshTopics.mockClear()
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
    agentDataMocks.restoreAgent.mockResolvedValue(undefined)
    agentDataMocks.restoreAgent.mockClear()
    agentDataMocks.restoreSession.mockResolvedValue(undefined)
    agentDataMocks.restoreSession.mockClear()
    agentDataMocks.getActiveResource.mockResolvedValue({ id: 'active-resource' })
    agentDataMocks.getActiveResource.mockClear()
    agentDataMocks.toggleAgentPin.mockResolvedValue(undefined)
    agentDataMocks.toggleAgentPin.mockClear()
    tabsContextMocks.closeConversationTabs.mockClear()
    loggerMocks.error.mockClear()
    loggerMocks.info.mockClear()
    loggerMocks.warn.mockClear()
    vi.mocked(toast.error).mockClear()
    vi.mocked(toast.info).mockClear()
    vi.mocked(toast.success).mockClear()
    recycleBinFeedbackMocks.showRecycleBinBatchUndo.mockClear()
    recycleBinFeedbackMocks.showRecycleBinUndo.mockClear()
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
      expect(popup.confirm).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'recycle_bin.move.confirm_title',
          okText: 'recycle_bin.move.confirm_action'
        })
      )
    )
    expect(vi.mocked(popup.confirm).mock.calls.at(-1)?.[0]).not.toHaveProperty('content')
    await waitFor(() =>
      expect(assistantDataMocks.deleteAssistant).toHaveBeenCalledWith('assistant-1', { deleteTopics: true })
    )
    // Classic layout resets via the dedicated callback (page settles to the latest
    // remaining topic) and must NOT open the modern layout draft compose.
    await waitFor(() => expect(onActiveAssistantDeleted).toHaveBeenCalledWith('assistant-1'))
    expect(onCreateTopic).not.toHaveBeenCalled()
    expect(recycleBinFeedbackMocks.showRecycleBinUndo).toHaveBeenCalledWith({
      itemName: 'Assistant 1',
      onUndo: expect.any(Function)
    })

    await recycleBinFeedbackMocks.showRecycleBinUndo.mock.calls.at(-1)?.[0].onUndo()

    expect(assistantDataMocks.restoreAssistant).toHaveBeenCalledWith('assistant-1')
    expect(assistantDataMocks.refetchAssistants).toHaveBeenCalled()
    expect(assistantDataMocks.refreshTopics).toHaveBeenCalled()
  })

  it.each(['selection reconciliation', 'Assistant refresh', 'Topic refresh'] as const)(
    'offers Assistant Undo when post-delete %s fails',
    async (failureStage) => {
      const onActiveAssistantDeleted = vi.fn().mockResolvedValue(undefined)
      if (failureStage === 'selection reconciliation') {
        onActiveAssistantDeleted.mockRejectedValueOnce(new Error('selection failed'))
      } else if (failureStage === 'Assistant refresh') {
        assistantDataMocks.refetchAssistants.mockRejectedValueOnce(new Error('Assistant refresh failed'))
      } else {
        assistantDataMocks.refreshTopics.mockRejectedValueOnce(new Error('Topic refresh failed'))
      }

      render(
        <TestAssistantResourceList
          activeAssistantId="assistant-1"
          onSelectTopic={vi.fn()}
          onCreateTopic={vi.fn()}
          onActiveAssistantDeleted={onActiveAssistantDeleted}
        />
      )

      fireEvent.click(screen.getAllByRole('button', { name: 'assistants.delete.title' })[0])

      await waitFor(() => expect(recycleBinFeedbackMocks.showRecycleBinUndo).toHaveBeenCalled())
      expect(assistantDataMocks.refetchAssistants).toHaveBeenCalled()
      expect(assistantDataMocks.refreshTopics).toHaveBeenCalled()
      expect(loggerMocks.warn).toHaveBeenCalled()
      expect(toast.error).not.toHaveBeenCalled()
    }
  )

  it('does not fail Assistant Undo when restore succeeds but follow-up refreshes reject', async () => {
    assistantDataMocks.refetchAssistants
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('restore Assistant refresh failed'))
    assistantDataMocks.refreshTopics
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('restore Topic refresh failed'))

    render(
      <TestAssistantResourceList activeAssistantId="assistant-1" onSelectTopic={vi.fn()} onCreateTopic={vi.fn()} />
    )
    fireEvent.click(screen.getAllByRole('button', { name: 'assistants.delete.title' })[0])
    await waitFor(() => expect(recycleBinFeedbackMocks.showRecycleBinUndo).toHaveBeenCalled())

    await expect(recycleBinFeedbackMocks.showRecycleBinUndo.mock.calls.at(-1)?.[0].onUndo()).resolves.toBeUndefined()

    expect(assistantDataMocks.restoreAssistant).toHaveBeenCalledWith('assistant-1')
    expect(loggerMocks.warn).toHaveBeenCalled()
  })

  it('treats Assistant restore NOT_FOUND as complete only after refresh confirms the Assistant is active', async () => {
    assistantDataMocks.restoreAssistant.mockRejectedValueOnce(DataApiErrorFactory.notFound('Assistant', 'assistant-1'))

    render(
      <TestAssistantResourceList activeAssistantId="assistant-1" onSelectTopic={vi.fn()} onCreateTopic={vi.fn()} />
    )
    fireEvent.click(screen.getAllByRole('button', { name: 'assistants.delete.title' })[0])
    await waitFor(() => expect(recycleBinFeedbackMocks.showRecycleBinUndo).toHaveBeenCalled())

    await expect(recycleBinFeedbackMocks.showRecycleBinUndo.mock.calls.at(-1)?.[0].onUndo()).resolves.toBeUndefined()

    expect(agentDataMocks.getActiveResource).toHaveBeenCalledWith('/assistants/assistant-1')
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
    const nextTopic = { id: 'topic-2', assistantId: 'assistant-2', name: 'Topic 2' }
    const assistantTopicsSource = createAssistantTopicsSource({
      loadLatestTopic: vi.fn().mockResolvedValue(nextTopic)
    })

    render(
      <TestAssistantResourceList
        activeAssistantId="assistant-1"
        assistantTopicsSource={assistantTopicsSource}
        onSelectTopic={onSelectTopic}
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
          okText: 'recycle_bin.move.confirm_action',
          title: 'recycle_bin.move.confirm_title'
        })
      )
    )
    expect(vi.mocked(popup.confirm).mock.calls.at(-1)?.[0]).not.toHaveProperty('content')
    await waitFor(() => expect(assistantDataMocks.deleteTopicsByAssistantId).toHaveBeenCalledWith('assistant-1'))
    await waitFor(() => expect(assistantDataMocks.refreshTopics).toHaveBeenCalledTimes(1))
    expect(onSelectTopic).toHaveBeenCalledWith(nextTopic)
    expect(recycleBinFeedbackMocks.showRecycleBinBatchUndo).toHaveBeenCalledWith({
      itemCount: 1,
      onUndo: expect.any(Function)
    })
    expect(toast.success).not.toHaveBeenCalled()

    await recycleBinFeedbackMocks.showRecycleBinBatchUndo.mock.calls.at(-1)?.[0].onUndo()
    expect(assistantDataMocks.restoreTopic).toHaveBeenCalledExactlyOnceWith('topic-1')
  })

  it('offers Topic Undo when post-delete refresh and active reconciliation fail', async () => {
    assistantDataMocks.refreshTopics.mockRejectedValueOnce(new Error('refresh failed'))
    const assistantTopicsSource = createAssistantTopicsSource({
      loadLatestTopic: vi.fn().mockRejectedValue(new Error('selection failed'))
    })

    render(
      <TestAssistantResourceList
        activeAssistantId="assistant-1"
        assistantTopicsSource={assistantTopicsSource}
        onSelectTopic={vi.fn()}
        onCreateTopic={vi.fn()}
      />
    )

    fireEvent.click(
      within(screen.getByTestId('assistant-1-context-menu')).getByRole('button', {
        name: 'assistants.clear.menu_title'
      })
    )

    await waitFor(() => expect(recycleBinFeedbackMocks.showRecycleBinBatchUndo).toHaveBeenCalledTimes(1))
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('reports already moved when clearing Assistant Topics changes no rows', async () => {
    assistantDataMocks.deleteTopicsByAssistantId.mockResolvedValueOnce({ deletedIds: [], deletedCount: 0 })

    render(
      <TestAssistantResourceList activeAssistantId="assistant-1" onSelectTopic={vi.fn()} onCreateTopic={vi.fn()} />
    )

    fireEvent.click(
      within(screen.getByTestId('assistant-1-context-menu')).getByRole('button', {
        name: 'assistants.clear.menu_title'
      })
    )

    await waitFor(() => expect(toast.info).toHaveBeenCalledExactlyOnceWith('recycle_bin.already_moved'))
    expect(assistantDataMocks.refreshTopics).toHaveBeenCalledOnce()
    expect(recycleBinFeedbackMocks.showRecycleBinBatchUndo).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
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

    const props = {
      activeAssistantId: 'assistant-1',
      onSelectTopic: vi.fn(),
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
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('keeps assistant-less topics under a non-actionable unlinked assistant entry in the classic rail', () => {
    assistantDataMocks.topics = [
      { id: 'topic-default', name: 'Default topic' },
      { id: 'topic-1', assistantId: 'assistant-1', name: 'Topic 1' }
    ]
    const onCreateTopic = vi.fn()

    render(<TestAssistantResourceList activeAssistantId={null} onSelectTopic={vi.fn()} onCreateTopic={onCreateTopic} />)

    const unlinkedAssistantRegion = screen.getByRole('region', { name: 'chat.topics.group.unknown_assistant' })
    const assistantRegion = screen.getByRole('region', { name: 'Assistant 1' })

    expect(unlinkedAssistantRegion).toBeInTheDocument()
    expect(unlinkedAssistantRegion).toHaveAttribute('title', 'chat.topics.group.unknown_assistant_tip')
    expect(assistantRegion).toBeInTheDocument()
    expect(
      assistantRegion.compareDocumentPosition(unlinkedAssistantRegion) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(screen.getByTestId('assistant-entity:unlinked-context-menu')).toBeEmptyDOMElement()

    expect(within(unlinkedAssistantRegion).queryByRole('button', { name: 'chat.conversation.new' })).toBeNull()
  })

  it('groups dangling assistant topics under the unlinked assistant entry in the classic rail', () => {
    assistantDataMocks.topics = [
      { id: 'topic-unlinked', assistantId: 'missing-assistant', name: 'Unlinked topic' },
      { id: 'topic-1', assistantId: 'assistant-1', name: 'Topic 1' }
    ]

    render(
      <TestAssistantResourceList
        activeAssistantId="missing-assistant"
        onSelectTopic={vi.fn()}
        onCreateTopic={vi.fn()}
      />
    )

    expect(screen.getByRole('region', { name: 'chat.topics.group.unknown_assistant' })).toBeInTheDocument()
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
    expect(onClearActiveTopic).toHaveBeenCalledOnce()
    expect(toast.error).not.toHaveBeenCalled()
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

  it('keeps sortable rail containers mounted while refresh temporarily blocks reorder', () => {
    const { rerender } = render(
      <TestAssistantResourceList
        activeAssistantId="assistant-1"
        assistantTopicsSource={createAssistantTopicsSource({ isRefreshing: true })}
        onSelectTopic={vi.fn()}
        onCreateTopic={vi.fn()}
      />
    )

    expect(screen.getByTestId('resource-entity-rail')).toHaveAttribute('data-sortable-container', 'enabled')
    expect(screen.getByTestId('resource-entity-rail')).toHaveAttribute('data-reorder', 'disabled')

    rerender(
      <AgentResourceList
        activeAgentId="agent-1"
        agentSessionsSource={createAgentSessionsSource({ isValidating: true })}
        onSelectSession={vi.fn()}
        onCreateSession={vi.fn()}
        onShowMissingAgentSelection={vi.fn()}
      />
    )

    expect(screen.getByTestId('resource-entity-rail')).toHaveAttribute('data-sortable-container', 'enabled')
    expect(screen.getByTestId('resource-entity-rail')).toHaveAttribute('data-reorder', 'disabled')
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

  it('keeps classic assistant rail history in the shared display menu', () => {
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

    expect(onOpenHistoryRecords).toHaveBeenCalledTimes(1)
  })

  it('keeps assistant management in the shared display menu without adding a classic rail entry', () => {
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
      expect(popup.confirm).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'recycle_bin.move.confirm_title',
          okText: 'recycle_bin.move.confirm_action'
        })
      )
    )
    expect(vi.mocked(popup.confirm).mock.calls.at(-1)?.[0]).not.toHaveProperty('content')
    await waitFor(() =>
      expect(agentDataMocks.deleteAgent).toHaveBeenCalledWith({
        params: { agentId: 'agent-1' },
        query: { deleteSessions: true }
      })
    )
    // Classic layout resets via the dedicated callback, never the draft compose.
    await waitFor(() => expect(onActiveAgentDeleted).toHaveBeenCalledWith('agent-1'))
    expect(onShowMissingAgentSelection).not.toHaveBeenCalled()
    expect(recycleBinFeedbackMocks.showRecycleBinUndo).toHaveBeenCalledWith({
      itemName: 'Agent 1',
      onUndo: expect.any(Function)
    })

    await recycleBinFeedbackMocks.showRecycleBinUndo.mock.calls.at(-1)?.[0].onUndo()

    expect(agentDataMocks.restoreAgent).toHaveBeenCalledWith({ params: { agentId: 'agent-1' } })
    expect(agentDataMocks.refetchAgents).toHaveBeenCalled()
  })

  it('does not fail Agent Undo when restore succeeds but follow-up refreshes reject', async () => {
    const reload = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('session refresh failed'))
    agentDataMocks.refetchAgents
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('Agent refresh failed'))

    render(
      <AgentResourceList
        activeAgentId="agent-1"
        agentSessionsSource={createAgentSessionsSource({ reload })}
        onSelectSession={vi.fn()}
        onCreateSession={vi.fn()}
        onShowMissingAgentSelection={vi.fn()}
      />
    )
    fireEvent.click(screen.getAllByRole('button', { name: 'agent.delete.title' })[0])
    await waitFor(() => expect(recycleBinFeedbackMocks.showRecycleBinUndo).toHaveBeenCalled())

    await expect(recycleBinFeedbackMocks.showRecycleBinUndo.mock.calls.at(-1)?.[0].onUndo()).resolves.toBeUndefined()

    expect(agentDataMocks.restoreAgent).toHaveBeenCalledWith({ params: { agentId: 'agent-1' } })
    expect(loggerMocks.warn).toHaveBeenCalled()
  })

  it('treats Agent restore NOT_FOUND as complete only after refresh confirms the Agent is active', async () => {
    agentDataMocks.restoreAgent.mockRejectedValueOnce(DataApiErrorFactory.notFound('Agent', 'agent-1'))

    render(
      <AgentResourceList
        activeAgentId="agent-1"
        agentSessionsSource={createAgentSessionsSource()}
        onSelectSession={vi.fn()}
        onCreateSession={vi.fn()}
        onShowMissingAgentSelection={vi.fn()}
      />
    )
    fireEvent.click(screen.getAllByRole('button', { name: 'agent.delete.title' })[0])
    await waitFor(() => expect(recycleBinFeedbackMocks.showRecycleBinUndo).toHaveBeenCalled())

    await expect(recycleBinFeedbackMocks.showRecycleBinUndo.mock.calls.at(-1)?.[0].onUndo()).resolves.toBeUndefined()

    expect(agentDataMocks.getActiveResource).toHaveBeenCalledWith('/agents/agent-1')
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
          title: 'recycle_bin.move.confirm_title',
          okText: 'recycle_bin.move.confirm_action'
        })
      )
    )
    await waitFor(() =>
      expect(agentDataMocks.deleteAgentSessions).toHaveBeenCalledWith({ params: { agentId: 'agent-1' } })
    )
    expect(vi.mocked(popup.confirm).mock.calls.at(-1)?.[0]).not.toHaveProperty('content')
    expect(agentDataMocks.deleteAgent).not.toHaveBeenCalled()
    expect(tabsContextMocks.closeConversationTabs).toHaveBeenCalledWith('agents', ['session-1', 'session-not-loaded'])
    expect(onActiveAgentDeleted).toHaveBeenCalledWith('agent-1')
    expect(recycleBinFeedbackMocks.showRecycleBinBatchUndo).toHaveBeenCalledWith({
      itemCount: 2,
      onUndo: expect.any(Function)
    })

    await expect(recycleBinFeedbackMocks.showRecycleBinBatchUndo.mock.calls.at(-1)?.[0].onUndo()).resolves.toEqual({
      restored: ['session-1', 'session-not-loaded'],
      failed: []
    })
    expect(agentDataMocks.restoreSession).toHaveBeenCalledWith({ params: { sessionId: 'session-1' } })
    expect(agentDataMocks.restoreSession).toHaveBeenCalledWith({ params: { sessionId: 'session-not-loaded' } })
  })

  it('counts active protected Sessions as restored after restore NOT_FOUND and missing Sessions as failed', async () => {
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
    agentDataMocks.deleteAgentSessions.mockResolvedValueOnce({ deletedIds: ['session-active', 'session-purged'] })
    const activeError = DataApiErrorFactory.notFound('Session', 'session-active')
    const purgedError = DataApiErrorFactory.notFound('Session', 'session-purged')
    agentDataMocks.restoreSession.mockRejectedValueOnce(activeError).mockRejectedValueOnce(purgedError)
    agentDataMocks.getActiveResource.mockImplementation((path: string) =>
      path === '/agent-sessions/session-active'
        ? Promise.resolve({ id: 'session-active' })
        : Promise.reject(DataApiErrorFactory.notFound('Session', 'session-purged'))
    )

    render(
      <AgentResourceList
        activeAgentId="agent-1"
        agentSessionsSource={createAgentSessionsSource()}
        onSelectSession={vi.fn()}
        onCreateSession={vi.fn()}
        onShowMissingAgentSelection={vi.fn()}
      />
    )
    fireEvent.click(screen.getAllByRole('button', { name: 'agent.session.agent.delete.trigger' })[0])
    await waitFor(() => expect(recycleBinFeedbackMocks.showRecycleBinBatchUndo).toHaveBeenCalled())

    await expect(recycleBinFeedbackMocks.showRecycleBinBatchUndo.mock.calls.at(-1)?.[0].onUndo()).resolves.toEqual({
      restored: ['session-active'],
      failed: [{ id: 'session-purged', error: purgedError.message }]
    })
  })

  it('refreshes a stale Agent delete without closing tabs, reconciling selection, or offering Undo', async () => {
    const onActiveAgentDeleted = vi.fn()
    agentDataMocks.deleteAgent.mockResolvedValueOnce({ deleted: false, deletedSessionIds: [] })

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

    fireEvent.click(screen.getAllByRole('button', { name: 'agent.delete.title' })[0])

    await waitFor(() => expect(toast.info).toHaveBeenCalledWith('recycle_bin.already_moved'))
    expect(tabsContextMocks.closeConversationTabs).not.toHaveBeenCalled()
    expect(onActiveAgentDeleted).not.toHaveBeenCalled()
    expect(recycleBinFeedbackMocks.showRecycleBinUndo).not.toHaveBeenCalled()
    expect(agentDataMocks.refetchAgents).toHaveBeenCalled()
  })

  it('refreshes an already-moved Assistant without closing tabs, reconciling selection, or offering Undo', async () => {
    const onActiveAssistantDeleted = vi.fn()
    assistantDataMocks.deleteAssistant.mockRejectedValueOnce(DataApiErrorFactory.notFound('Assistant', 'assistant-1'))

    render(
      <TestAssistantResourceList
        activeAssistantId="assistant-1"
        onSelectTopic={vi.fn()}
        onCreateTopic={vi.fn()}
        onActiveAssistantDeleted={onActiveAssistantDeleted}
      />
    )

    fireEvent.click(screen.getAllByRole('button', { name: 'assistants.delete.title' })[0])

    await waitFor(() => expect(toast.info).toHaveBeenCalledWith('recycle_bin.already_moved'))
    expect(tabsContextMocks.closeConversationTabs).not.toHaveBeenCalled()
    expect(onActiveAssistantDeleted).not.toHaveBeenCalled()
    expect(recycleBinFeedbackMocks.showRecycleBinUndo).not.toHaveBeenCalled()
    expect(assistantDataMocks.refetchAssistants).toHaveBeenCalled()
    expect(assistantDataMocks.refreshTopics).toHaveBeenCalled()
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

  it('keeps classic agent rail history in the shared display menu without section toggles', () => {
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

    expect(onOpenHistoryRecords).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('agent.session.group.expand_all')).not.toBeInTheDocument()
    expect(screen.queryByText('agent.session.group.collapse_all')).not.toBeInTheDocument()
  })

  it('offers toggling an agent into the sidebar from the classic rail context menu', () => {
    render(
      <AgentResourceList
        activeAgentId="agent-1"
        agentSessionsSource={createAgentSessionsSource()}
        onSelectSession={vi.fn()}
        onCreateSession={vi.fn()}
        onShowMissingAgentSelection={vi.fn()}
      />
    )

    const menu = screen.getByTestId('agent-1-context-menu')
    expect(menu).toHaveTextContent('launchpad.pin_to_sidebar')
    expect(menu).not.toHaveTextContent('launchpad.unpin_from_sidebar')

    fireEvent.click(within(menu).getByRole('button', { name: 'launchpad.pin_to_sidebar' }))

    expect(preferenceMocks.setPreference).toHaveBeenCalledWith('ui.sidebar.favorites', [
      { type: 'agent', id: 'agent-1' }
    ])
  })

  it('toggles an already-pinned agent out of the sidebar from the classic rail context menu', () => {
    preferenceMocks.values.set('ui.sidebar.favorites', [{ type: 'agent', id: 'agent-1' }])

    render(
      <AgentResourceList
        activeAgentId="agent-1"
        agentSessionsSource={createAgentSessionsSource()}
        onSelectSession={vi.fn()}
        onCreateSession={vi.fn()}
        onShowMissingAgentSelection={vi.fn()}
      />
    )

    const menu = screen.getByTestId('agent-1-context-menu')
    expect(menu).toHaveTextContent('launchpad.unpin_from_sidebar')

    fireEvent.click(within(menu).getByRole('button', { name: 'launchpad.unpin_from_sidebar' }))

    expect(preferenceMocks.setPreference).toHaveBeenCalledWith('ui.sidebar.favorites', [])
  })

  it('offers toggling an assistant into the sidebar from the classic rail context menu', () => {
    render(
      <TestAssistantResourceList activeAssistantId="assistant-1" onSelectTopic={vi.fn()} onCreateTopic={vi.fn()} />
    )

    const menu = screen.getByTestId('assistant-1-context-menu')
    expect(menu).toHaveTextContent('launchpad.pin_to_sidebar')

    fireEvent.click(within(menu).getByRole('button', { name: 'launchpad.pin_to_sidebar' }))

    expect(preferenceMocks.setPreference).toHaveBeenCalledWith('ui.sidebar.favorites', [
      { type: 'assistant', id: 'assistant-1' }
    ])
  })

  it('toggles an already-pinned assistant out of the sidebar from the classic rail context menu', () => {
    preferenceMocks.values.set('ui.sidebar.favorites', [{ type: 'assistant', id: 'assistant-1' }])

    render(
      <TestAssistantResourceList activeAssistantId="assistant-1" onSelectTopic={vi.fn()} onCreateTopic={vi.fn()} />
    )

    const menu = screen.getByTestId('assistant-1-context-menu')
    expect(menu).toHaveTextContent('launchpad.unpin_from_sidebar')

    fireEvent.click(within(menu).getByRole('button', { name: 'launchpad.unpin_from_sidebar' }))

    expect(preferenceMocks.setPreference).toHaveBeenCalledWith('ui.sidebar.favorites', [])
  })
})
