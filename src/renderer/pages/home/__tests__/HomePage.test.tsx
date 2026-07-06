import type * as ChatPrimitives from '@renderer/components/chat/primitives'
import { WindowFrameProvider } from '@renderer/components/chat/shell/WindowFrameContext'
import { useCommandHandler } from '@renderer/hooks/command'
import type { CherryMessagePart } from '@shared/data/types/message'
import { MIN_WINDOW_HEIGHT, SECOND_MIN_WINDOW_WIDTH } from '@shared/utils/window'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import type * as ReactI18nextModule from 'react-i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const initialTopic: Topic = {
  id: 'topic-initial',
  assistantId: 'assistant-1',
  name: 'Initial topic',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  messages: [],
  pinned: false,
  isNameManuallyEdited: false
}

const historyTopic: Topic = {
  id: 'topic-history',
  assistantId: 'assistant-1',
  name: 'History topic',
  createdAt: '2026-01-02T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
  messages: [],
  pinned: false,
  isNameManuallyEdited: false
}

const createdTopic: Topic = {
  id: 'topic-created',
  assistantId: 'assistant-2',
  name: '',
  createdAt: '2026-01-03T00:00:00.000Z',
  updatedAt: '2026-01-03T00:00:00.000Z',
  messages: [],
  pinned: false,
  isNameManuallyEdited: false
}

const homeMocks = vi.hoisted(() => ({
  activeTopicOptions: undefined as
    | {
        passive?: boolean
        activeTopicId?: string | null
        initialTopic?: Topic
        setActiveTopicId?: (id: string | null) => void
      }
    | undefined,
  cacheSetPersist: vi.fn(),
  addAssistant: vi.fn(),
  createTopic: vi.fn(),
  classicLayoutTopics: [] as Array<{
    id: string
    assistantId?: string
    name: string
    createdAt?: string
    updatedAt: string
  }>,
  currentTab: undefined as { metadata?: Record<string, unknown> } | undefined,
  assistants: [{ id: 'assistant-default' }] as Array<{ id: string; name?: string }>,
  assistantsError: undefined as Error | undefined,
  assistantsLoaded: true,
  assistantsLoading: false,
  assistantsRefreshing: false,
  activeTopicLoading: false,
  activeTopicOverride: undefined as Topic | undefined,
  activeTopicSource: 'query' as 'query' | 'pending' | 'none',
  forceActiveTopicUndefined: false,
  focusExistingTab: vi.fn(() => false),
  locationState: undefined as { topic: Topic } | undefined,
  persistCacheValues: new Map<string, unknown>(),
  preferenceValues: new Map<string, unknown>(),
  refreshTopics: vi.fn(),
  routeSearch: {} as Record<string, unknown>,
  routeTopic: undefined as Topic | undefined,
  routeTopicLoading: false,
  setShowSidebar: vi.fn(),
  isActiveTab: false,
  streamOpen: vi.fn()
}))

// The send path calls ipcApi.request('ai.stream_open', …); route it to homeMocks.streamOpen.
vi.mock('@renderer/ipc', () => ({
  ipcApi: {
    request: (route: string, input: unknown) =>
      route === 'ai.stream_open' ? homeMocks.streamOpen(input) : Promise.resolve(undefined),
    on: () => () => {}
  }
}))

vi.mock('@renderer/hooks/command', () => ({
  useCommandHandler: vi.fn(),
  useResolvedCommand: () => ({
    enabled: true,
    execute: vi.fn(),
    label: 'Toggle sidebar',
    shortcutLabel: ''
  })
}))

vi.mock('@data/hooks/usePreference', async () => {
  const React = await import('react')

  return {
    usePreference: (key: string) => {
      const [value, setValue] = React.useState(() => homeMocks.preferenceValues.get(key))
      const setPreference = vi.fn(async (nextValue: unknown) => {
        homeMocks.preferenceValues.set(key, nextValue)
        if (key === 'topic.tab.show') {
          homeMocks.setShowSidebar(nextValue)
        }
        setValue(nextValue)
      })

      return [value, setPreference]
    }
  }
})

vi.mock('@renderer/data/hooks/useCache', async () => {
  const React = await import('react')

  return {
    usePersistCache: (key: string) => {
      const [value, setValue] = React.useState<unknown>(() => {
        if (homeMocks.persistCacheValues.has(key)) {
          return homeMocks.persistCacheValues.get(key)
        }

        return key === 'ui.chat.right_pane_open' ? true : null
      })
      const setPersistCache = vi.fn((nextValue: unknown) => {
        homeMocks.persistCacheValues.set(key, nextValue)
        homeMocks.cacheSetPersist(key, nextValue)
        setValue(nextValue)
      })

      return [value, setPersistCache]
    }
  }
})

vi.mock('@renderer/components/chat/shell/ChatAppShell', () => ({
  ChatAppShell: ({ centerContent }: { centerContent?: ReactNode }) => (
    <div data-testid="message-only-shell">{centerContent}</div>
  )
}))

vi.mock('@renderer/components/chat/shell/ConversationPageShell', () => ({
  default: ({
    center,
    pane,
    paneOpen,
    topBar
  }: {
    center?: { content?: ReactNode }
    pane?: ReactNode
    paneOpen?: boolean
    topBar?: ReactNode
  }) => (
    <section data-testid="home-conversation-page-shell">
      <output data-testid="pane-open">{String(paneOpen)}</output>
      <div>{topBar}</div>
      <div>{pane}</div>
      <div>{center?.content}</div>
    </section>
  )
}))

vi.mock('@renderer/components/chat/shell/ConversationShell', () => ({
  default: ({
    topBar,
    pane,
    paneOpen,
    center
  }: {
    topBar?: ReactNode
    pane?: ReactNode
    paneOpen?: boolean
    center?: ReactNode
  }) => (
    <section>
      <output data-testid="pane-open">{String(paneOpen)}</output>
      <div>{topBar}</div>
      <div>{pane}</div>
      <div>{center}</div>
    </section>
  )
}))

vi.mock('@renderer/components/chat/shell/ConversationStageCenter', () => ({
  default: ({
    placement,
    composer,
    homeWelcomeText
  }: {
    placement: string
    composer?: ReactNode
    homeWelcomeText?: string
  }) => (
    <div data-placement={placement} data-testid="conversation-stage">
      <output data-testid="welcome-text">{homeWelcomeText ?? ''}</output>
      {composer}
    </div>
  )
}))

vi.mock('@renderer/components/chat/primitives', async (importActual) => ({
  ...(await importActual<typeof ChatPrimitives>()),
  EmptyState: ({ title }: { title?: string }) => <div data-testid="empty-state">{title}</div>,
  LoadingState: ({ label }: { label?: string }) => <div role="status">{label}</div>
}))

vi.mock('@renderer/components/resourceCatalog/catalog', () => ({
  ResourceCatalogView: ({
    onOpenAssistantChat,
    resourceType,
    toolbarLeading
  }: {
    onOpenAssistantChat?: (assistantId: string) => void
    resourceType: string
    toolbarLeading?: ReactNode
  }) => (
    <div data-testid={`resource-catalog-${resourceType}`}>
      {toolbarLeading && <div data-testid="resource-toolbar-leading">{toolbarLeading}</div>}
      {resourceType === 'assistant' && (
        <button type="button" onClick={() => onOpenAssistantChat?.('assistant-2')}>
          Go to chat with assistant 2
        </button>
      )}
    </div>
  )
}))

