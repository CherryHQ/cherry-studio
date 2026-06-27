import type { ResolvedAction } from '@renderer/components/chat/actions/actionTypes'
import type { ResourceEntityRailItem } from '@renderer/components/chat/resources/variants/ResourceEntityRail'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AgentResourceList } from '../AgentResourceList'
import { AssistantResourceList } from '../AssistantResourceList'

const assistantDataMocks = vi.hoisted(() => ({
  deleteAssistant: vi.fn(),
  deleteTopicsByAssistantId: vi.fn(),
  refreshTopics: vi.fn(),
  refetchAssistants: vi.fn()
}))

const agentDataMocks = vi.hoisted(() => ({
  deleteAgent: vi.fn(),
  deleteAgentSessions: vi.fn(),
  refetchAgents: vi.fn()
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
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

vi.mock('@data/DataApiService', () => ({
  dataApiService: {
    patch: vi.fn()
  }
}))

vi.mock('@renderer/components/chat/panes/Shell', () => ({
  useOptionalShellActions: () => ({
    close: vi.fn()
  })
}))

vi.mock('@renderer/components/EmojiIcon', () => ({
  default: ({ emoji }: { emoji: string }) => <span>{emoji}</span>
}))

vi.mock('@renderer/components/resource/dialogs', () => ({
  ResourceEditDialogHost: () => null
}))

vi.mock('@renderer/components/chat/resources/variants/useResourceEntityRail', () => ({
  useResourceEntityRail: ({ entities }: { entities: ResourceEntityRailItem[] }) => ({
    handleReorder: vi.fn(),
    handleSelect: vi.fn(),
    items: entities,
    listStatus: 'idle',
    selectedId: null
  })
}))

vi.mock('@renderer/components/chat/resources/variants/ResourceEntityRail', () => ({
  ResourceEntityRail: ({
    createItemLabel,
    getContextMenuActions,
    items,
    onContextMenuAction,
    onCreateItem
  }: {
    createItemLabel?: string
    getContextMenuActions?: (item: ResourceEntityRailItem) => readonly ResolvedAction[]
    items: readonly ResourceEntityRailItem[]
    onContextMenuAction?: (item: ResourceEntityRailItem, action: ResolvedAction) => void | Promise<void>
    onCreateItem?: (item: ResourceEntityRailItem) => void | Promise<void>
  }) => (
    <div>
      {items.map((item) => {
        const actions = getContextMenuActions?.(item) ?? []

        return (
          <section key={item.id} aria-label={item.name}>
            <div data-testid={`${item.id}-context-menu`}>
              {actions.map((action) => (
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
              {actions.map((action) => (
                <button
                  key={`more-${action.id}`}
                  type="button"
                  disabled={!action.availability.enabled}
                  onClick={() => onContextMenuAction?.(item, action)}>
                  {action.label}
                </button>
              ))}
            </div>
            {createItemLabel && onCreateItem ? (
              <button type="button" onClick={() => onCreateItem(item)}>
                {createItemLabel}
              </button>
            ) : null}
          </section>
        )
      })}
    </div>
  )
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
    topics: [{ id: 'topic-1', assistantId: 'assistant-1', name: 'Topic 1' }]
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
        emoji: 'A'
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
        configuration: {}
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
    trigger:
      path === '/agents/:agentId'
        ? agentDataMocks.deleteAgent
        : path === '/agents/:agentId/sessions'
          ? agentDataMocks.deleteAgentSessions
          : vi.fn()
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

describe('old layout entity resource list actions', () => {
  beforeEach(() => {
    assistantDataMocks.deleteAssistant.mockResolvedValue(undefined)
    assistantDataMocks.deleteTopicsByAssistantId.mockResolvedValue({ deletedCount: 1, deletedIds: ['topic-1'] })
    assistantDataMocks.refreshTopics.mockResolvedValue(undefined)
    assistantDataMocks.refetchAssistants.mockResolvedValue(undefined)
    agentDataMocks.deleteAgent.mockResolvedValue(undefined)
    agentDataMocks.deleteAgentSessions.mockResolvedValue({ deletedIds: ['session-1'] })
    agentDataMocks.refetchAgents.mockResolvedValue(undefined)

    window.modal = {
      confirm: vi.fn().mockResolvedValue(true)
    } as unknown as typeof window.modal
    window.toast = {
      error: vi.fn(),
      success: vi.fn()
    } as unknown as typeof window.toast
  })

  it('uses delete-assistant actions for the old layout assistant context and more menus', async () => {
    render(
      <AssistantResourceList activeAssistantId="assistant-1" onSelectTopic={vi.fn()} onStartDraftAssistant={vi.fn()} />
    )

    expect(screen.getByTestId('assistant-1-context-menu')).toHaveTextContent('assistants.delete.title')
    expect(screen.getByTestId('assistant-1-more-menu')).toHaveTextContent('assistants.delete.title')
    expect(screen.getByTestId('assistant-1-context-menu')).not.toHaveTextContent('assistants.clear.menu_title')
    expect(screen.getByTestId('assistant-1-more-menu')).not.toHaveTextContent('assistants.clear.menu_title')
    expect(screen.queryByRole('button', { name: 'chat.conversation.new' })).not.toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('button', { name: 'assistants.delete.title' })[0])

    await waitFor(() =>
      expect(window.modal.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'assistants.delete.title' }))
    )
    await waitFor(() => expect(assistantDataMocks.deleteTopicsByAssistantId).toHaveBeenCalledWith('assistant-1'))
    await waitFor(() => expect(assistantDataMocks.deleteAssistant).toHaveBeenCalledWith('assistant-1'))
    expect(assistantDataMocks.deleteTopicsByAssistantId.mock.invocationCallOrder[0]).toBeLessThan(
      assistantDataMocks.deleteAssistant.mock.invocationCallOrder[0]
    )
  })

  it('uses delete-agent actions for the old layout agent context and more menus', async () => {
    render(<AgentResourceList activeAgentId="agent-1" onSelectSession={vi.fn()} onStartDraftAgent={vi.fn()} />)

    expect(screen.getByTestId('agent-1-context-menu')).toHaveTextContent('agent.delete.title')
    expect(screen.getByTestId('agent-1-more-menu')).toHaveTextContent('agent.delete.title')
    expect(screen.getByTestId('agent-1-context-menu')).not.toHaveTextContent('agent.session.agent.delete.trigger')
    expect(screen.getByTestId('agent-1-more-menu')).not.toHaveTextContent('agent.session.agent.delete.trigger')
    expect(screen.queryByRole('button', { name: 'chat.conversation.new' })).not.toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('button', { name: 'agent.delete.title' })[0])

    await waitFor(() =>
      expect(window.modal.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'agent.delete.title' }))
    )
    await waitFor(() =>
      expect(agentDataMocks.deleteAgentSessions).toHaveBeenCalledWith({ params: { agentId: 'agent-1' } })
    )
    await waitFor(() => expect(agentDataMocks.deleteAgent).toHaveBeenCalledWith({ params: { agentId: 'agent-1' } }))
    expect(agentDataMocks.deleteAgentSessions.mock.invocationCallOrder[0]).toBeLessThan(
      agentDataMocks.deleteAgent.mock.invocationCallOrder[0]
    )
  })
})
