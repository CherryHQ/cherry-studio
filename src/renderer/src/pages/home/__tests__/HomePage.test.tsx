import type { Topic } from '@renderer/types'
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
  activeTopicOptions: undefined as { autoPickFirst?: boolean; syncActiveCache?: boolean } | undefined,
  cacheSetPersist: vi.fn(),
  discardTemporaryConversation: vi.fn(),
  activeTopicLoading: false,
  forceActiveTopicUndefined: false,
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
  setShowSidebar: vi.fn(),
  startTemporaryConversation: vi.fn(),
  temporaryConversation: null as any,
  updateTemporaryAssistant: vi.fn()
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

vi.mock('@renderer/hooks/useShortcuts', () => ({
  useShortcut: vi.fn()
}))

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

vi.mock('@renderer/hooks/useTopic', async () => {
  const React = await import('react')

  return {
    mapApiTopicToRendererTopic: (topic: Topic) => topic,
    useTopicMutations: () => ({
      refreshTopics: homeMocks.refreshTopics
    }),
    useActiveTopic: (topic?: Topic, options?: { autoPickFirst?: boolean; syncActiveCache?: boolean }) => {
      homeMocks.activeTopicOptions = options
      const [activeTopic, setActiveTopic] = React.useState<Topic | undefined>(topic)
      return {
        activeTopic: homeMocks.forceActiveTopicUndefined ? undefined : activeTopic,
        setActiveTopic,
        isLoading: homeMocks.activeTopicLoading
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
  useNavigate: () => vi.fn(),
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
    hideNavbar,
    paneOpen,
    showResourceListControls,
    locateMessageId,
    onNewTopic,
    onLocateMessageHandled,
    onTemporaryAssistantChange
  }: {
    activeTopic: Topic
    pane?: ReactNode
    hideNavbar?: boolean
    paneOpen?: boolean
    showResourceListControls?: boolean
    locateMessageId?: string
    onNewTopic?: () => void | Promise<void>
    onLocateMessageHandled?: () => void
    onTemporaryAssistantChange?: (assistantId: string | null) => void | Promise<void>
  }) => (
    <section>
      <output data-testid="active-topic">{activeTopic.id}</output>
      <output data-testid="active-topic-assistant">{activeTopic.assistantId ?? ''}</output>
      <output data-testid="hide-navbar">{String(hideNavbar)}</output>
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
    SHOW_TOPIC_SIDEBAR: 'SHOW_TOPIC_SIDEBAR',
    GLOBAL_SEARCH_SELECT_TOPIC: 'GLOBAL_SEARCH_SELECT_TOPIC',
    GLOBAL_SEARCH_SELECT_TOPIC_MESSAGE: 'GLOBAL_SEARCH_SELECT_TOPIC_MESSAGE'
  },
  EventEmitter: {
    emit: vi.fn(),
    on: vi.fn(() => vi.fn())
  }
}))

vi.mock('@renderer/services/NavigationService', () => ({
  default: {
    setNavigate: vi.fn()
  }
}))

import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'

import HomePage from '../HomePage'

describe('HomePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    homeMocks.historyTopic = historyTopic
    homeMocks.locationState = { topic: initialTopic }
    homeMocks.routeSearch = {}
    homeMocks.routeTopic = undefined
    homeMocks.routeTopicLoading = false
    homeMocks.activeTopicOptions = undefined
    homeMocks.persistCacheValues.clear()
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
    expect(screen.getByTestId('hide-navbar')).toHaveTextContent('false')
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

  it('keeps the current topic visible while the active topic is reloading', async () => {
    const { rerender } = render(<HomePage />)

    await waitFor(() => expect(screen.getByTestId('active-topic')).toHaveTextContent('topic-initial'))

    homeMocks.activeTopicLoading = true
    homeMocks.forceActiveTopicUndefined = true
    rerender(<HomePage />)

    expect(screen.getByTestId('active-topic')).toHaveTextContent('topic-initial')
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
    expect(homeMocks.activeTopicOptions).toEqual({ autoPickFirst: false, syncActiveCache: false })
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
    expect(homeMocks.activeTopicOptions).toEqual({ autoPickFirst: false, syncActiveCache: true })
    await waitFor(() => {
      expect(homeMocks.startTemporaryConversation).toHaveBeenCalledWith({ assistantId: undefined })
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
    expect(screen.getByTestId('hide-navbar')).toHaveTextContent('true')

    fireEvent.click(screen.getByRole('button', { name: 'New topic' }))

    expect(homeMocks.startTemporaryConversation).not.toHaveBeenCalled()
    expect(EventEmitter.emit).toHaveBeenCalledWith(EVENT_NAMES.SHOW_TOPIC_SIDEBAR)
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
})
