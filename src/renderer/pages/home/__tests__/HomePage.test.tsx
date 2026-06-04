import { useCommandHandler } from '@renderer/commands'
import type { Topic } from '@renderer/types'
import { MIN_WINDOW_HEIGHT, SECOND_MIN_WINDOW_WIDTH } from '@shared/config/constant'
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
  currentTab: undefined as { metadata?: Record<string, unknown> } | undefined,
  discardTemporaryConversation: vi.fn(),
  activeTopicLoading: false,
  activeTopicOverride: undefined as Topic | undefined,
  activeTopicSource: 'query' as 'query' | 'pending' | 'none',
  forceActiveTopicUndefined: false,
  focusExistingTab: vi.fn(() => false),
  historyTopic: undefined as Topic | undefined,
  locationState: undefined as { topic: Topic } | undefined,
  persistCacheValues: new Map<string, unknown>(),
  persistTemporaryConversation: vi.fn(),
  preferenceValues: new Map<string, unknown>(),
  refreshTopics: vi.fn(),
  replaceTemporaryConversation: vi.fn(),
  routeSearch: {} as Record<string, unknown>,
  routeTopic: undefined as Topic | undefined,
  routeTopicLoading: false,
  setActiveTopicId: vi.fn(),
  setShowSidebar: vi.fn(),
  isActiveTab: false,
  startTemporaryConversation: vi.fn(),
  temporaryConversation: null as any,
  updateTemporaryAssistant: vi.fn()
}))

vi.mock('@renderer/commands', () => ({
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
  EmptyState: ({ title }: { title?: string }) => <div data-testid="empty-state">{title}</div>,
  LoadingState: ({ label }: { label?: string }) => <div role="status">{label}</div>
}))

