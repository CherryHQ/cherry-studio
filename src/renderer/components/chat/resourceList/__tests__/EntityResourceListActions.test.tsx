import type { ResolvedAction } from '@renderer/components/chat/actions/actionTypes'
import type { ResourceEntityRailItem } from '@renderer/components/chat/resourceList/ResourceEntityRail'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
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
  MenuDivider: () => <hr />,
  MenuList: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
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
      key === 'topic.tab.display_mode' ? 'assistant' : key === 'agent.session.display_mode' ? 'agent' : undefined

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
  useResourceEntityRail: ({ entities }: { entities: ResourceEntityRailItem[] }) => ({
    handleReorder: vi.fn(),
    handleSelect: vi.fn(),
    items: entities,
    listStatus: 'idle',
    selectedId: null
  })
}))

vi.mock('@renderer/components/chat/resourceList/ResourceEntityRail', () => ({
  ResourceEntityRail: ({
    getContextMenuActions,
    groupByTag,
    headerActions,
    items,
    onContextMenuAction,
    onReorder
  }: {
    getContextMenuActions?: (item: ResourceEntityRailItem) => readonly ResolvedAction[]
    groupByTag?: boolean
    headerActions?: ReactNode
    items: readonly ResourceEntityRailItem[]
    onContextMenuAction?: (item: ResourceEntityRailItem, action: ResolvedAction) => void | Promise<void>
    onReorder?: unknown
  }) => {
    const flattenActions = (actions: readonly ResolvedAction[]): readonly ResolvedAction[] =>
      actions.flatMap((action) => [action, ...flattenActions(action.children)])

    return (
      <div
        data-testid="resource-entity-rail"
        data-group-by-tag={String(!!groupByTag)}
        data-reorder={onReorder ? 'enabled' : 'disabled'}>
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
            </section>
          )
        })}
      </div>
    )
  }
}))