vi.mock('@renderer/components/composer/variants/ChatComposer', () => ({
  ChatHomePlacementComposer: ({
    assistantId,
    onDraftAssistantChange,
    onCreateEmptyTopic,
    onNewTopic,
    onSend,
    scopeKey
  }: {
    assistantId?: string
    onDraftAssistantChange?: (assistantId: string | null) => void | Promise<void>
    onCreateEmptyTopic?: (payload?: { assistantId?: string | null }) => void | Promise<void>
    onNewTopic?: (payload?: { assistantId?: string | null }) => void | Promise<void>
    onSend: (
      text: string,
      options?: {
        userMessageParts?: CherryMessagePart[]
      }
    ) => void | Promise<void>
    scopeKey: string
  }) => (
    <div data-assistant-id={assistantId ?? ''} data-scope-key={scopeKey} data-testid="draft-composer">
      <button
        type="button"
        onClick={() => onSend('hello', { userMessageParts: [{ type: 'text', text: 'hello' }] as CherryMessagePart[] })}>
        Send draft
      </button>
      <button type="button" onClick={() => onDraftAssistantChange?.('assistant-2')}>
        Switch draft assistant
      </button>
      <button type="button" onClick={() => onNewTopic?.({ assistantId: 'assistant-2' })}>
        New draft with assistant 2
      </button>
      {onCreateEmptyTopic && (
        <button type="button" onClick={() => onCreateEmptyTopic({ assistantId })}>
          Create empty topic from composer
        </button>
      )}
    </div>
  )
}))

vi.mock('@renderer/hooks/tab', () => ({
  useCurrentTab: () => homeMocks.currentTab,
  useCurrentTabId: () => 'chat-tab',
  useIsActiveTab: () => homeMocks.isActiveTab,
  useTabSelfMetadata: vi.fn()
}))

vi.mock('@renderer/hooks/useConversationNavigation', () => ({
  useConversationNavigation: () => ({
    focusExistingTab: homeMocks.focusExistingTab,
    openConversationTab: vi.fn()
  })
}))

vi.mock('@renderer/hooks/useAssistant', () => ({
  useAssistants: () => ({
    assistants: homeMocks.assistants,
    hasLoaded: homeMocks.assistantsLoaded,
    isLoading: homeMocks.assistantsLoading,
    isRefreshing: homeMocks.assistantsRefreshing,
    error: homeMocks.assistantsError,
    refetch: vi.fn(),
    addAssistant: homeMocks.addAssistant,
    removeAssistant: vi.fn(),
    updateAssistant: vi.fn()
  }),
  useAssistantApiById: (id?: string) => ({
    assistant: id ? { id } : undefined,
    isLoading: false,
    error: undefined,
    refetch: vi.fn(),
    mutate: vi.fn()
  })
}))

vi.mock('@renderer/hooks/resourceViewSources', () => ({
  // Match the real useTopics shape: isLoadingAll/isFullyLoaded are always present.
  useAssistantTopicsSource: () => ({
    topics: homeMocks.classicLayoutTopics,
    isLoadingAll: false,
    isFullyLoaded: true
  })
}))

vi.mock('@renderer/hooks/useTopic', async () => {
  const React = await import('react')

  return {
    mapApiTopicToRendererTopic: (topic: Topic) => topic,
    useTopicMutations: () => ({
      createTopic: homeMocks.createTopic,
      refreshTopics: homeMocks.refreshTopics
    }),
    useActiveTopic: (options: {
      initialTopic?: Topic
      activeTopicId: string | null
      setActiveTopicId: (id: string | null) => void
      passive?: boolean
    }) => {
      const [activeTopic, setActiveTopic] = React.useState<Topic | undefined>(options.initialTopic)
      const commitActiveTopicId = options.setActiveTopicId
      const setActiveTopicId = React.useCallback(
        (id: string | null) => {
          if (id === null) {
            homeMocks.activeTopicOverride = undefined
            setActiveTopic(undefined)
          }
          commitActiveTopicId(id)
        },
        [commitActiveTopicId]
      )
      const setActiveTopicValue = React.useCallback((topic: Topic) => {
        homeMocks.activeTopicOverride = topic
        setActiveTopic(topic)
      }, [])
      homeMocks.activeTopicOptions = {
        passive: options.passive,
        activeTopicId: options.activeTopicId,
        initialTopic: options.initialTopic,
        setActiveTopicId
      }
      return {
        activeTopic: homeMocks.forceActiveTopicUndefined ? undefined : (homeMocks.activeTopicOverride ?? activeTopic),
        setActiveTopic: setActiveTopicValue,
        isLoading: homeMocks.activeTopicLoading,
        topicSource: homeMocks.activeTopicSource
      }
    },
    useTopicById: (topicId?: string) => ({
      topic: topicId ? homeMocks.routeTopic : undefined,
      isLoading: homeMocks.routeTopicLoading,
      error: undefined
    })
  }
})

vi.mock('@tanstack/react-router', () => ({
  useLocation: () => ({
    state: homeMocks.locationState
  }),
  useSearch: () => homeMocks.routeSearch
}))

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactI18nextModule>()),
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'chat.home.welcome_title': 'Welcome',
        'chat.topics.title': '对话',
        'common.loading': 'Loading...',
        'history.error.topic_not_found': 'Conversation not found'
      })[key] ?? key
  })
}))

vi.mock('../Chat', () => ({
  default: ({
    activeTopic,
    pane,
    paneOpen,
    showResourceListControls,
    locateMessageId,
    resourcePaneCount,
    onCreateEmptyTopic,
    onNewTopic,
    onLocateMessageHandled,
    onPaneCollapse
  }: {
    activeTopic: Topic
    pane?: ReactNode
    paneOpen?: boolean
    showResourceListControls?: boolean
    locateMessageId?: string
    resourcePaneCount?: { label: string; count: number }
    onCreateEmptyTopic?: (payload?: { assistantId?: string | null }) => void | Promise<void>
    onNewTopic?: (payload?: { assistantId?: string | null }) => void | Promise<void>
    onLocateMessageHandled?: () => void
    onPaneCollapse?: () => void
  }) => (
    <section>
      <output data-testid="active-topic">{activeTopic.id}</output>
      <output data-testid="active-topic-assistant">{activeTopic.assistantId ?? ''}</output>
      <output data-testid="pane-open">{String(paneOpen)}</output>
      <output data-testid="show-resource-list-controls">{String(showResourceListControls)}</output>
      <output data-testid="locate-message-id">{locateMessageId ?? ''}</output>
      {resourcePaneCount && (
        <output data-testid="resource-pane-count">
          {resourcePaneCount.label}:{resourcePaneCount.count}
        </output>
      )}
      {onNewTopic && (
        <button type="button" onClick={() => onNewTopic()}>
          New topic
        </button>
      )}
      {onNewTopic && (
        <button type="button" onClick={() => onNewTopic({ assistantId: 'assistant-2' })}>
          New topic with assistant 2
        </button>
      )}
      {onNewTopic && (
        <button type="button" onClick={() => onNewTopic({ assistantId: 'missing-assistant' })}>
          New topic with missing assistant
        </button>
      )}
      {onCreateEmptyTopic && (
        <button type="button" onClick={() => onCreateEmptyTopic({ assistantId: activeTopic.assistantId })}>
          Create empty topic from composer
        </button>
      )}
      {onLocateMessageHandled && (
        <button type="button" onClick={() => onLocateMessageHandled()}>
          Locate handled
        </button>
      )}
      {onPaneCollapse && (
        <button type="button" onClick={onPaneCollapse}>
          Collapse pane
        </button>
      )}
      {pane}
    </section>
  )
}))