vi.mock('@renderer/hooks/useTemporaryConversation', () => ({
  useTemporaryConversation: () => ({
    conversation: homeMocks.temporaryConversation,
    discard: homeMocks.discardTemporaryConversation,
    persist: homeMocks.persistTemporaryConversation,
    replace: homeMocks.replaceTemporaryConversation,
    start: homeMocks.startTemporaryConversation,
    updateAssistant: homeMocks.updateTemporaryAssistant
  })
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

vi.mock('@renderer/hooks/useTopic', async () => {
  const React = await import('react')

  return {
    mapApiTopicToRendererTopic: (topic: Topic) => topic,
    useTopicMutations: () => ({
      refreshTopics: homeMocks.refreshTopics
    }),
    useActiveTopic: (options: {
      initialTopic?: Topic
      activeTopicId: string | null
      setActiveTopicId: (id: string | null) => void
      passive?: boolean
    }) => {
      homeMocks.activeTopicOptions = {
        passive: options.passive,
        activeTopicId: options.activeTopicId,
        initialTopic: options.initialTopic,
        setActiveTopicId: options.setActiveTopicId
      }
      const [activeTopic, setActiveTopic] = React.useState<Topic | undefined>(options.initialTopic)
      return {
        activeTopic: homeMocks.forceActiveTopicUndefined ? undefined : (homeMocks.activeTopicOverride ?? activeTopic),
        setActiveTopic,
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
        'common.loading': 'Loading...',
        'history.error.topic_not_found': 'Topic not found'
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
    onTemporaryAssistantChange,
    onPaneCollapse
  }: {
    activeTopic: Topic
    pane?: ReactNode
    paneOpen?: boolean
    showResourceListControls?: boolean
    locateMessageId?: string
    onNewTopic?: () => void | Promise<void>
    onLocateMessageHandled?: () => void
    onTemporaryAssistantChange?: (assistantId: string | null) => void | Promise<void>
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
      {onLocateMessageHandled && (
        <button type="button" onClick={() => onLocateMessageHandled()}>
          Locate handled
        </button>
      )}
      {onTemporaryAssistantChange && (
        <button type="button" onClick={() => onTemporaryAssistantChange('assistant-2')}>
          Switch temporary assistant
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

vi.mock('../Navbar', () => ({
  default: () => <nav />
}))

vi.mock('../Tabs', () => ({
  default: ({ onOpenHistory, revealRequest }: any) => (
    <div data-reveal-request={JSON.stringify(revealRequest ?? null)} data-testid="home-tabs">
      <button type="button" onClick={() => onOpenHistory?.()}>
        Open history
      </button>
    </div>
  )
}))

vi.mock('@renderer/pages/history/HistoryRecordsPage', () => ({
  default: ({ onClose, onRecordSelect, open }: any) =>
    open ? (
      <button
        type="button"
        onClick={() => {
          onRecordSelect?.(homeMocks.historyTopic)
          onClose?.()
        }}>
        Select history topic
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
    homeMocks.historyTopic = historyTopic
    homeMocks.locationState = { topic: initialTopic }
    homeMocks.currentTab = undefined
    homeMocks.routeSearch = {}
    homeMocks.routeTopic = undefined
    homeMocks.routeTopicLoading = false
    homeMocks.activeTopicOptions = undefined
    homeMocks.persistCacheValues.clear()
    homeMocks.focusExistingTab.mockReturnValue(false)
    homeMocks.isActiveTab = false
    homeMocks.persistTemporaryConversation.mockResolvedValue(null)
    homeMocks.replaceTemporaryConversation.mockResolvedValue({
      id: 'temp-topic',
      topicId: 'temp-topic',
      type: 'assistant'
    })
    homeMocks.updateTemporaryAssistant.mockResolvedValue({
      assistantId: 'assistant-2',
      id: 'temp-topic',
      topicId: 'temp-topic',
      type: 'assistant'
    })
    homeMocks.startTemporaryConversation.mockResolvedValue({
      id: 'temp-topic',
      topicId: 'temp-topic',
      type: 'assistant'
    })
    homeMocks.temporaryConversation = null
    homeMocks.activeTopicLoading = false
    homeMocks.activeTopicOverride = undefined
    homeMocks.activeTopicSource = 'query'
    homeMocks.forceActiveTopicUndefined = false
    homeMocks.preferenceValues.clear()
    homeMocks.preferenceValues.set('topic.tab.show', false)

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

  it('opens the topic sidebar and forwards a reveal request after selecting a history topic', async () => {
    render(<HomePage />)

    expect(screen.getByTestId('active-topic')).toHaveTextContent('topic-initial')
    expect(screen.getByTestId('pane-open')).toHaveTextContent('false')

    fireEvent.click(screen.getByRole('button', { name: 'Open history' }))
    fireEvent.click(screen.getByRole('button', { name: 'Select history topic' }))

    await waitFor(() => expect(screen.getByTestId('active-topic')).toHaveTextContent('topic-history'))

    expect(homeMocks.setShowSidebar).toHaveBeenCalledWith(true)
    expect(screen.getByTestId('pane-open')).toHaveTextContent('true')
    expect(JSON.parse(screen.getByTestId('home-tabs').getAttribute('data-reveal-request') ?? 'null')).toEqual({
      clearFilters: true,
      clearQuery: true,
      itemId: 'topic-history',
      requestId: 1
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
    homeMocks.temporaryConversation = {
      assistantId: 'assistant-1',
      id: 'temp-topic',
      topicId: 'temp-topic',
      type: 'assistant'
    }

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
    expect(screen.getByTestId('active-topic')).toHaveTextContent('temp-topic')
    expect(screen.getByTestId('locate-message-id')).toHaveTextContent('')
    expect(homeMocks.setShowSidebar).not.toHaveBeenCalled()
    expect(homeMocks.discardTemporaryConversation).not.toHaveBeenCalled()
  })

  it('keeps the current topic visible while the active topic is reloading', async () => {
    const { rerender } = render(<HomePage />)

    await waitFor(() => expect(screen.getByTestId('active-topic')).toHaveTextContent('topic-initial'))

    homeMocks.activeTopicLoading = true
    homeMocks.forceActiveTopicUndefined = true
    rerender(<HomePage />)

    expect(screen.getByTestId('active-topic')).toHaveTextContent('topic-initial')
  })

  it('waits for a cached active topic before starting a first-launch temporary topic', () => {
    homeMocks.locationState = undefined
    homeMocks.activeTopicLoading = true
    homeMocks.forceActiveTopicUndefined = true

    const { rerender } = render(<HomePage />)

    expect(screen.queryByTestId('active-topic')).not.toBeInTheDocument()
    expect(homeMocks.startTemporaryConversation).not.toHaveBeenCalled()

    homeMocks.activeTopicLoading = false
    homeMocks.forceActiveTopicUndefined = false
    homeMocks.activeTopicOverride = initialTopic
    rerender(<HomePage />)

    expect(screen.getByTestId('active-topic')).toHaveTextContent('topic-initial')
    expect(homeMocks.startTemporaryConversation).not.toHaveBeenCalled()
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
    expect(homeMocks.startTemporaryConversation).not.toHaveBeenCalled()
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
    expect(homeMocks.startTemporaryConversation).not.toHaveBeenCalled()
    expect(homeMocks.setShowSidebar).not.toHaveBeenCalled()
  })

  it('shows a not-found state for a missing message-only route topic', () => {
    homeMocks.locationState = undefined
    homeMocks.routeSearch = { topicId: 'topic-message', view: 'message' }

    render(<HomePage />)

    expect(screen.getByTestId('message-only-shell')).toBeInTheDocument()
    expect(screen.getByTestId('empty-state')).toHaveTextContent('Topic not found')
    expect(screen.queryByTestId('active-topic')).not.toBeInTheDocument()
    expect(homeMocks.startTemporaryConversation).not.toHaveBeenCalled()
    expect(homeMocks.setShowSidebar).not.toHaveBeenCalled()
  })

  it('treats topicId without message view as a normal chat route', async () => {
    homeMocks.locationState = undefined
    homeMocks.routeSearch = { topicId: 'topic-message' }
    homeMocks.routeTopic = {
      ...initialTopic,
      id: 'topic-message',
      name: 'Message topic'
    }

    render(<HomePage />)

    expect(screen.queryByTestId('active-topic')).not.toBeInTheDocument()
    expect(homeMocks.activeTopicOptions).toMatchObject({
      passive: false,
      activeTopicId: 'topic-message'
    })
    await waitFor(() => {
      expect(homeMocks.startTemporaryConversation).toHaveBeenCalledWith({ assistantId: null })
    })
  })

  it('starts generic temporary topics with the active topic assistant', async () => {
    homeMocks.startTemporaryConversation.mockResolvedValue({
      assistantId: 'assistant-1',
      id: 'temp-topic',
      topicId: 'temp-topic',
      type: 'assistant'
    })

    render(<HomePage />)

    fireEvent.click(screen.getByRole('button', { name: 'New topic' }))

    await waitFor(() => {
      expect(homeMocks.startTemporaryConversation).toHaveBeenCalledWith({ assistantId: 'assistant-1' })
    })
    await waitFor(() => expect(screen.getByTestId('active-topic')).toHaveTextContent('temp-topic'))
    expect(screen.getByRole('button', { name: 'Switch temporary assistant' })).toBeInTheDocument()
  })

  it('prefers a leased temporary topic over a stale active topic while rendering home mode', () => {
    homeMocks.locationState = undefined
    homeMocks.activeTopicOverride = initialTopic
    homeMocks.temporaryConversation = {
      assistantId: 'assistant-2',
      id: 'temp-topic',
      topicId: 'temp-topic',
      type: 'assistant'
    }

    render(<HomePage />)

    expect(screen.getByTestId('active-topic')).toHaveTextContent('temp-topic')
    expect(screen.getByTestId('active-topic-assistant')).toHaveTextContent('assistant-2')
    expect(screen.getByRole('button', { name: 'Switch temporary assistant' })).toBeInTheDocument()
    expect(vi.mocked(useTabSelfMetadata)).toHaveBeenLastCalledWith(
      expect.objectContaining({
        instanceAppId: 'assistants',
        instanceKey: null
      })
    )
    expect(homeMocks.startTemporaryConversation).not.toHaveBeenCalled()
  })

  it('selects a persisted topic after an assistant temporary topic is active', async () => {
    homeMocks.locationState = undefined
    homeMocks.temporaryConversation = {
      assistantId: 'assistant-1',
      id: 'temp-topic',
      topicId: 'temp-topic',
      type: 'assistant'
    }

    render(<HomePage />)

    expect(screen.getByTestId('active-topic')).toHaveTextContent('temp-topic')
    expect(screen.getByRole('button', { name: 'Switch temporary assistant' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Open history' }))
    fireEvent.click(screen.getByRole('button', { name: 'Select history topic' }))

    await waitFor(() => expect(screen.getByTestId('active-topic')).toHaveTextContent('topic-history'))
    expect(screen.queryByRole('button', { name: 'Switch temporary assistant' })).not.toBeInTheDocument()
    expect(homeMocks.discardTemporaryConversation).toHaveBeenCalled()
  })

  it('remembers the active topic assistant for the next first-launch temporary topic', async () => {
    render(<HomePage />)

    await waitFor(() => {
      expect(homeMocks.cacheSetPersist).toHaveBeenCalledWith('ui.chat.last_used_assistant_id', 'assistant-1')
    })
  })

  it('seeds the first-launch temporary topic from the remembered assistant', async () => {
    homeMocks.locationState = undefined
    homeMocks.persistCacheValues.set('ui.chat.last_used_assistant_id', 'assistant-2')
    homeMocks.startTemporaryConversation.mockResolvedValue({
      assistantId: 'assistant-2',
      id: 'temp-topic',
      topicId: 'temp-topic',
      type: 'assistant'
    })

    render(<HomePage />)

    await waitFor(() => {
      expect(homeMocks.startTemporaryConversation).toHaveBeenCalledWith({ assistantId: 'assistant-2' })
    })
  })

  it('seeds the first-launch temporary topic from the route assistantId', async () => {
    homeMocks.locationState = undefined
    homeMocks.routeSearch = { assistantId: 'assistant-route' }
    homeMocks.startTemporaryConversation.mockResolvedValue({
      assistantId: 'assistant-route',
      id: 'temp-topic',
      topicId: 'temp-topic',
      type: 'assistant'
    })

    render(<HomePage />)

    await waitFor(() => {
      expect(homeMocks.startTemporaryConversation).toHaveBeenCalledWith({ assistantId: 'assistant-route' })
    })
  })

  it('does not lease another temporary topic while the active temporary topic is still empty', async () => {
    homeMocks.locationState = undefined
    homeMocks.temporaryConversation = {
      assistantId: 'assistant-1',
      id: 'temp-topic',
      topic: initialTopic,
      topicId: 'temp-topic',
      type: 'assistant'
    }

    render(<HomePage />)

    expect(screen.getByTestId('active-topic')).toHaveTextContent('temp-topic')
    expect(screen.getByTestId('active-topic-assistant')).toHaveTextContent('assistant-1')
    expect(screen.getByRole('button', { name: 'Switch temporary assistant' })).toBeInTheDocument()
    expect(screen.getByTestId('show-resource-list-controls')).toHaveTextContent('true')

    fireEvent.click(screen.getByRole('button', { name: 'New topic' }))

    expect(homeMocks.startTemporaryConversation).not.toHaveBeenCalled()
  })

  it('starts the remembered assistant when the active temporary topic has no assistant', async () => {
    homeMocks.locationState = undefined
    homeMocks.persistCacheValues.set('ui.chat.last_used_assistant_id', 'assistant-2')
    homeMocks.temporaryConversation = {
      id: 'temp-topic-empty',
      topic: { ...initialTopic, assistantId: null, id: 'temp-topic-empty' },
      topicId: 'temp-topic-empty',
      type: 'assistant'
    }
    homeMocks.startTemporaryConversation.mockResolvedValue({
      assistantId: 'assistant-2',
      id: 'temp-topic-next',
      topicId: 'temp-topic-next',
      type: 'assistant'
    })

    render(<HomePage />)

    fireEvent.click(screen.getByRole('button', { name: 'New topic' }))

    await waitFor(() => {
      expect(homeMocks.startTemporaryConversation).toHaveBeenCalledWith({ assistantId: 'assistant-2' })
    })
  })

  it('updates the active temporary topic assistant without changing the topic id', async () => {
    homeMocks.locationState = undefined
    homeMocks.temporaryConversation = {
      assistantId: 'assistant-1',
      id: 'temp-topic',
      topic: initialTopic,
      topicId: 'temp-topic',
      type: 'assistant'
    }
    homeMocks.updateTemporaryAssistant.mockResolvedValue({
      assistantId: 'assistant-2',
      id: 'temp-topic',
      topicId: 'temp-topic',
      type: 'assistant'
    })

    render(<HomePage />)

    fireEvent.click(screen.getByRole('button', { name: 'Switch temporary assistant' }))

    await waitFor(() => expect(screen.getByTestId('active-topic')).toHaveTextContent('temp-topic'))
    expect(homeMocks.updateTemporaryAssistant).toHaveBeenCalledWith('assistant-2')
    expect(homeMocks.replaceTemporaryConversation).not.toHaveBeenCalled()
    expect(homeMocks.startTemporaryConversation).not.toHaveBeenCalled()
  })

  it('passes URL topicId to useActiveTopic as activeTopicId', async () => {
    homeMocks.locationState = undefined
    homeMocks.routeSearch = { topicId: 'topic-from-url' }

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
    expect(homeMocks.startTemporaryConversation).not.toHaveBeenCalled()
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