vi.mock('@renderer/hooks/resourceViewSources', () => ({
  useAgentSessionsSource: () => ({
    error: null,
    isFullyLoaded: true,
    isLoading: false,
    isLoadingAll: false,
    isPinsLoading: false,
    pinIdBySessionId: new Set(),
    reload: vi.fn(),
    sessions: [{ id: 'session-1', agentId: 'agent-1', name: 'Session 1' }]
  }),
  useAssistantTopicsSource: () => ({
    error: null,
    isFullyLoaded: true,
    isLoadingAll: false,
    topics: assistantDataMocks.topics
  })
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

vi.mock('@renderer/hooks/agent/useAgent', () => ({
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

vi.mock('@renderer/pages/home/Tabs/components/topicsHelpers', () => ({
  sortTopicsForDisplayGroups: (topics: unknown[]) => topics
}))

vi.mock('@renderer/pages/agents/components/sessionListHelpers', () => ({
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
    assistantDataMocks.deleteAssistant.mockResolvedValue(undefined)
    assistantDataMocks.deleteAssistant.mockClear()
    assistantDataMocks.refreshTopics.mockResolvedValue(undefined)
    assistantDataMocks.refreshTopics.mockClear()
    assistantDataMocks.refetchAssistants.mockResolvedValue(undefined)
    assistantDataMocks.refetchAssistants.mockClear()
    agentDataMocks.deleteAgent.mockResolvedValue(undefined)
    agentDataMocks.deleteAgent.mockClear()
    agentDataMocks.refetchAgents.mockResolvedValue(undefined)
    agentDataMocks.refetchAgents.mockClear()

    window.modal = {
      confirm: vi.fn().mockResolvedValue(true),
      success: vi.fn()
    } as unknown as typeof window.modal
    window.toast = {
      error: vi.fn(),
      success: vi.fn()
    } as unknown as typeof window.toast
  })

  it('uses delete-assistant actions for the classic layout assistant context and more menus', async () => {
    const onStartDraftAssistant = vi.fn()
    const onActiveAssistantDeleted = vi.fn()

    render(
      <AssistantResourceList
        activeAssistantId="assistant-1"
        onSelectTopic={vi.fn()}
        onStartDraftAssistant={onStartDraftAssistant}
        onActiveAssistantDeleted={onActiveAssistantDeleted}
      />
    )

    expect(screen.getByTestId('assistant-1-context-menu')).toHaveTextContent('assistants.delete.title')
    expect(screen.getByTestId('assistant-1-more-menu')).toHaveTextContent('assistants.delete.title')
    expect(screen.getByTestId('assistant-1-context-menu')).toHaveTextContent('assistants.clear.menu_title')
    expect(screen.getByTestId('assistant-1-more-menu')).toHaveTextContent('assistants.clear.menu_title')

    fireEvent.click(screen.getAllByRole('button', { name: 'assistants.delete.title' })[0])

    await waitFor(() =>
      expect(window.modal.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'assistants.delete.title' }))
    )
    await waitFor(() =>
      expect(assistantDataMocks.deleteAssistant).toHaveBeenCalledWith('assistant-1', { deleteTopics: true })
    )
    // Classic layout resets via the dedicated callback (page settles to the latest
    // remaining topic) and must NOT open the modern layout draft compose.
    await waitFor(() => expect(onActiveAssistantDeleted).toHaveBeenCalledWith('assistant-1'))
    expect(onStartDraftAssistant).not.toHaveBeenCalled()
  })

  it('clears assistant topics from the classic layout assistant context menu', async () => {
    const onSelectTopic = vi.fn()
    const onCreateTopicAfterClear = vi.fn()

    render(
      <AssistantResourceList
        activeAssistantId="assistant-1"
        onSelectTopic={onSelectTopic}
        onCreateTopicAfterClear={onCreateTopicAfterClear}
        onStartDraftAssistant={vi.fn()}
      />
    )

    fireEvent.click(
      within(screen.getByTestId('assistant-1-context-menu')).getByRole('button', {
        name: 'assistants.clear.menu_title'
      })
    )

    await waitFor(() =>
      expect(window.modal.confirm).toHaveBeenCalledWith(
        expect.objectContaining({
          content: 'assistants.clear.content',
          title: 'assistants.clear.title'
        })
      )
    )
    await waitFor(() => expect(assistantDataMocks.deleteTopicsByAssistantId).toHaveBeenCalledWith('assistant-1'))
    await waitFor(() => expect(assistantDataMocks.refreshTopics).toHaveBeenCalledTimes(1))
    expect(onCreateTopicAfterClear).toHaveBeenCalledWith('assistant-1')
    expect(onSelectTopic).not.toHaveBeenCalled()
    expect(window.toast.success).toHaveBeenCalledWith('assistants.clear.success_title:1')
    expect(window.modal.success).not.toHaveBeenCalled()
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
    window.modal.confirm = vi.fn().mockReturnValue(confirmPromise)
    const onCreateTopicAfterClear = vi.fn()

    const props = {
      activeAssistantId: 'assistant-1',
      onSelectTopic: vi.fn(),
      onCreateTopicAfterClear,
      onStartDraftAssistant: vi.fn()
    }
    const { rerender } = render(<AssistantResourceList {...props} />)

    fireEvent.click(
      within(screen.getByTestId('assistant-1-context-menu')).getByRole('button', {
        name: 'assistants.clear.menu_title'
      })
    )
    await waitFor(() => expect(window.modal.confirm).toHaveBeenCalledTimes(1))

    // While the confirm dialog is open the topic list drains (e.g. cleared elsewhere).
    // Re-render so the rail sees the latest topics before the user confirms.
    assistantDataMocks.topics = [{ id: 'topic-2', assistantId: 'assistant-2', name: 'Topic 2' }]
    rerender(<AssistantResourceList {...props} />)

    await act(async () => {
      resolveConfirm(true)
      await confirmPromise
    })

    expect(assistantDataMocks.deleteTopicsByAssistantId).not.toHaveBeenCalled()
    expect(assistantDataMocks.refreshTopics).not.toHaveBeenCalled()
    expect(onCreateTopicAfterClear).not.toHaveBeenCalled()
    expect(window.toast.success).not.toHaveBeenCalled()
  })

  it('keeps the default assistant visible in the classic assistant rail', () => {
    assistantDataMocks.topics = [
      { id: 'topic-default', name: 'Default topic' },
      { id: 'topic-1', assistantId: 'assistant-1', name: 'Topic 1' }
    ]

    render(<AssistantResourceList activeAssistantId={null} onSelectTopic={vi.fn()} onStartDraftAssistant={vi.fn()} />)

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
  })

  it('creates a fresh topic after clearing the only classic assistant topics', async () => {
    assistantDataMocks.topics = [{ id: 'topic-2', assistantId: 'assistant-2', name: 'Topic 2' }]
    assistantDataMocks.deleteTopicsByAssistantId.mockResolvedValueOnce({ deletedIds: ['topic-2'], deletedCount: 1 })
    const onCreateTopicAfterClear = vi.fn()

    render(
      <AssistantResourceList
        activeAssistantId="assistant-2"
        onSelectTopic={vi.fn()}
        onCreateTopicAfterClear={onCreateTopicAfterClear}
        onStartDraftAssistant={vi.fn()}
      />
    )

    fireEvent.click(
      within(screen.getByTestId('assistant-2-context-menu')).getByRole('button', {
        name: 'assistants.clear.menu_title'
      })
    )

    await waitFor(() => expect(window.modal.confirm).toHaveBeenCalled())
    await waitFor(() => expect(assistantDataMocks.deleteTopicsByAssistantId).toHaveBeenCalledWith('assistant-2'))
    await waitFor(() => expect(assistantDataMocks.refreshTopics).toHaveBeenCalledTimes(1))
    expect(onCreateTopicAfterClear).toHaveBeenCalledWith('assistant-2')
    expect(window.toast.error).not.toHaveBeenCalled()
  })

  it('disables classic assistant rail reorder while grouping by tag', () => {
    const props = { activeAssistantId: 'assistant-1', onSelectTopic: vi.fn(), onStartDraftAssistant: vi.fn() }

    preferenceMocks.sortType = 'list'
    const { rerender } = render(<AssistantResourceList {...props} />)
    const railInList = screen.getByTestId('resource-entity-rail')
    expect(railInList).toHaveAttribute('data-group-by-tag', 'false')
    expect(railInList).toHaveAttribute('data-reorder', 'enabled')

    // Reorder persists the global assistant orderKey, so it must be disabled under tag
    // grouping to avoid moving assistants across unrelated tags in the global order.
    preferenceMocks.sortType = 'tags'
    rerender(<AssistantResourceList {...props} />)
    const railInTags = screen.getByTestId('resource-entity-rail')
    expect(railInTags).toHaveAttribute('data-group-by-tag', 'true')
    expect(railInTags).toHaveAttribute('data-reorder', 'disabled')
  })

  it('toggles assistant tag grouping from the context menu (list → tags)', () => {
    render(
      <AssistantResourceList activeAssistantId="assistant-1" onSelectTopic={vi.fn()} onStartDraftAssistant={vi.fn()} />
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
      <AssistantResourceList activeAssistantId="assistant-1" onSelectTopic={vi.fn()} onStartDraftAssistant={vi.fn()} />
    )

    expect(screen.getByTestId('assistant-1-context-menu')).toHaveTextContent('assistants.icon.type')

    fireEvent.click(screen.getAllByRole('button', { name: 'settings.assistant.icon.type.model' })[0])

    expect(preferenceMocks.setPreference).toHaveBeenCalledWith('assistant.icon_type', 'model')
  })

  it('offers turning tag grouping off when already grouping (tags → list)', () => {
    preferenceMocks.sortType = 'tags'

    render(
      <AssistantResourceList activeAssistantId="assistant-1" onSelectTopic={vi.fn()} onStartDraftAssistant={vi.fn()} />
    )

    expect(screen.getByTestId('assistant-1-context-menu')).toHaveTextContent('assistants.tags.ungroup')

    fireEvent.click(screen.getAllByRole('button', { name: 'assistants.tags.ungroup' })[0])
    expect(preferenceMocks.setSortType).toHaveBeenCalledWith('list')
  })

  it('lets the classic assistant rail switch back to the time topic view', async () => {
    render(
      <AssistantResourceList activeAssistantId="assistant-1" onSelectTopic={vi.fn()} onStartDraftAssistant={vi.fn()} />
    )

    fireEvent.click(screen.getByRole('button', { name: 'chat.topics.display.time' }))

    await waitFor(() => {
      expect(preferenceMocks.setPreference).toHaveBeenCalledWith('topic.tab.display_mode', 'time')
    })
  })

  it('keeps classic assistant rail history in the shared display menu', () => {
    const onOpenHistoryRecords = vi.fn()

    render(
      <AssistantResourceList
        activeAssistantId="assistant-1"
        onOpenHistoryRecords={onOpenHistoryRecords}
        onSelectTopic={vi.fn()}
        onStartDraftAssistant={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'history.records.shortTitle' }))

    expect(onOpenHistoryRecords).toHaveBeenCalledTimes(1)
  })

  it('uses delete-agent actions for the classic layout agent context and more menus', async () => {
    const onStartMissingAgentDraft = vi.fn()
    const onActiveAgentDeleted = vi.fn()

    render(
      <AgentResourceList
        activeAgentId="agent-1"
        onSelectSession={vi.fn()}
        onStartDraftAgent={vi.fn()}
        onStartMissingAgentDraft={onStartMissingAgentDraft}
        onActiveAgentDeleted={onActiveAgentDeleted}
      />
    )

    expect(screen.getByTestId('agent-1-context-menu')).toHaveTextContent('agent.delete.title')
    expect(screen.getByTestId('agent-1-more-menu')).toHaveTextContent('agent.delete.title')
    expect(screen.getByTestId('agent-1-context-menu')).not.toHaveTextContent('agent.session.agent.delete.trigger')
    expect(screen.getByTestId('agent-1-more-menu')).not.toHaveTextContent('agent.session.agent.delete.trigger')

    fireEvent.click(screen.getAllByRole('button', { name: 'agent.delete.title' })[0])

    await waitFor(() =>
      expect(window.modal.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'agent.delete.title' }))
    )
    await waitFor(() =>
      expect(agentDataMocks.deleteAgent).toHaveBeenCalledWith({
        params: { agentId: 'agent-1' },
        query: { deleteSessions: true }
      })
    )
    // Classic layout resets via the dedicated callback, never the draft compose.
    await waitFor(() => expect(onActiveAgentDeleted).toHaveBeenCalledWith('agent-1'))
    expect(onStartMissingAgentDraft).not.toHaveBeenCalled()
  })

  it('lets the classic agent rail switch icon display mode from the context menu', () => {
    render(
      <AgentResourceList
        activeAgentId="agent-1"
        onSelectSession={vi.fn()}
        onStartDraftAgent={vi.fn()}
        onStartMissingAgentDraft={vi.fn()}
      />
    )

    expect(screen.getByTestId('agent-1-context-menu')).toHaveTextContent('agent.icon.type')

    fireEvent.click(screen.getAllByRole('button', { name: 'settings.assistant.icon.type.none' })[0])

    expect(preferenceMocks.setPreference).toHaveBeenCalledWith('assistant.icon_type', 'none')
  })

  it('lets the classic agent rail switch back to the workdir session view', async () => {
    render(
      <AgentResourceList
        activeAgentId="agent-1"
        onSelectSession={vi.fn()}
        onStartDraftAgent={vi.fn()}
        onStartMissingAgentDraft={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'agent.session.display.workdir' }))

    await waitFor(() => {
      expect(preferenceMocks.setPreference).toHaveBeenCalledWith('agent.session.display_mode', 'workdir')
    })
  })

  it('passes skill management entries into the classic agent rail display menu', () => {
    const onManageSkills = vi.fn()

    render(
      <AgentResourceList
        activeAgentId="agent-1"
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
        onStartDraftAgent={vi.fn()}
        onStartMissingAgentDraft={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'agent.skill.manage.title' }))

    expect(onManageSkills).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'agent.manage.title' })).toBeInTheDocument()
  })

  it('keeps classic agent rail history in the shared display menu without section toggles', () => {
    const onOpenHistoryRecords = vi.fn()

    render(
      <AgentResourceList
        activeAgentId="agent-1"
        onOpenHistoryRecords={onOpenHistoryRecords}
        onSelectSession={vi.fn()}
        onStartDraftAgent={vi.fn()}
        onStartMissingAgentDraft={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'history.records.shortTitle' }))

    expect(onOpenHistoryRecords).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('agent.session.group.expand_all')).not.toBeInTheDocument()
    expect(screen.queryByText('agent.session.group.collapse_all')).not.toBeInTheDocument()
  })
})