vi.mock('../components/ChatNavbar', () => ({
  default: ({ onSidebarToggle }: { onSidebarToggle?: () => void }) => (
    <nav>
      {onSidebarToggle && (
        <button type="button" onClick={onSidebarToggle}>
          Toggle sidebar
        </button>
      )}
    </nav>
  )
}))

vi.mock('../Tabs/HomeTabs', () => ({
  default: ({ onOpenHistoryRecords, resourceMenuItems, revealRequest }: any) => (
    <div data-reveal-request={JSON.stringify(revealRequest ?? null)} data-testid="home-tabs">
      <button type="button" onClick={() => onOpenHistoryRecords?.()}>
        Open history records
      </button>
      {resourceMenuItems?.map((item: { id: string; label: ReactNode; onSelect: () => void | Promise<void> }) => (
        <button key={item.id} type="button" onClick={() => void item.onSelect()}>
          {item.label}
        </button>
      ))}
    </div>
  )
}))

vi.mock('../Tabs/components/Topics', () => ({
  Topics: ({ assistantIdFilter, presentation }: { assistantIdFilter?: string | null; presentation?: string }) => (
    <div
      data-assistant-id={assistantIdFilter ?? ''}
      data-presentation={presentation ?? ''}
      data-testid="topic-resource-panel"
    />
  )
}))

vi.mock('../components/TopicRightPane', () => {
  const TopicRightPane = Object.assign(
    ({
      children,
      defaultOpen,
      onOpenChange,
      resourcePane
    }: {
      children: ReactNode
      defaultOpen?: boolean
      onOpenChange?: (open: boolean) => void
      resourcePane?: { node?: ReactNode; label?: string } | null
    }) => (
      <div
        data-default-open={String(Boolean(defaultOpen))}
        data-default-tab={resourcePane ? 'resources' : 'branch'}
        data-testid="topic-right-pane-provider">
        {onOpenChange && (
          <button type="button" onClick={() => onOpenChange(false)}>
            Close topic right pane
          </button>
        )}
        {resourcePane?.node}
        {children}
      </div>
    ),
    {
      Host: () => <div data-testid="topic-right-pane-host" />,
      MaximizedOverlay: () => <div data-testid="topic-right-pane-overlay" />,
      Shortcuts: () => <button type="button">Topic right pane shortcuts</button>,
      Toggle: () => <button type="button">Toggle topic right pane</button>
    }
  )

  return { TopicRightPane }
})

vi.mock('@renderer/components/chat/resourceList/AssistantResourceList', () => ({
  AssistantResourceList: ({
    activeAssistantId,
    onAddAssistant,
    onActiveAssistantDeleted,
    resourceMenuItems
  }: {
    activeAssistantId?: string | null
    onAddAssistant?: () => void | Promise<void>
    onActiveAssistantDeleted?: (assistantId: string) => void | Promise<void>
    resourceMenuItems?: Array<{ id: string; label: ReactNode; onSelect: () => void | Promise<void> }>
  }) => (
    <div data-active-assistant-id={activeAssistantId ?? ''} data-testid="assistant-resource-list">
      <button type="button" onClick={() => void onAddAssistant?.()}>
        Open assistant picker
      </button>
      <button type="button" onClick={() => void onActiveAssistantDeleted?.(activeAssistantId ?? '')}>
        Delete active assistant
      </button>
      {resourceMenuItems?.map((item) => (
        <button key={item.id} type="button" onClick={() => void item.onSelect()}>
          {item.label}
        </button>
      ))}
    </div>
  )
}))

vi.mock('../components/AssistantConversationPickerDialog', () => ({
  AssistantConversationPickerDialog: ({ open, onSelect }: { open?: boolean; onSelect?: (selection: any) => void }) =>
    open ? (
      <div data-testid="assistant-conversation-picker">
        <button type="button" onClick={() => onSelect?.({ type: 'assistant', assistantId: 'assistant-2' })}>
          Select my assistant
        </button>
        <button
          type="button"
          onClick={() =>
            onSelect?.({
              type: 'catalog',
              preset: {
                id: 'preset-product',
                name: 'Catalog Preset',
                prompt: 'Preset prompt',
                description: 'Preset description',
                emoji: '📦'
              }
            })
          }>
          Select catalog assistant
        </button>
      </div>
    ) : null
}))

vi.mock('../../history/HistoryRecordsPage', () => ({
  default: ({ open, onRecordSelect }: { open?: boolean; onRecordSelect?: (topic: Topic | null) => void }) =>
    open ? (
      <button type="button" onClick={() => onRecordSelect?.(null)}>
        Clear history selection
      </button>
    ) : null
}))

vi.mock('@renderer/services/EventService', () => ({
  EVENT_NAMES: {
    SHOW_ASSISTANTS: 'SHOW_ASSISTANTS',
    GLOBAL_SEARCH_SELECT_TOPIC: 'GLOBAL_SEARCH_SELECT_TOPIC',
    GLOBAL_SEARCH_SELECT_TOPIC_MESSAGE: 'GLOBAL_SEARCH_SELECT_TOPIC_MESSAGE',
    REVEAL_ACTIVE_RESOURCE_LIST: 'REVEAL_ACTIVE_RESOURCE_LIST'
  },
  EventEmitter: {
    emit: vi.fn(),
    on: vi.fn(() => vi.fn())
  }
}))

import { useTabSelfMetadata } from '@renderer/hooks/tab'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import type { Topic } from '@renderer/types/topic'

import HomePage from '../HomePage'

