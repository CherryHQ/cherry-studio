import { WindowFrameProvider } from '@renderer/components/chat/shell/WindowFrameContext'
import { useCommandHandler } from '@renderer/hooks/command'
import type { Topic } from '@renderer/types'
import type { CherryMessagePart } from '@shared/data/types/message'
import { MIN_WINDOW_HEIGHT, SECOND_MIN_WINDOW_WIDTH } from '@shared/utils/window'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
  createTopic: vi.fn(),
  currentTab: undefined as { metadata?: Record<string, unknown> } | undefined,
  assistants: [{ id: 'assistant-default' }] as Array<{ id: string }>,
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

vi.mock('@renderer/hooks/command', () => ({
  useCommandHandler: vi.fn()
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
      const [value, setValue] = React.useState<unknown>(() => homeMocks.persistCacheValues.get(key) ?? null)
      const setPersistCache = vi.fn((nextValue: unknown) => {
        homeMocks.persistCacheValues.set(key, nextValue)
        homeMocks.cacheSetPersist(key, nextValue)
        setValue(nextValue)
      })

      return [value, setPersistCache]
    }
  }
})

vi.mock('@renderer/components/chat', () => ({
  ChatAppShell: ({ centerContent }: { centerContent?: ReactNode }) => (
    <div data-testid="message-only-shell">{centerContent}</div>
  ),
  ConversationShell: ({
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
  ),
  ConversationStageCenter: ({
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
  ),
  EmptyState: ({ title }: { title?: string }) => <div data-testid="empty-state">{title}</div>,
  LoadingState: ({ label }: { label?: string }) => <div role="status">{label}</div>
}))

vi.mock('@renderer/components/chat/composer/variants/ChatComposer', () => ({
  ChatPlacementComposer: ({
    assistantId,
    isHome,
    onDraftAssistantChange,
    onNewTopic,
    onSend,
    scopeKey
  }: {
    assistantId?: string
    isHome: boolean
    onDraftAssistantChange?: (assistantId: string | null) => void | Promise<void>
    onNewTopic?: (payload?: { assistantId?: string | null }) => void | Promise<void>
    onSend: (
      text: string,
      options?: {
        userMessageParts?: CherryMessagePart[]
      }
    ) => void | Promise<void>
    scopeKey: string
  }) => (
    <div
      data-assistant-id={assistantId ?? ''}
      data-home={String(isHome)}
      data-scope-key={scopeKey}
      data-testid="draft-composer">
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
    </div>
  )
}))

vi.mock('@renderer/context/TabIdContext', () => ({
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
    addAssistant: vi.fn(),
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
    onNewTopic,
    onLocateMessageHandled,
    onPaneCollapse
  }: {
    activeTopic: Topic
    pane?: ReactNode
    paneOpen?: boolean
    showResourceListControls?: boolean
    locateMessageId?: string
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

vi.mock('../Tabs', () => ({
  default: ({ onOpenHistoryRecords, revealRequest }: any) => (
    <div data-reveal-request={JSON.stringify(revealRequest ?? null)} data-testid="home-tabs">
      <button type="button" onClick={() => onOpenHistoryRecords?.()}>
        Open history records
      </button>
    </div>
  )
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

import { useTabSelfMetadata } from '@renderer/context/TabIdContext'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'

import HomePage from '../HomePage'

describe('HomePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    homeMocks.locationState = { topic: initialTopic }
    homeMocks.currentTab = undefined
    homeMocks.assistants = [{ id: 'assistant-default' }]
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
        ai: {
          streamOpen: homeMocks.streamOpen
        },
        window: {
          resetMinimumSize: vi.fn().mockResolvedValue(undefined),
          setMinimumSize: vi.fn().mockResolvedValue(undefined)
        }
      }
    })
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