describe('HomePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    homeMocks.locationState = { topic: initialTopic }
    homeMocks.currentTab = undefined
    homeMocks.assistants = [{ id: 'assistant-default' }]
    homeMocks.classicLayoutTopics = []
    homeMocks.assistantsError = undefined
    homeMocks.assistantsLoaded = true
    homeMocks.assistantsLoading = false
    homeMocks.assistantsRefreshing = false
    homeMocks.routeSearch = {}
    homeMocks.routeTopic = undefined
    homeMocks.routeTopicLoading = false
    homeMocks.activeTopicOptions = undefined
    homeMocks.persistCacheValues.clear()
    homeMocks.focusExistingTab.mockReturnValue(false)
    homeMocks.addAssistant.mockResolvedValue({
      id: 'assistant-created',
      name: 'Catalog Preset'
    })
    homeMocks.isActiveTab = false
    homeMocks.createTopic.mockResolvedValue(createdTopic)
    homeMocks.refreshTopics.mockResolvedValue(undefined)
    homeMocks.streamOpen.mockResolvedValue({ mode: 'started', userMessageId: 'user-created' })
    homeMocks.activeTopicLoading = false
    homeMocks.activeTopicOverride = undefined
    homeMocks.activeTopicSource = 'query'
    homeMocks.forceActiveTopicUndefined = false
    homeMocks.preferenceValues.clear()
    homeMocks.preferenceValues.set('topic.tab.show', false)
    homeMocks.preferenceValues.set('chat.message.style', 'message-style')

    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        window: {
          resetMinimumSize: vi.fn().mockResolvedValue(undefined),
          setMinimumSize: vi.fn().mockResolvedValue(undefined)
        }
      }
    })
  })

  it('renders the assistant resource list with the resource pane open by default', () => {
    homeMocks.preferenceValues.set('topic.layout', 'classic')

    render(<HomePage />)

    expect(screen.getByTestId('topic-right-pane-provider')).toHaveAttribute('data-default-tab', 'resources')
    expect(screen.getByTestId('topic-right-pane-provider')).toHaveAttribute('data-default-open', 'true')
    expect(screen.getByTestId('assistant-resource-list')).toHaveAttribute('data-active-assistant-id', 'assistant-1')
    expect(screen.getByTestId('topic-resource-panel')).toHaveAttribute('data-assistant-id', 'assistant-1')
    expect(screen.getByTestId('topic-resource-panel')).toHaveAttribute('data-presentation', 'right-panel')
    expect(screen.queryByTestId('home-tabs')).not.toBeInTheDocument()
  })

  it('renders the assistant resource view in the chat center', () => {
    render(<HomePage />)

    fireEvent.click(screen.getByRole('button', { name: 'chat.resource_view.menu.assistant' }))

    expect(screen.getByTestId('resource-catalog-assistant')).toBeInTheDocument()
    expect(screen.getByTestId('home-conversation-page-shell')).toBeInTheDocument()
    expect(screen.queryByTestId('active-topic')).not.toBeInTheDocument()
  })

  it('keeps the assistant resource view open while opening the classic-layout assistant picker', () => {
    homeMocks.preferenceValues.set('topic.layout', 'classic')

    render(<HomePage />)

    fireEvent.click(screen.getByRole('button', { name: 'chat.resource_view.menu.assistant' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open assistant picker' }))

    expect(screen.getByTestId('assistant-conversation-picker')).toBeInTheDocument()
    expect(screen.getByTestId('resource-catalog-assistant')).toBeInTheDocument()
    expect(screen.queryByTestId('active-topic')).not.toBeInTheDocument()
  })

  it('keeps the assistant resource view open until the selected assistant topic is ready', async () => {
    homeMocks.preferenceValues.set('topic.layout', 'classic')
    let resolveCreateTopic!: (topic: Topic) => void
    homeMocks.createTopic.mockReturnValue(
      new Promise<Topic>((resolve) => {
        resolveCreateTopic = resolve
      })
    )

    render(<HomePage />)

    fireEvent.click(screen.getByRole('button', { name: 'chat.resource_view.menu.assistant' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open assistant picker' }))
    fireEvent.click(screen.getByRole('button', { name: 'Select my assistant' }))

    await waitFor(() => expect(homeMocks.createTopic).toHaveBeenCalledWith({ assistantId: 'assistant-2' }))
    expect(screen.queryByTestId('assistant-conversation-picker')).not.toBeInTheDocument()
    expect(screen.getByTestId('resource-catalog-assistant')).toBeInTheDocument()
    expect(screen.queryByTestId('active-topic')).not.toBeInTheDocument()

    await act(async () => {
      resolveCreateTopic({ ...createdTopic, assistantId: 'assistant-2' })
      await Promise.resolve()
    })

    await waitFor(() => expect(screen.getByTestId('active-topic')).toHaveTextContent('topic-created'))
    expect(screen.queryByTestId('resource-catalog-assistant')).not.toBeInTheDocument()
  })

  it('keeps a sidebar toggle beside resource search so a collapsed pane can be reopened', async () => {
    homeMocks.preferenceValues.set('topic.tab.show', true)

    render(<HomePage />)

    fireEvent.click(screen.getByRole('button', { name: 'chat.resource_view.menu.assistant' }))

    const shell = screen.getByTestId('home-conversation-page-shell')
    expect(within(shell).getByTestId('pane-open')).toHaveTextContent('true')

    const toolbarLeading = within(shell).getByTestId('resource-toolbar-leading')

    // Collapse the pane from the resource toolbar toggle, then confirm the toggle survives the collapse.
    fireEvent.click(within(toolbarLeading).getByRole('button'))
    await waitFor(() => expect(within(shell).getByTestId('pane-open')).toHaveTextContent('false'))

    fireEvent.click(within(toolbarLeading).getByRole('button'))
    await waitFor(() => expect(within(shell).getByTestId('pane-open')).toHaveTextContent('true'))
  })

  it('starts a modern-layout draft from the inline assistant catalog go-to-chat action', async () => {
    homeMocks.assistants = [{ id: 'assistant-default' }, { id: 'assistant-2' }]

    render(<HomePage />)

    fireEvent.click(screen.getByRole('button', { name: 'chat.resource_view.menu.assistant' }))
    fireEvent.click(screen.getByRole('button', { name: 'Go to chat with assistant 2' }))

    await waitFor(() =>
      expect(screen.getByTestId('draft-composer')).toHaveAttribute('data-assistant-id', 'assistant-2')
    )
    expect(screen.queryByTestId('resource-catalog-assistant')).not.toBeInTheDocument()
    expect(homeMocks.createTopic).not.toHaveBeenCalled()
  })

  it('creates an empty classic-layout topic from the inline assistant catalog go-to-chat action', async () => {
    homeMocks.preferenceValues.set('topic.layout', 'classic')
    homeMocks.assistants = [{ id: 'assistant-default' }, { id: 'assistant-2' }]
    homeMocks.createTopic.mockResolvedValue({ ...createdTopic, assistantId: 'assistant-2' })

    render(<HomePage />)

    fireEvent.click(screen.getByRole('button', { name: 'chat.resource_view.menu.assistant' }))
    fireEvent.click(screen.getByRole('button', { name: 'Go to chat with assistant 2' }))

    await waitFor(() => expect(homeMocks.createTopic).toHaveBeenCalledWith({ assistantId: 'assistant-2' }))
    expect(screen.queryByTestId('resource-catalog-assistant')).not.toBeInTheDocument()
    expect(screen.getByTestId('active-topic')).toHaveTextContent('topic-created')
    expect(screen.getByTestId('active-topic-assistant')).toHaveTextContent('assistant-2')
  })

  it('restores and records the classic-layout topic right pane open state from cache', () => {
    homeMocks.preferenceValues.set('topic.layout', 'classic')
    homeMocks.persistCacheValues.set('ui.chat.right_pane_open', false)

    render(<HomePage />)

    expect(screen.getByTestId('topic-right-pane-provider')).toHaveAttribute('data-default-open', 'false')

    fireEvent.click(screen.getByRole('button', { name: 'Close topic right pane' }))

    expect(homeMocks.cacheSetPersist).toHaveBeenCalledWith('ui.chat.right_pane_open', false)
  })

  it('passes the current assistant topic count to the classic-layout top button', () => {
    homeMocks.preferenceValues.set('topic.layout', 'classic')
    homeMocks.classicLayoutTopics = [
      { ...historyTopic, id: 'topic-a' },
      { ...historyTopic, id: 'topic-b' },
      { ...historyTopic, id: 'topic-other', assistantId: 'assistant-2' }
    ]

    render(<HomePage />)

    expect(screen.getByTestId('resource-pane-count')).toHaveTextContent('对话:2')
    expect(screen.getByTestId('topic-resource-panel')).toHaveAttribute('data-assistant-id', 'assistant-1')
    expect(screen.getByTestId('topic-resource-panel')).toHaveAttribute('data-presentation', 'right-panel')
  })

  it('selects the latest historical topic by default when entering classic layout without a route topic', async () => {
    homeMocks.locationState = undefined
    homeMocks.preferenceValues.set('topic.layout', 'classic')
    homeMocks.classicLayoutTopics = [
      { ...historyTopic, id: 'topic-older', updatedAt: '2026-01-01T00:00:00.000Z' },
      { ...historyTopic, id: 'topic-latest', updatedAt: '2026-01-03T00:00:00.000Z' }
    ]

    render(<HomePage />)

    await waitFor(() => expect(screen.getByTestId('active-topic')).toHaveTextContent('topic-latest'))
    expect(screen.queryByTestId('draft-composer')).not.toBeInTheDocument()
    expect(homeMocks.createTopic).not.toHaveBeenCalled()
  })

  it('selects the latest remaining topic after deleting the active assistant (classic layout, never draft)', async () => {
    homeMocks.locationState = undefined
    homeMocks.preferenceValues.set('topic.layout', 'classic')
    homeMocks.classicLayoutTopics = [
      { ...historyTopic, id: 'topic-a', assistantId: 'assistant-a', updatedAt: '2026-01-05T00:00:00.000Z' },
      { ...historyTopic, id: 'topic-b-old', assistantId: 'assistant-b', updatedAt: '2026-01-01T00:00:00.000Z' },
      { ...historyTopic, id: 'topic-b-new', assistantId: 'assistant-b', updatedAt: '2026-01-03T00:00:00.000Z' }
    ]

    render(<HomePage />)
    // Latest overall (assistant-a) auto-selects on load.
    await waitFor(() => expect(screen.getByTestId('active-topic')).toHaveTextContent('topic-a'))

    fireEvent.click(screen.getByRole('button', { name: 'Delete active assistant' }))

    // Classic layout settles on the latest topic of a remaining assistant, never the draft compose.
    await waitFor(() => expect(screen.getByTestId('active-topic')).toHaveTextContent('topic-b-new'))
    expect(screen.getByTestId('active-topic-assistant')).toHaveTextContent('assistant-b')
    expect(screen.queryByTestId('draft-composer')).not.toBeInTheDocument()
    expect(homeMocks.createTopic).not.toHaveBeenCalled()
  })

  it('creates and activates an empty topic after selecting an existing assistant from the classic-layout picker', async () => {
    homeMocks.preferenceValues.set('topic.layout', 'classic')
    homeMocks.createTopic.mockResolvedValue({ ...createdTopic, assistantId: 'assistant-2' })

    render(<HomePage />)

    fireEvent.click(screen.getByRole('button', { name: 'Open assistant picker' }))
    fireEvent.click(screen.getByRole('button', { name: 'Select my assistant' }))

    await waitFor(() => expect(homeMocks.createTopic).toHaveBeenCalledWith({ assistantId: 'assistant-2' }))
    expect(homeMocks.addAssistant).not.toHaveBeenCalled()
    expect(screen.getByTestId('active-topic')).toHaveTextContent('topic-created')
    expect(screen.getByTestId('active-topic-assistant')).toHaveTextContent('assistant-2')
  })

  it('adds a catalog assistant before creating an empty topic from the classic-layout picker', async () => {
    homeMocks.preferenceValues.set('topic.layout', 'classic')
    homeMocks.createTopic.mockResolvedValue({ ...createdTopic, assistantId: 'assistant-created' })

    render(<HomePage />)

    fireEvent.click(screen.getByRole('button', { name: 'Open assistant picker' }))
    fireEvent.click(screen.getByRole('button', { name: 'Select catalog assistant' }))

    await waitFor(() =>
      expect(homeMocks.addAssistant).toHaveBeenCalledWith({
        name: 'Catalog Preset',
        prompt: 'Preset prompt',
        description: 'Preset description',
        emoji: '📦'
      })
    )
    expect(homeMocks.createTopic).toHaveBeenCalledWith({ assistantId: 'assistant-created' })
    expect(screen.getByTestId('active-topic-assistant')).toHaveTextContent('assistant-created')
  })

  it('reuses an existing assistant whose name matches the catalog preset instead of duplicating it', async () => {
    homeMocks.preferenceValues.set('topic.layout', 'classic')
    homeMocks.assistants = [{ id: 'assistant-default' }, { id: 'assistant-existing', name: 'Catalog Preset' }]
    homeMocks.createTopic.mockResolvedValue({ ...createdTopic, assistantId: 'assistant-existing' })

    render(<HomePage />)

    fireEvent.click(screen.getByRole('button', { name: 'Open assistant picker' }))
    fireEvent.click(screen.getByRole('button', { name: 'Select catalog assistant' }))

    await waitFor(() => expect(homeMocks.createTopic).toHaveBeenCalledWith({ assistantId: 'assistant-existing' }))
    expect(homeMocks.addAssistant).not.toHaveBeenCalled()
    expect(screen.getByTestId('active-topic-assistant')).toHaveTextContent('assistant-existing')
  })

  it('reuses the assistant latest empty topic instead of creating another one in the classic-layout picker', async () => {
    homeMocks.preferenceValues.set('topic.layout', 'classic')
    homeMocks.classicLayoutTopics = [
      {
        id: 'topic-empty-latest',
        assistantId: 'assistant-2',
        name: '',
        createdAt: '2026-01-03T00:00:00.000Z',
        updatedAt: '2026-01-03T00:00:00.000Z'
      },
      // Touched (updatedAt > createdAt) → not an untouched placeholder, never reused.
      {
        id: 'topic-real-older',
        assistantId: 'assistant-2',
        name: 'Real chat',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T01:00:00.000Z'
      }
    ]

    render(<HomePage />)

    fireEvent.click(screen.getByRole('button', { name: 'Open assistant picker' }))
    fireEvent.click(screen.getByRole('button', { name: 'Select my assistant' }))

    await waitFor(() => expect(screen.getByTestId('active-topic')).toHaveTextContent('topic-empty-latest'))
    expect(homeMocks.createTopic).not.toHaveBeenCalled()
  })

  it('reuses the latest empty topic when an older candidate has an invalid timestamp', async () => {
    homeMocks.preferenceValues.set('topic.layout', 'classic')
    homeMocks.classicLayoutTopics = [
      {
        id: 'topic-empty-invalid',
        assistantId: 'assistant-2',
        name: '',
        createdAt: 'not-a-date',
        updatedAt: 'not-a-date'
      },
      {
        id: 'topic-empty-latest',
        assistantId: 'assistant-2',
        name: '',
        createdAt: '2026-01-03T00:00:00.000Z',
        updatedAt: '2026-01-03T00:00:00.000Z'
      }
    ]

    render(<HomePage />)

    fireEvent.click(screen.getByRole('button', { name: 'Open assistant picker' }))
    fireEvent.click(screen.getByRole('button', { name: 'Select my assistant' }))

    await waitFor(() => expect(screen.getByTestId('active-topic')).toHaveTextContent('topic-empty-latest'))
    expect(homeMocks.createTopic).not.toHaveBeenCalled()
  })

  it('reuses the current assistant empty topic from the classic-layout composer button', async () => {
    homeMocks.preferenceValues.set('topic.layout', 'classic')
    homeMocks.assistants = [{ id: 'assistant-1' }, { id: 'assistant-default' }]
    homeMocks.classicLayoutTopics = [
      {
        id: 'topic-empty-latest',
        assistantId: 'assistant-1',
        name: '',
        createdAt: '2026-01-03T00:00:00.000Z',
        updatedAt: '2026-01-03T00:00:00.000Z'
      }
    ]

    render(<HomePage />)

    fireEvent.click(screen.getByRole('button', { name: 'Create empty topic from composer' }))

    await waitFor(() => expect(screen.getByTestId('active-topic')).toHaveTextContent('topic-empty-latest'))
    expect(homeMocks.createTopic).not.toHaveBeenCalled()
    expect(homeMocks.refreshTopics).not.toHaveBeenCalled()
  })

  it('creates and activates a fresh empty topic from the classic-layout composer button when no empty topic exists', async () => {
    homeMocks.preferenceValues.set('topic.layout', 'classic')
    homeMocks.assistants = [{ id: 'assistant-1' }, { id: 'assistant-default' }]
    homeMocks.classicLayoutTopics = [
      {
        id: 'topic-real-latest',
        assistantId: 'assistant-1',
        name: 'Real chat',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-03T00:00:00.000Z'
      }
    ]
    homeMocks.createTopic.mockResolvedValue({
      ...createdTopic,
      id: 'topic-composer-empty',
      assistantId: 'assistant-1'
    })

    render(<HomePage />)

    fireEvent.click(screen.getByRole('button', { name: 'Create empty topic from composer' }))

    await waitFor(() => expect(homeMocks.createTopic).toHaveBeenCalledWith({ assistantId: 'assistant-1' }))
    expect(screen.getByTestId('active-topic')).toHaveTextContent('topic-composer-empty')
    expect(homeMocks.refreshTopics).toHaveBeenCalled()
  })

  it('creates a new topic when the assistant latest topic is chatted-in with a blank name (auto-naming off) in the classic-layout picker', async () => {
    homeMocks.preferenceValues.set('topic.layout', 'classic')
    // Auto-naming off keeps the name blank, but updatedAt has moved past createdAt — this is a real
    // conversation that must NOT be reopened as a reusable empty placeholder (#16434).
    homeMocks.classicLayoutTopics = [
      {
        id: 'topic-chatted-blank',
        assistantId: 'assistant-2',
        name: '',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-03T00:00:00.000Z'
      }
    ]
    homeMocks.createTopic.mockResolvedValue({ ...createdTopic, assistantId: 'assistant-2' })

    render(<HomePage />)

    fireEvent.click(screen.getByRole('button', { name: 'Open assistant picker' }))
    fireEvent.click(screen.getByRole('button', { name: 'Select my assistant' }))

    await waitFor(() => expect(homeMocks.createTopic).toHaveBeenCalledWith({ assistantId: 'assistant-2' }))
  })

  it('ignores a rapid double-click on the classic-layout composer new-topic action', () => {
    homeMocks.preferenceValues.set('topic.layout', 'classic')
    homeMocks.assistants = [{ id: 'assistant-1' }, { id: 'assistant-default' }]
    homeMocks.classicLayoutTopics = []
    // Never resolves: the first create stays in flight so the re-entry guard must drop the second click.
    homeMocks.createTopic.mockReturnValue(new Promise(() => {}))

    render(<HomePage />)

    const button = screen.getByRole('button', { name: 'Create empty topic from composer' })
    fireEvent.click(button)
    fireEvent.click(button)

    expect(homeMocks.createTopic).toHaveBeenCalledTimes(1)
  })

  it('focuses the existing tab instead of duplicating a reused topic already open elsewhere', async () => {
    homeMocks.preferenceValues.set('topic.layout', 'classic')
    homeMocks.focusExistingTab.mockReturnValue(true)
    homeMocks.classicLayoutTopics = [
      {
        id: 'topic-empty-latest',
        assistantId: 'assistant-2',
        name: '',
        createdAt: '2026-01-03T00:00:00.000Z',
        updatedAt: '2026-01-03T00:00:00.000Z'
      }
    ]

    render(<HomePage />)

    fireEvent.click(screen.getByRole('button', { name: 'Open assistant picker' }))
    fireEvent.click(screen.getByRole('button', { name: 'Select my assistant' }))

    // The reused topic is already open in another tab, so we focus it instead of navigating
    // (and duplicating) the current tab.
    await waitFor(() =>
      expect(homeMocks.focusExistingTab).toHaveBeenCalledWith('topic-empty-latest', expect.anything())
    )
    expect(homeMocks.createTopic).not.toHaveBeenCalled()
    expect(screen.queryByTestId('active-topic')?.textContent).not.toBe('topic-empty-latest')
  })

  it('toasts and leaves the active topic untouched when classic-layout picker topic creation fails', async () => {
    homeMocks.preferenceValues.set('topic.layout', 'classic')
    homeMocks.classicLayoutTopics = []
    homeMocks.createTopic.mockRejectedValue(new Error('create failed'))
    const toastError = vi.fn()
    Object.assign(window, { toast: { error: toastError } })

    render(<HomePage />)

    fireEvent.click(screen.getByRole('button', { name: 'Open assistant picker' }))
    fireEvent.click(screen.getByRole('button', { name: 'Select my assistant' }))

    await waitFor(() => expect(homeMocks.createTopic).toHaveBeenCalledWith({ assistantId: 'assistant-2' }))
    await waitFor(() => expect(toastError).toHaveBeenCalled())
    expect(screen.queryByTestId('active-topic')?.textContent).not.toBe('topic-created')
  })

  it('toasts when the classic-layout composer empty-topic creation fails', async () => {
    homeMocks.preferenceValues.set('topic.layout', 'classic')
    homeMocks.assistants = [{ id: 'assistant-1' }, { id: 'assistant-default' }]
    homeMocks.classicLayoutTopics = []
    homeMocks.createTopic.mockRejectedValue(new Error('create failed'))
    const toastError = vi.fn()
    Object.assign(window, { toast: { error: toastError } })

    render(<HomePage />)

    fireEvent.click(screen.getByRole('button', { name: 'Create empty topic from composer' }))

    await waitFor(() => expect(homeMocks.createTopic).toHaveBeenCalled())
    await waitFor(() => expect(toastError).toHaveBeenCalled())
    expect(screen.queryByTestId('active-topic')?.textContent).not.toBe('topic-created')
  })

  it('forwards a reveal request when navigation asks the current chat tab to reveal its selection', async () => {
    render(<HomePage />)

    expect(JSON.parse(screen.getByTestId('home-tabs').getAttribute('data-reveal-request') ?? 'null')).toBeNull()

    const revealHandler = vi
      .mocked(EventEmitter.on)
      .mock.calls.find(([eventName]) => eventName === EVENT_NAMES.REVEAL_ACTIVE_RESOURCE_LIST)?.[1] as
      | ((payload: unknown) => void)
      | undefined

    act(() => {
      revealHandler?.({ source: 'assistants', tabId: 'chat-tab' })
    })

    expect(JSON.parse(screen.getByTestId('home-tabs').getAttribute('data-reveal-request') ?? 'null')).toEqual({
      itemId: 'topic-initial',
      requestId: 1
    })

    await act(async () => {
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
    })

    expect(JSON.parse(screen.getByTestId('home-tabs').getAttribute('data-reveal-request') ?? 'null')).toBeNull()
  })

  it('collapses the topic sidebar when the shared shell requests it', async () => {
    homeMocks.preferenceValues.set('topic.tab.show', true)

    render(<HomePage />)

    expect(screen.getByTestId('pane-open')).toHaveTextContent('true')

    fireEvent.click(screen.getByRole('button', { name: 'Collapse pane' }))

    await waitFor(() => expect(homeMocks.setShowSidebar).toHaveBeenCalledWith(false))
    expect(screen.getByTestId('pane-open')).toHaveTextContent('false')
  })

  it('starts a draft assistant selection when history clears the selected topic', async () => {
    render(<HomePage />)

    fireEvent.click(screen.getByRole('button', { name: 'Open history records' }))
    fireEvent.click(screen.getByRole('button', { name: 'Clear history selection' }))

    await waitFor(() => {
      expect(screen.getByTestId('draft-composer')).toHaveAttribute('data-assistant-id', 'assistant-default')
    })
    expect(screen.queryByTestId('active-topic')).not.toBeInTheDocument()
  })

  it('toggles the left sidebar off with the left sidebar shortcut', () => {
    homeMocks.preferenceValues.set('topic.tab.show', true)

    render(<HomePage />)

    const shortcutHandler = vi
      .mocked(useCommandHandler)
      .mock.calls.find(([command]) => command === 'app.sidebar.toggle')?.[1]

    expect(shortcutHandler).toBeDefined()

    act(() => {
      void shortcutHandler?.()
    })

    expect(homeMocks.setShowSidebar).toHaveBeenCalledWith(false)
  })

  it('removes the topic sidebar entirely in a detached chat window, shortcut included', () => {
    homeMocks.preferenceValues.set('topic.tab.show', true)

    render(
      <WindowFrameProvider value={{ mode: 'window' }}>
        <HomePage />
      </WindowFrameProvider>
    )

    expect(screen.getByTestId('pane-open')).toHaveTextContent('false')
    // Detached windows show no sidebar toggle / new-topic button in the navbar.
    expect(screen.getByTestId('show-resource-list-controls')).toHaveTextContent('false')

    const shortcutHandler = vi
      .mocked(useCommandHandler)
      .mock.calls.find(([command]) => command === 'app.sidebar.toggle')?.[1]

    act(() => {
      void shortcutHandler?.()
    })

    // The sidebar-toggle shortcut is inert in a detached window — the pane stays closed.
    expect(screen.getByTestId('pane-open')).toHaveTextContent('false')
    expect(homeMocks.setShowSidebar).not.toHaveBeenCalled()
  })

  it('uses the compact minimum window width even while the topic sidebar is open', async () => {
    homeMocks.preferenceValues.set('topic.tab.show', true)

    render(<HomePage />)

    await waitFor(() => {
      expect(window.api.window.setMinimumSize).toHaveBeenCalledWith(SECOND_MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT)
    })
  })

  it('keeps a pending locate message when selecting a global-search topic message', async () => {
    render(<HomePage />)

    const topicMessageHandler = vi
      .mocked(EventEmitter.on)
      .mock.calls.find(([eventName]) => eventName === EVENT_NAMES.GLOBAL_SEARCH_SELECT_TOPIC_MESSAGE)?.[1] as
      | ((payload: unknown) => void)
      | undefined

    act(() => {
      topicMessageHandler?.({ topic: historyTopic, messageId: 'message-target' })
    })

    await waitFor(() => expect(screen.getByTestId('active-topic')).toHaveTextContent('topic-history'))
    expect(screen.getByTestId('locate-message-id')).toHaveTextContent('message-target')

    fireEvent.click(screen.getByRole('button', { name: 'Locate handled' }))
    expect(screen.getByTestId('locate-message-id')).toHaveTextContent('')
  })

  it('does not write locate state into the current tab before focusing an already-open topic message', () => {
    homeMocks.locationState = undefined
    homeMocks.focusExistingTab.mockReturnValue(true)

    render(<HomePage />)

    const topicMessageHandler = vi
      .mocked(EventEmitter.on)
      .mock.calls.find(([eventName]) => eventName === EVENT_NAMES.GLOBAL_SEARCH_SELECT_TOPIC_MESSAGE)?.[1] as
      | ((payload: unknown) => void)
      | undefined

    act(() => {
      topicMessageHandler?.({ topic: historyTopic, messageId: 'message-target' })
    })

    expect(homeMocks.focusExistingTab).toHaveBeenCalledWith('topic-history', { excludeTabId: 'chat-tab' })
    expect(screen.getByTestId('draft-composer')).toBeInTheDocument()
    expect(homeMocks.setShowSidebar).not.toHaveBeenCalled()
  })

  it('keeps the current topic visible while the active topic is reloading', async () => {
    const { rerender } = render(<HomePage />)

    await waitFor(() => expect(screen.getByTestId('active-topic')).toHaveTextContent('topic-initial'))

    homeMocks.activeTopicLoading = true
    homeMocks.forceActiveTopicUndefined = true
    rerender(<HomePage />)

    expect(screen.getByTestId('active-topic')).toHaveTextContent('topic-initial')
  })

  it('waits for a cached active topic before starting the first-launch draft', () => {
    homeMocks.locationState = undefined
    homeMocks.activeTopicLoading = true
    homeMocks.forceActiveTopicUndefined = true

    const { rerender } = render(<HomePage />)

    expect(screen.queryByTestId('active-topic')).not.toBeInTheDocument()
    expect(screen.queryByTestId('draft-composer')).not.toBeInTheDocument()

    homeMocks.activeTopicLoading = false
    homeMocks.forceActiveTopicUndefined = false
    homeMocks.activeTopicOverride = initialTopic
    rerender(<HomePage />)

    expect(screen.getByTestId('active-topic')).toHaveTextContent('topic-initial')
    expect(screen.queryByTestId('draft-composer')).not.toBeInTheDocument()
  })

  it('renders a message-only route topic without updating global chat state', () => {
    homeMocks.locationState = undefined
    homeMocks.preferenceValues.set('topic.tab.show', true)
    homeMocks.routeSearch = { topicId: 'topic-message', view: 'message' }
    homeMocks.routeTopic = {
      ...initialTopic,
      id: 'topic-message',
      name: 'Message topic'
    }

    render(<HomePage />)

    expect(screen.getByTestId('active-topic')).toHaveTextContent('topic-message')
    expect(screen.getByTestId('pane-open')).toHaveTextContent('false')
    expect(screen.getByTestId('show-resource-list-controls')).toHaveTextContent('false')
    expect(screen.queryByRole('button', { name: 'New topic' })).not.toBeInTheDocument()
    expect(homeMocks.activeTopicOptions).toMatchObject({
      passive: true,
      activeTopicId: null
    })
    expect(homeMocks.setShowSidebar).not.toHaveBeenCalled()
    expect(homeMocks.cacheSetPersist).not.toHaveBeenCalled()
  })

  it('shows a loading state for a message-only route topic while it is loading', () => {
    homeMocks.locationState = undefined
    homeMocks.routeSearch = { topicId: 'topic-message', view: 'message' }
    homeMocks.routeTopicLoading = true

    render(<HomePage />)

    expect(screen.getByTestId('message-only-shell')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Loading...')
    expect(screen.queryByTestId('active-topic')).not.toBeInTheDocument()
    expect(homeMocks.setShowSidebar).not.toHaveBeenCalled()
  })

  it('shows a not-found state for a missing message-only route topic', () => {
    homeMocks.locationState = undefined
    homeMocks.routeSearch = { topicId: 'topic-message', view: 'message' }

    render(<HomePage />)

    expect(screen.getByTestId('message-only-shell')).toBeInTheDocument()
    expect(screen.getByTestId('empty-state')).toHaveTextContent('Conversation not found')
    expect(screen.queryByTestId('active-topic')).not.toBeInTheDocument()
    expect(homeMocks.setShowSidebar).not.toHaveBeenCalled()
  })

  it('starts the first-launch draft from the remembered assistant', async () => {
    homeMocks.locationState = undefined
    homeMocks.assistants = [{ id: 'assistant-default' }, { id: 'assistant-2' }]
    homeMocks.persistCacheValues.set('ui.chat.last_used_assistant_id', 'assistant-2')

    render(<HomePage />)

    await waitFor(() => {
      expect(screen.getByTestId('draft-composer')).toHaveAttribute('data-assistant-id', 'assistant-2')
    })
    expect(vi.mocked(useTabSelfMetadata)).toHaveBeenLastCalledWith(
      expect.objectContaining({
        instanceAppId: 'assistants',
        instanceKey: null
      })
    )
  })

  it('updates the draft assistant without creating a topic', async () => {
    homeMocks.locationState = undefined
    homeMocks.assistants = [{ id: 'assistant-default' }, { id: 'assistant-2' }]

    render(<HomePage />)

    await waitFor(() =>
      expect(screen.getByTestId('draft-composer')).toHaveAttribute('data-assistant-id', 'assistant-default')
    )

    fireEvent.click(screen.getByRole('button', { name: 'Switch draft assistant' }))

    await waitFor(() =>
      expect(screen.getByTestId('draft-composer')).toHaveAttribute('data-assistant-id', 'assistant-2')
    )
    expect(homeMocks.createTopic).not.toHaveBeenCalled()
  })

  it('creates the real topic and opens the stream only when the draft sends', async () => {
    homeMocks.locationState = undefined
    homeMocks.assistants = [{ id: 'assistant-default' }, { id: 'assistant-2' }]
    homeMocks.persistCacheValues.set('ui.chat.last_used_assistant_id', 'assistant-2')

    render(<HomePage />)

    await waitFor(() =>
      expect(screen.getByTestId('draft-composer')).toHaveAttribute('data-assistant-id', 'assistant-2')
    )
    fireEvent.click(screen.getByRole('button', { name: 'Send draft' }))

    await waitFor(() => {
      expect(homeMocks.createTopic).toHaveBeenCalledWith({ assistantId: 'assistant-2' })
    })
    expect(homeMocks.streamOpen).toHaveBeenCalledWith({
      trigger: 'submit-message',
      topicId: 'topic-created',
      userMessageParts: [{ type: 'text', text: 'hello' }],
      mentionedModelIds: undefined
    })
    await waitFor(() => expect(screen.getByTestId('active-topic')).toHaveTextContent('topic-created'))
    expect(homeMocks.refreshTopics).toHaveBeenCalled()
  })

  it('uses a valid explicit payload assistant before remembered and first assistants', async () => {
    homeMocks.assistants = [{ id: 'assistant-1' }, { id: 'assistant-2' }]
    homeMocks.persistCacheValues.set('ui.chat.last_used_assistant_id', 'assistant-1')

    render(<HomePage />)

    fireEvent.click(screen.getByRole('button', { name: 'New topic with assistant 2' }))

    await waitFor(() =>
      expect(screen.getByTestId('draft-composer')).toHaveAttribute('data-assistant-id', 'assistant-2')
    )
    expect(homeMocks.createTopic).not.toHaveBeenCalled()
  })

  it('passes URL topicId to useActiveTopic as activeTopicId', async () => {
    homeMocks.locationState = undefined
    homeMocks.routeSearch = { topicId: 'topic-from-url' }
    homeMocks.activeTopicLoading = true

    await act(async () => {
      render(<HomePage />)
    })

    expect(homeMocks.activeTopicOptions?.activeTopicId).toBe('topic-from-url')
    expect(homeMocks.activeTopicOptions?.passive).toBe(false)
  })

  it('uses tab metadata as the topic entry when the URL is the chat route', async () => {
    homeMocks.locationState = undefined
    homeMocks.routeSearch = {}
    homeMocks.currentTab = { metadata: { instanceAppId: 'assistants', instanceKey: 'topic-from-metadata' } }
    homeMocks.activeTopicLoading = true

    await act(async () => {
      render(<HomePage />)
    })

    expect(homeMocks.activeTopicOptions?.activeTopicId).toBe('topic-from-metadata')
    expect(homeMocks.activeTopicOptions?.passive).toBe(false)
  })

  it('keeps the metadata topic key while the entry topic is loading', async () => {
    homeMocks.locationState = undefined
    homeMocks.routeSearch = {}
    homeMocks.currentTab = { metadata: { instanceAppId: 'assistants', instanceKey: 'topic-from-metadata' } }
    homeMocks.activeTopicLoading = true

    await act(async () => {
      render(<HomePage />)
    })

    expect(vi.mocked(useTabSelfMetadata)).toHaveBeenLastCalledWith(
      expect.objectContaining({
        instanceAppId: 'assistants',
        instanceKey: 'topic-from-metadata'
      })
    )
    expect(screen.queryByTestId('draft-composer')).not.toBeInTheDocument()
  })

  it('keeps same-tab topic changes local instead of writing the URL', async () => {
    homeMocks.locationState = undefined
    homeMocks.routeSearch = {}

    await act(async () => {
      render(<HomePage />)
    })

    const setActiveTopicId = homeMocks.activeTopicOptions?.setActiveTopicId
    expect(typeof setActiveTopicId).toBe('function')

    await act(async () => {
      setActiveTopicId?.('topic-next')
    })

    await waitFor(() => expect(homeMocks.activeTopicOptions?.activeTopicId).toBe('topic-next'))
  })

  it('clears the local active topic without mutating URL search', async () => {
    homeMocks.locationState = undefined
    homeMocks.routeSearch = { topicId: 'topic-x' }

    await act(async () => {
      render(<HomePage />)
    })

    await act(async () => {
      homeMocks.activeTopicOptions?.setActiveTopicId?.(null)
    })

    await waitFor(() => expect(homeMocks.activeTopicOptions?.activeTopicId).toBeNull())
  })
})
