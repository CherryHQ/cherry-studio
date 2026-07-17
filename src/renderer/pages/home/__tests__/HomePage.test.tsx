import type * as ChatPrimitives from '@renderer/components/chat/primitives'
import { WindowFrameProvider } from '@renderer/components/chat/shell/WindowFrameContext'
import { useCommandHandler } from '@renderer/hooks/command'
import { DefaultPreferences } from '@shared/data/preference/preferenceSchemas'
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
    activeNodeId?: string
    createdAt?: string
    updatedAt: string
  }>,
  currentTab: undefined as { metadata?: Record<string, unknown> } | undefined,
  isTopicsFirstPageLoading: false,
  isTopicsLoadingAll: false,
  isTopicsFullyLoaded: true,
  isLatestTopicLoading: false,
  // `undefined` → derive the latest from `classicLayoutTopics`; `null` → empty; a topic → that exact topic
  // (used to prove first-entry restore reads the dedicated latest query, not the paged list).
  latestTopicOverride: undefined as Topic | null | undefined,
  assistants: [{ id: 'assistant-default' }] as Array<{ id: string; name?: string }>,
  assistantsError: undefined as Error | undefined,
  assistantsLoaded: true,
  assistantsLoading: false,
  assistantsRefreshing: false,
  activeTopicLoading: false,
  activeTopicOverride: undefined as Topic | undefined,
  activeTopicSource: 'query' as 'query' | 'pending' | 'none',
  assistantResourceListTopicsSource: undefined as unknown,
  assistantTopicsSourceOptions: [] as Array<{ enabled?: boolean } | undefined>,
  createdAssistantTopicsSource: undefined as unknown,
  forceActiveTopicUndefined: false,
  homeTabsTopicsSource: undefined as unknown,
  locationState: undefined as { topic: Topic } | undefined,
  persistCacheValues: new Map<string, unknown>(),
  preferenceValues: new Map<string, unknown>(),
  refreshTopics: vi.fn(),
  routeSearch: {} as Record<string, unknown>,
  routeTopic: undefined as Topic | undefined,
  routeTopicLoading: false,
  setShowSidebar: vi.fn(),
  topicPanelTopicsSource: undefined as unknown,
  isActiveTab: false
}))

const ipcMocks = vi.hoisted(() => ({ request: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: ipcMocks.request }, useIpcOn: vi.fn() }))

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

vi.mock('@renderer/hooks/tab', () => ({
  useCurrentTab: () => homeMocks.currentTab,
  useCurrentTabId: () => 'chat-tab',
  useIsActiveTab: () => homeMocks.isActiveTab,
  useTabSelfMetadata: vi.fn()
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

vi.mock('@renderer/hooks/resourceViewSources', async () => {
  const React = await import('react')

  return {
    // Match the real useTopics shape: isLoading (first page) / isLoadingAll / isFullyLoaded present.
    useAssistantTopicsSource: (options: { enabled?: boolean } = {}) => {
      const source = React.useMemo(
        () => ({
          topics: options.enabled === false ? [] : homeMocks.classicLayoutTopics,
          isLoading: homeMocks.isTopicsFirstPageLoading,
          isLoadingAll: homeMocks.isTopicsLoadingAll,
          isFullyLoaded: homeMocks.isTopicsFullyLoaded,
          error: undefined
        }),
        [options.enabled]
      )
      homeMocks.assistantTopicsSourceOptions.push(options)
      homeMocks.createdAssistantTopicsSource = source
      return source
    }
  }
})

vi.mock('@renderer/hooks/useTopic', async () => {
  const React = await import('react')
  const { findLatestUpdated } = await import('@renderer/utils/resourceEntity')

  return {
    mapApiTopicToRendererTopic: (topic: Topic) => topic,
    useLatestTopic: (options: { enabled?: boolean } = {}) => {
      const derived = findLatestUpdated(homeMocks.classicLayoutTopics) as Topic | undefined
      const latest =
        homeMocks.latestTopicOverride === undefined ? derived : (homeMocks.latestTopicOverride ?? undefined)
      return {
        latestTopic: options.enabled === false ? undefined : latest,
        isLoading: homeMocks.isLatestTopicLoading
      }
    },
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
      const clearActiveTopic = React.useCallback(() => {
        homeMocks.activeTopicOverride = undefined
        setActiveTopic(undefined)
        commitActiveTopicId(null)
      }, [commitActiveTopicId])
      return {
        activeTopic: homeMocks.forceActiveTopicUndefined ? undefined : (homeMocks.activeTopicOverride ?? activeTopic),
        setActiveTopic: setActiveTopicValue,
        clearActiveTopic,
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
    centerSurface,
    pane,
    paneOpen,
    panePosition,
    showResourceListControls,
    onSidebarToggle,
    locateMessageId,
    resourcePaneCount,
    onCreateEmptyTopic,
    onNewTopic,
    onLocateMessageHandled,
    onPaneCollapse,
    onPaneAutoCollapseChange
  }: {
    activeTopic?: Topic
    centerSurface?: { content?: ReactNode } | null
    pane?: ReactNode
    paneOpen?: boolean
    panePosition?: string
    showResourceListControls?: boolean
    onSidebarToggle?: () => void
    locateMessageId?: string
    resourcePaneCount?: { label: string; count: number }
    onCreateEmptyTopic?: (payload?: { assistantId?: string | null }) => void | Promise<void>
    onNewTopic?: (payload?: { assistantId?: string | null; excludeReuseTopicId?: string }) => void | Promise<void>
    onLocateMessageHandled?: () => void
    onPaneCollapse?: () => void
    onPaneAutoCollapseChange?: (collapsed: boolean) => void
  }) => {
    const showConversation = Boolean(activeTopic && !centerSurface)

    return (
      <section data-testid="home-chat-shell">
        <output data-testid="pane-open">{String(paneOpen)}</output>
        <output data-testid="pane-position">{panePosition ?? ''}</output>
        {centerSurface?.content}
        {showConversation && activeTopic && (
          <>
            <output data-testid="active-topic">{activeTopic.id}</output>
            <output data-testid="active-topic-assistant">{activeTopic.assistantId ?? ''}</output>
            <output data-testid="show-resource-list-controls">{String(showResourceListControls)}</output>
            <output data-testid="locate-message-id">{locateMessageId ?? ''}</output>
            {showResourceListControls && onSidebarToggle && (
              <button type="button" onClick={onSidebarToggle}>
                Toggle sidebar
              </button>
            )}
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
            {onNewTopic && (
              <button
                type="button"
                onClick={() => onNewTopic({ assistantId: 'assistant-2', excludeReuseTopicId: 'topic-empty-modern' })}>
                Replace deleted topic for assistant 2
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
          </>
        )}
        {onPaneCollapse && (
          <button type="button" onClick={onPaneCollapse}>
            Collapse pane
          </button>
        )}
        {onPaneAutoCollapseChange && (
          <>
            <button type="button" onClick={() => onPaneAutoCollapseChange(true)}>
              Auto collapse pane
            </button>
            <button type="button" onClick={() => onPaneAutoCollapseChange(false)}>
              Auto restore pane
            </button>
          </>
        )}
        <div data-testid="topic-right-pane-viewport" />
        {pane}
      </section>
    )
  }
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
  default: ({
    historyRecordsActive,
    assistantTopicsSource,
    onOpenHistoryRecords,
    onSetPanePosition,
    resourceMenuItems,
    revealRequest,
    setActiveTopic
  }: any) => {
    homeMocks.homeTabsTopicsSource = assistantTopicsSource

    return (
      <div
        data-history-active={String(Boolean(historyRecordsActive))}
        data-reveal-request={JSON.stringify(revealRequest ?? null)}
        data-testid="home-tabs">
        <button
          type="button"
          onClick={() => {
            setActiveTopic?.({
              id: 'topic-next',
              assistantId: 'assistant-default',
              name: 'Topic Next',
              messages: [],
              createdAt: '2026-01-02T00:00:00.000Z',
              updatedAt: '2026-01-02T00:00:00.000Z'
            })
          }}>
          Select topic next
        </button>
        {onOpenHistoryRecords && (
          <button type="button" onClick={onOpenHistoryRecords}>
            Open history records
          </button>
        )}
        {onSetPanePosition && (
          <>
            <button type="button" onClick={() => void onSetPanePosition('right')}>
              Move topics right
            </button>
            <button type="button" onClick={() => void onSetPanePosition('left')}>
              Move topics left
            </button>
          </>
        )}
        {resourceMenuItems
          ?.filter((item: { id: string }) => item.id === 'assistant-resource-view')
          .map((item: { id: string; onSelect: () => void | Promise<void> }) => (
            <button key={item.id} type="button" onClick={() => void item.onSelect()}>
              assistants.presets.manage.title
            </button>
          ))}
      </div>
    )
  }
}))

vi.mock('../Tabs/components/Topics', () => ({
  Topics: ({
    assistantIdFilter,
    assistantTopicsSource,
    presentation
  }: {
    assistantIdFilter?: string | null
    assistantTopicsSource?: unknown
    presentation?: string
  }) => {
    homeMocks.topicPanelTopicsSource = assistantTopicsSource

    return (
      <div
        data-assistant-id={assistantIdFilter ?? ''}
        data-presentation={presentation ?? ''}
        data-testid="topic-resource-panel"
      />
    )
  }
}))

vi.mock('../components/TopicRightPane', () => {
  const TopicRightPane = Object.assign(
    ({
      children,
      defaultOpen,
      onOpenChange,
      present,
      resourcePane
    }: {
      children: ReactNode
      defaultOpen?: boolean
      onOpenChange?: (open: boolean) => void
      present?: boolean
      resourcePane?: { node?: ReactNode; label?: string } | null
    }) => (
      <div
        data-default-open={String(Boolean(defaultOpen))}
        data-default-tab={resourcePane ? 'resources' : 'branch'}
        data-present={String(present !== false)}
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
      Viewport: () => <div data-testid="topic-right-pane-viewport" />,
      Shortcuts: () => <button type="button">Topic right pane shortcuts</button>,
      Toggle: () => <button type="button">Toggle topic right pane</button>
    }
  )

  return {
    TopicRightPane
  }
})

vi.mock('@renderer/components/chat/resourceList/AssistantResourceList', () => ({
  AssistantResourceList: ({
    activeAssistantId,
    historyRecordsActive,
    onAddAssistant,
    onActiveAssistantDeleted,
    onOpenHistoryRecords,
    assistantTopicsSource,
    onCreateTopic,
    onSelectedAssistantClick,
    resourceMenuItems
  }: {
    activeAssistantId?: string | null
    historyRecordsActive?: boolean
    assistantTopicsSource?: unknown
    onAddAssistant?: () => void | Promise<void>
    onActiveAssistantDeleted?: (assistantId: string) => void | Promise<void>
    onCreateTopic?: (assistantId: string | null) => void | Promise<void>
    onOpenHistoryRecords?: () => void | Promise<void>
    onSelectedAssistantClick?: () => void | Promise<void>
    resourceMenuItems?: Array<{ id: string; label: ReactNode; onSelect: () => void | Promise<void> }>
  }) => {
    homeMocks.assistantResourceListTopicsSource = assistantTopicsSource

    return (
      <div
        data-active-assistant-id={activeAssistantId ?? ''}
        data-history-active={String(Boolean(historyRecordsActive))}
        data-testid="assistant-resource-list">
        <button type="button" onClick={() => void onAddAssistant?.()}>
          Open assistant picker
        </button>
        <button type="button" onClick={() => void onOpenHistoryRecords?.()}>
          Open history records
        </button>
        <button type="button" onClick={() => void onActiveAssistantDeleted?.(activeAssistantId ?? '')}>
          Delete active assistant
        </button>
        <button type="button" onClick={() => void onCreateTopic?.(null)}>
          Create default assistant topic
        </button>
        <button type="button" onClick={() => void onSelectedAssistantClick?.()}>
          Toggle selected assistant pane
        </button>
        {resourceMenuItems
          ?.filter((item) => item.id === 'assistant-resource-view')
          .map((item) => (
            <button key={item.id} type="button" onClick={() => void item.onSelect()}>
              assistants.presets.manage.title
            </button>
          ))}
      </div>
    )
  }
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

vi.mock('@renderer/components/history/HistoryRecordsView', () => ({
  default: ({ open, onRecordSelect }: { open?: boolean; onRecordSelect?: (topic: Topic | null) => void }) =>
    open ? (
      <div data-testid="history-records-view">
        <button type="button" onClick={() => onRecordSelect?.(null)}>
          Clear history selection
        </button>
      </div>
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
import { toast } from '@renderer/services/toast'
import type { Topic } from '@renderer/types/topic'

import HomePage from '../HomePage'

describe('HomePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    homeMocks.locationState = { topic: initialTopic }
    homeMocks.currentTab = undefined
    homeMocks.assistants = [{ id: 'assistant-default' }]
    homeMocks.classicLayoutTopics = []
    homeMocks.isTopicsFirstPageLoading = false
    homeMocks.isTopicsLoadingAll = false
    homeMocks.isTopicsFullyLoaded = true
    homeMocks.isLatestTopicLoading = false
    homeMocks.latestTopicOverride = undefined
    homeMocks.assistantsError = undefined
    homeMocks.assistantsLoaded = true
    homeMocks.assistantsLoading = false
    homeMocks.assistantsRefreshing = false
    homeMocks.routeSearch = {}
    homeMocks.routeTopic = undefined
    homeMocks.routeTopicLoading = false
    homeMocks.activeTopicOptions = undefined
    homeMocks.assistantResourceListTopicsSource = undefined
    homeMocks.assistantTopicsSourceOptions = []
    homeMocks.createdAssistantTopicsSource = undefined
    homeMocks.homeTabsTopicsSource = undefined
    homeMocks.topicPanelTopicsSource = undefined
    homeMocks.persistCacheValues.clear()
    homeMocks.addAssistant.mockResolvedValue({
      id: 'assistant-created',
      name: 'Catalog Preset'
    })
    homeMocks.isActiveTab = false
    homeMocks.createTopic.mockResolvedValue(createdTopic)
    homeMocks.refreshTopics.mockResolvedValue(undefined)
    homeMocks.activeTopicLoading = false
    homeMocks.activeTopicOverride = undefined
    homeMocks.activeTopicSource = 'query'
    homeMocks.forceActiveTopicUndefined = false
    homeMocks.preferenceValues.clear()
    homeMocks.preferenceValues.set('topic.tab.show', false)
    homeMocks.preferenceValues.set('topic.tab.position', 'right')
    homeMocks.preferenceValues.set('chat.message.style', 'message-style')

    ipcMocks.request.mockClear()
  })

  it('renders the assistant resource list with the resource pane open by default', () => {
    homeMocks.preferenceValues.set('topic.tab.display_mode', 'assistant')

    render(<HomePage />)

    expect(screen.getByTestId('topic-right-pane-provider')).toHaveAttribute('data-default-tab', 'resources')
    expect(screen.getByTestId('topic-right-pane-provider')).toHaveAttribute('data-default-open', 'true')
    expect(screen.getByTestId('assistant-resource-list')).toHaveAttribute('data-active-assistant-id', 'assistant-1')
    expect(screen.getByTestId('topic-resource-panel')).toHaveAttribute('data-assistant-id', 'assistant-1')
    expect(screen.getByTestId('topic-resource-panel')).toHaveAttribute('data-presentation', 'right-panel')
    expect(screen.queryByTestId('home-tabs')).not.toBeInTheDocument()
  })

  it('renders the classic assistant layout for the new-user display default', () => {
    homeMocks.preferenceValues.set('topic.tab.display_mode', DefaultPreferences.default['topic.tab.display_mode'])

    render(<HomePage />)

    expect(DefaultPreferences.default['topic.tab.display_mode']).toBe('assistant')
    expect(screen.getByTestId('assistant-resource-list')).toBeInTheDocument()
    expect(screen.getByTestId('topic-resource-panel')).toHaveAttribute('data-presentation', 'right-panel')
    expect(screen.queryByTestId('home-tabs')).not.toBeInTheDocument()
  })

  it('passes the same assistant topic source to the classic rail and right panel', () => {
    homeMocks.preferenceValues.set('topic.tab.display_mode', 'assistant')

    render(<HomePage />)

    expect(homeMocks.assistantTopicsSourceOptions.length).toBeGreaterThan(0)
    expect(homeMocks.assistantTopicsSourceOptions.every((options) => options?.enabled === true)).toBe(true)
    expect(homeMocks.assistantResourceListTopicsSource).toBe(homeMocks.createdAssistantTopicsSource)
    expect(homeMocks.topicPanelTopicsSource).toBe(homeMocks.createdAssistantTopicsSource)
  })

  it('does not render the topic resource pane when the classic topic position is left', () => {
    homeMocks.preferenceValues.set('topic.tab.display_mode', 'assistant')
    homeMocks.preferenceValues.set('topic.tab.position', 'left')
    homeMocks.persistCacheValues.set('ui.chat.right_pane_open', true)

    render(<HomePage />)

    expect(screen.getByTestId('home-tabs')).toBeInTheDocument()
    expect(screen.getByTestId('topic-right-pane-provider')).toHaveAttribute('data-default-tab', 'branch')
    expect(screen.queryByTestId('assistant-resource-list')).not.toBeInTheDocument()
    expect(screen.queryByTestId('topic-resource-panel')).not.toBeInTheDocument()
    expect(screen.queryByTestId('resource-pane-count')).not.toBeInTheDocument()
  })

  it('does not auto-open the topic right pane when switching to assistant display mode with left topic position', () => {
    homeMocks.preferenceValues.set('topic.tab.display_mode', 'assistant')
    homeMocks.preferenceValues.set('topic.tab.position', 'left')
    homeMocks.persistCacheValues.set('ui.chat.right_pane_open', false)

    render(<HomePage />)

    expect(screen.getByTestId('topic-right-pane-provider')).toHaveAttribute('data-default-open', 'false')
    expect(homeMocks.cacheSetPersist).not.toHaveBeenCalledWith('ui.chat.right_pane_open', true)
  })

  it('toggles the classic topic pane when the selected assistant is clicked again', () => {
    homeMocks.preferenceValues.set('topic.tab.display_mode', 'assistant')

    render(<HomePage />)

    fireEvent.click(screen.getByRole('button', { name: 'Toggle selected assistant pane' }))

    expect(homeMocks.cacheSetPersist).toHaveBeenCalledWith('ui.chat.right_pane_open', false)
  })

  it('renders the modern topic sidebar when topic display mode is time', () => {
    homeMocks.preferenceValues.set('topic.tab.display_mode', 'time')
    homeMocks.preferenceValues.set('topic.tab.position', 'right')

    render(<HomePage />)

    expect(screen.getByTestId('home-tabs')).toBeInTheDocument()
    expect(screen.queryByTestId('assistant-resource-list')).not.toBeInTheDocument()
    expect(screen.getByTestId('topic-right-pane-provider')).toHaveAttribute('data-default-tab', 'branch')
    expect(screen.getByTestId('pane-position')).toHaveTextContent('left')
    expect(homeMocks.homeTabsTopicsSource).toBe(homeMocks.createdAssistantTopicsSource)
  })

  it('disables the assistant topic source in message-only view', () => {
    homeMocks.locationState = undefined
    homeMocks.routeSearch = { topicId: 'topic-missing', view: 'message' }

    render(<HomePage />)

    expect(homeMocks.assistantTopicsSourceOptions.length).toBeGreaterThan(0)
    expect(homeMocks.assistantTopicsSourceOptions.every((options) => options?.enabled === false)).toBe(true)
  })

  it('switches to assistant grouping when changing topic position from the left sidebar', async () => {
    homeMocks.preferenceValues.set('topic.tab.display_mode', 'time')
    homeMocks.preferenceValues.set('topic.tab.position', 'left')
    homeMocks.persistCacheValues.set('ui.chat.right_pane_open', false)

    render(<HomePage />)

    fireEvent.click(screen.getByRole('button', { name: 'Move topics right' }))

    await waitFor(() => expect(homeMocks.preferenceValues.get('topic.tab.display_mode')).toBe('assistant'))
    expect(homeMocks.preferenceValues.get('topic.tab.position')).toBe('right')
    expect(homeMocks.cacheSetPersist).toHaveBeenCalledWith('ui.chat.right_pane_open', true)
  })

  it('expands only the active topic assistant when changing topic position to the left sidebar', async () => {
    homeMocks.preferenceValues.set('topic.tab.display_mode', 'time')
    homeMocks.preferenceValues.set('topic.tab.position', 'right')
    homeMocks.classicLayoutTopics = [
      { ...historyTopic, id: 'topic-a', assistantId: 'assistant-1' },
      { ...historyTopic, id: 'topic-b', assistantId: 'assistant-2' },
      { ...historyTopic, id: 'topic-c', assistantId: 'assistant-3' },
      { ...historyTopic, id: 'topic-default', assistantId: undefined }
    ]

    render(<HomePage />)

    fireEvent.click(screen.getByRole('button', { name: 'Move topics left' }))

    await waitFor(() => expect(homeMocks.preferenceValues.get('topic.tab.position')).toBe('left'))
    expect(homeMocks.persistCacheValues.get('ui.topic.expansion.assistant')).toEqual([
      'topic:assistant:assistant-2',
      'topic:assistant:assistant-3',
      'topic:assistant:unknown'
    ])
  })

  it('renders the assistant resource view in the chat center', () => {
    render(<HomePage />)
    const provider = screen.getByTestId('topic-right-pane-provider')
    const viewport = screen.getByTestId('topic-right-pane-viewport')

    expect(provider).toHaveAttribute('data-present', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'assistants.presets.manage.title' }))

    expect(screen.getByTestId('resource-catalog-assistant')).toBeInTheDocument()
    expect(screen.getByTestId('home-chat-shell')).toBeInTheDocument()
    expect(screen.getByTestId('topic-right-pane-provider')).toBe(provider)
    expect(screen.getByTestId('topic-right-pane-viewport')).toBe(viewport)
    expect(provider).toHaveAttribute('data-present', 'false')
    expect(screen.queryByTestId('active-topic')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Select topic next' }))

    expect(screen.queryByTestId('resource-catalog-assistant')).not.toBeInTheDocument()
    expect(screen.getByTestId('topic-right-pane-provider')).toBe(provider)
    expect(screen.getByTestId('topic-right-pane-viewport')).toBe(viewport)
    expect(provider).toHaveAttribute('data-present', 'true')
  })

  it('renders history records in the chat center and toggles them from the sidebar', () => {
    render(<HomePage />)

    fireEvent.click(screen.getByRole('button', { name: 'Open history records' }))

    expect(screen.getByTestId('history-records-view')).toBeInTheDocument()
    expect(screen.getByTestId('home-chat-shell')).toBeInTheDocument()
    expect(screen.getByTestId('home-tabs')).toHaveAttribute('data-history-active', 'true')
    expect(screen.queryByTestId('active-topic')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Open history records' }))

    expect(screen.queryByTestId('history-records-view')).not.toBeInTheDocument()
    expect(screen.getByTestId('active-topic')).toBeInTheDocument()
    expect(screen.getByTestId('home-tabs')).toHaveAttribute('data-history-active', 'false')
  })

  it('closes classic-layout history records when the active assistant is clicked', () => {
    homeMocks.preferenceValues.set('topic.tab.display_mode', 'assistant')

    render(<HomePage />)

    fireEvent.click(screen.getByRole('button', { name: 'Open history records' }))
    expect(screen.getByTestId('history-records-view')).toBeInTheDocument()
    expect(screen.getByTestId('assistant-resource-list')).toHaveAttribute('data-history-active', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'Toggle selected assistant pane' }))

    expect(screen.queryByTestId('history-records-view')).not.toBeInTheDocument()
    expect(screen.getByTestId('assistant-resource-list')).toHaveAttribute('data-history-active', 'false')
  })

  it('replaces the history center surface when opening assistant management', () => {
    render(<HomePage />)

    fireEvent.click(screen.getByRole('button', { name: 'Open history records' }))
    fireEvent.click(screen.getByRole('button', { name: 'assistants.presets.manage.title' }))

    expect(screen.queryByTestId('history-records-view')).not.toBeInTheDocument()
    expect(screen.getByTestId('resource-catalog-assistant')).toBeInTheDocument()
    expect(screen.queryByTestId('active-topic')).not.toBeInTheDocument()
  })

  it('keeps the assistant resource view open while opening the classic-layout assistant picker', () => {
    homeMocks.preferenceValues.set('topic.tab.display_mode', 'assistant')

    render(<HomePage />)

    fireEvent.click(screen.getByRole('button', { name: 'assistants.presets.manage.title' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open assistant picker' }))

    expect(screen.getByTestId('assistant-conversation-picker')).toBeInTheDocument()
    expect(screen.getByTestId('resource-catalog-assistant')).toBeInTheDocument()
    expect(screen.queryByTestId('active-topic')).not.toBeInTheDocument()
  })

  it('keeps the assistant resource view open until the selected assistant topic is ready', async () => {
    homeMocks.preferenceValues.set('topic.tab.display_mode', 'assistant')
    let resolveCreateTopic!: (topic: Topic) => void
    homeMocks.createTopic.mockReturnValue(
      new Promise<Topic>((resolve) => {
        resolveCreateTopic = resolve
      })
    )

    render(<HomePage />)

    fireEvent.click(screen.getByRole('button', { name: 'assistants.presets.manage.title' }))
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

    fireEvent.click(screen.getByRole('button', { name: 'assistants.presets.manage.title' }))

    const shell = screen.getByTestId('home-chat-shell')
    expect(within(shell).getByTestId('pane-open')).toHaveTextContent('true')

    const toolbarLeading = within(shell).getByTestId('resource-toolbar-leading')

    // Collapse the pane from the resource toolbar toggle, then confirm the toggle survives the collapse.
    fireEvent.click(within(toolbarLeading).getByRole('button'))
    await waitFor(() => expect(within(shell).getByTestId('pane-open')).toHaveTextContent('false'))

    fireEvent.click(within(toolbarLeading).getByRole('button'))
    await waitFor(() => expect(within(shell).getByTestId('pane-open')).toHaveTextContent('true'))
  })

  it('creates an empty modern-layout topic from the inline assistant catalog go-to-chat action', async () => {
    homeMocks.assistants = [{ id: 'assistant-default' }, { id: 'assistant-2' }]
    homeMocks.createTopic.mockResolvedValue({ ...createdTopic, assistantId: 'assistant-2' })

    render(<HomePage />)

    fireEvent.click(screen.getByRole('button', { name: 'assistants.presets.manage.title' }))
    fireEvent.click(screen.getByRole('button', { name: 'Go to chat with assistant 2' }))

    await waitFor(() => expect(homeMocks.createTopic).toHaveBeenCalledWith({ assistantId: 'assistant-2' }))
    expect(screen.queryByTestId('resource-catalog-assistant')).not.toBeInTheDocument()
    expect(screen.getByTestId('active-topic')).toHaveTextContent('topic-created')
    expect(screen.getByTestId('active-topic-assistant')).toHaveTextContent('assistant-2')
  })

  it('creates an empty classic-layout topic from the inline assistant catalog go-to-chat action', async () => {
    homeMocks.preferenceValues.set('topic.tab.display_mode', 'assistant')
    homeMocks.assistants = [{ id: 'assistant-default' }, { id: 'assistant-2' }]
    homeMocks.createTopic.mockResolvedValue({ ...createdTopic, assistantId: 'assistant-2' })

    render(<HomePage />)

    fireEvent.click(screen.getByRole('button', { name: 'assistants.presets.manage.title' }))
    fireEvent.click(screen.getByRole('button', { name: 'Go to chat with assistant 2' }))

    await waitFor(() => expect(homeMocks.createTopic).toHaveBeenCalledWith({ assistantId: 'assistant-2' }))
    expect(screen.queryByTestId('resource-catalog-assistant')).not.toBeInTheDocument()
    expect(screen.getByTestId('active-topic')).toHaveTextContent('topic-created')
    expect(screen.getByTestId('active-topic-assistant')).toHaveTextContent('assistant-2')
  })

  it('preserves the default assistant target when creating from the classic rail', async () => {
    homeMocks.preferenceValues.set('topic.tab.display_mode', 'assistant')
    homeMocks.assistants = [{ id: 'assistant-default' }, { id: 'assistant-2' }]
    homeMocks.persistCacheValues.set('ui.chat.last_used_assistant_id', 'assistant-2')
    homeMocks.createTopic.mockResolvedValue({ ...createdTopic, assistantId: undefined })

    render(<HomePage />)

    fireEvent.click(screen.getByRole('button', { name: 'Create default assistant topic' }))

    await waitFor(() => expect(homeMocks.createTopic).toHaveBeenCalledWith({}))
  })

  it('respects a manually closed classic-layout topic right pane on re-entry', () => {
    homeMocks.preferenceValues.set('topic.tab.display_mode', 'assistant')
    homeMocks.persistCacheValues.set('ui.chat.right_pane_open', false)

    render(<HomePage />)

    expect(screen.getByTestId('topic-right-pane-provider')).toHaveAttribute('data-default-open', 'false')
    expect(homeMocks.cacheSetPersist).not.toHaveBeenCalledWith('ui.chat.right_pane_open', true)
  })

  it('records manual close state for the classic-layout topic right pane', () => {
    homeMocks.preferenceValues.set('topic.tab.display_mode', 'assistant')

    render(<HomePage />)

    fireEvent.click(screen.getByRole('button', { name: 'Close topic right pane' }))

    expect(homeMocks.cacheSetPersist).toHaveBeenCalledWith('ui.chat.right_pane_open', false)
  })

  it('passes the current assistant topic count to the classic-layout top button', () => {
    homeMocks.preferenceValues.set('topic.tab.display_mode', 'assistant')
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
    homeMocks.preferenceValues.set('topic.tab.display_mode', 'assistant')
    homeMocks.classicLayoutTopics = [
      { ...historyTopic, id: 'topic-older', updatedAt: '2026-01-01T00:00:00.000Z' },
      { ...historyTopic, id: 'topic-latest', updatedAt: '2026-01-03T00:00:00.000Z' }
    ]

    render(<HomePage />)

    await waitFor(() => expect(screen.getByTestId('active-topic')).toHaveTextContent('topic-latest'))
    expect(homeMocks.createTopic).not.toHaveBeenCalled()
  })

  it('selects the latest historical topic by default when entering modern layout without a route topic', async () => {
    homeMocks.locationState = undefined
    homeMocks.preferenceValues.set('topic.tab.display_mode', 'time')
    homeMocks.classicLayoutTopics = [
      { ...historyTopic, id: 'topic-older', updatedAt: '2026-01-01T00:00:00.000Z' },
      { ...historyTopic, id: 'topic-latest', updatedAt: '2026-01-03T00:00:00.000Z' }
    ]

    render(<HomePage />)

    await waitFor(() => expect(screen.getByTestId('active-topic')).toHaveTextContent('topic-latest'))
    expect(homeMocks.createTopic).not.toHaveBeenCalled()
  })

  it('resumes the latest topic in modern layout from the dedicated latest query, without waiting for full history', async () => {
    homeMocks.locationState = undefined
    homeMocks.preferenceValues.set('topic.tab.display_mode', 'time')
    // The paged history is still loading in the background; the dedicated latest query has resolved.
    homeMocks.isTopicsFirstPageLoading = true
    homeMocks.isTopicsLoadingAll = true
    homeMocks.isTopicsFullyLoaded = false
    homeMocks.classicLayoutTopics = [
      { ...historyTopic, id: 'topic-older', updatedAt: '2026-01-01T00:00:00.000Z' },
      { ...historyTopic, id: 'topic-latest', updatedAt: '2026-01-03T00:00:00.000Z' }
    ]

    render(<HomePage />)

    await waitFor(() => expect(screen.getByTestId('active-topic')).toHaveTextContent('topic-latest'))
    expect(homeMocks.createTopic).not.toHaveBeenCalled()
  })

  it('resumes the latest topic even while the assistants list is still loading', async () => {
    homeMocks.locationState = undefined
    homeMocks.preferenceValues.set('topic.tab.display_mode', 'time')
    // Assistants list has not resolved yet — restoring the latest topic must not wait for it (the chat
    // center fetches its assistant by id). Mirrors the agent page's first-entry order.
    homeMocks.assistantsLoading = true
    homeMocks.latestTopicOverride = { ...historyTopic, id: 'topic-latest', updatedAt: '2026-01-03T00:00:00.000Z' }

    render(<HomePage />)

    await waitFor(() => expect(screen.getByTestId('active-topic')).toHaveTextContent('topic-latest'))
    expect(homeMocks.createTopic).not.toHaveBeenCalled()
  })

  it('restores the topic reported by the latest query even when it is outside the loaded first page', async () => {
    homeMocks.locationState = undefined
    homeMocks.preferenceValues.set('topic.tab.display_mode', 'time')
    // The loaded page holds only other topics; the dedicated latest query surfaces the true latest,
    // proving first-entry restore reads the query, not `findLatestUpdated` over the paged list.
    homeMocks.classicLayoutTopics = [{ ...historyTopic, id: 'topic-on-page', updatedAt: '2026-01-01T00:00:00.000Z' }]
    homeMocks.latestTopicOverride = { ...historyTopic, id: 'topic-off-page', updatedAt: '2026-01-09T00:00:00.000Z' }

    render(<HomePage />)

    await waitFor(() => expect(screen.getByTestId('active-topic')).toHaveTextContent('topic-off-page'))
    expect(homeMocks.createTopic).not.toHaveBeenCalled()
  })

  it('creates an empty topic on modern first entry only when the topic library is empty', async () => {
    homeMocks.locationState = undefined
    homeMocks.preferenceValues.set('topic.tab.display_mode', 'time')
    homeMocks.classicLayoutTopics = []

    render(<HomePage />)

    await waitFor(() => expect(homeMocks.createTopic).toHaveBeenCalledTimes(1))
  })

  it('does not create a topic on modern first entry while the latest query is still loading', async () => {
    homeMocks.locationState = undefined
    homeMocks.preferenceValues.set('topic.tab.display_mode', 'time')
    homeMocks.isLatestTopicLoading = true
    homeMocks.classicLayoutTopics = []

    render(<HomePage />)

    await Promise.resolve()
    expect(homeMocks.createTopic).not.toHaveBeenCalled()
  })

  it('selects the latest remaining topic after deleting the active assistant (classic layout, never draft)', async () => {
    homeMocks.locationState = undefined
    homeMocks.preferenceValues.set('topic.tab.display_mode', 'assistant')
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
    expect(homeMocks.createTopic).not.toHaveBeenCalled()
  })

  it('reuses the default/unassigned empty topic instead of stacking a new blank', async () => {
    // Regression: the default group resolves to no target assistant, so its empty placeholder was never
    // matched and repeated "new topic" for it stacked duplicate blanks.
    homeMocks.locationState = undefined
    homeMocks.preferenceValues.set('topic.tab.display_mode', 'assistant')
    homeMocks.classicLayoutTopics = [
      // Latest overall (has a conversation) → auto-selected on entry, never reusable.
      {
        ...historyTopic,
        id: 'topic-real',
        assistantId: 'assistant-1',
        activeNodeId: 'node-1',
        updatedAt: '2026-01-08T00:00:00.000Z'
      },
      // Empty placeholder with no assistant (the default/unassigned group).
      {
        ...historyTopic,
        id: 'topic-default-empty',
        assistantId: undefined,
        name: '',
        activeNodeId: undefined,
        updatedAt: '2026-01-06T00:00:00.000Z'
      }
    ]

    render(<HomePage />)
    await waitFor(() => expect(screen.getByTestId('active-topic')).toHaveTextContent('topic-real'))

    fireEvent.click(screen.getByRole('button', { name: 'Create default assistant topic' }))

    await waitFor(() => expect(screen.getByTestId('active-topic')).toHaveTextContent('topic-default-empty'))
    expect(homeMocks.createTopic).not.toHaveBeenCalled()
  })

  it('excludes the deleted active assistant when creating a fallback topic after deletion', async () => {
    homeMocks.preferenceValues.set('topic.tab.display_mode', 'assistant')
    homeMocks.assistants = [{ id: 'assistant-1' }, { id: 'assistant-2' }]
    homeMocks.persistCacheValues.set('ui.chat.last_used_assistant_id', 'assistant-1')
    homeMocks.createTopic.mockResolvedValue({ ...createdTopic, assistantId: 'assistant-2' })
    homeMocks.classicLayoutTopics = [
      { ...historyTopic, id: 'topic-a', assistantId: 'assistant-1', updatedAt: '2026-01-05T00:00:00.000Z' }
    ]

    render(<HomePage />)

    fireEvent.click(screen.getByRole('button', { name: 'Delete active assistant' }))

    await waitFor(() => expect(homeMocks.createTopic).toHaveBeenCalledWith({ assistantId: 'assistant-2' }))
    expect(screen.getByTestId('active-topic-assistant')).toHaveTextContent('assistant-2')
    expect(homeMocks.cacheSetPersist).toHaveBeenCalledWith('ui.chat.last_used_assistant_id', null)
  })

  it('clears the active topic when the fallback create fails after deleting the active assistant', async () => {
    // The deleted assistant's last topic is the active one; if the replacement create rejects, the view
    // must not be left stranded on a topic belonging to the just-deleted assistant.
    homeMocks.locationState = undefined
    homeMocks.preferenceValues.set('topic.tab.display_mode', 'assistant')
    homeMocks.classicLayoutTopics = [
      { ...historyTopic, id: 'topic-a', assistantId: 'assistant-a', updatedAt: '2026-01-05T00:00:00.000Z' }
    ]
    homeMocks.createTopic.mockRejectedValue(new Error('create failed'))

    render(<HomePage />)
    await waitFor(() => expect(screen.getByTestId('active-topic')).toHaveTextContent('topic-a'))

    fireEvent.click(screen.getByRole('button', { name: 'Delete active assistant' }))

    await waitFor(() => expect(homeMocks.createTopic).toHaveBeenCalled())
    await waitFor(() => expect(screen.queryByTestId('active-topic')).not.toBeInTheDocument())
  })

  it('creates and activates an empty topic after selecting an existing assistant from the classic-layout picker', async () => {
    homeMocks.preferenceValues.set('topic.tab.display_mode', 'assistant')
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
    homeMocks.preferenceValues.set('topic.tab.display_mode', 'assistant')
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
    homeMocks.preferenceValues.set('topic.tab.display_mode', 'assistant')
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
    homeMocks.preferenceValues.set('topic.tab.display_mode', 'assistant')
    homeMocks.classicLayoutTopics = [
      {
        id: 'topic-empty-latest',
        assistantId: 'assistant-2',
        name: '',
        createdAt: '2026-01-03T00:00:00.000Z',
        updatedAt: '2026-01-03T00:00:00.000Z'
      },
      // Has an active node (a started conversation) → not an empty placeholder, never reused.
      {
        id: 'topic-real-older',
        assistantId: 'assistant-2',
        name: 'Real chat',
        activeNodeId: 'node-real',
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
    homeMocks.preferenceValues.set('topic.tab.display_mode', 'assistant')
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
    homeMocks.preferenceValues.set('topic.tab.display_mode', 'assistant')
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
    homeMocks.preferenceValues.set('topic.tab.display_mode', 'assistant')
    homeMocks.assistants = [{ id: 'assistant-1' }, { id: 'assistant-default' }]
    homeMocks.classicLayoutTopics = [
      {
        id: 'topic-real-latest',
        assistantId: 'assistant-1',
        name: 'Real chat',
        activeNodeId: 'node-real',
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
    homeMocks.preferenceValues.set('topic.tab.display_mode', 'assistant')
    // Auto-naming off keeps the name blank, but `activeNodeId` points at a real message — this is a
    // chatted-in conversation that must NOT be reopened as a reusable empty placeholder (#16434).
    // Timestamps are equal here on purpose: emptiness is decided by `activeNodeId`, not by them, so a
    // migrated row whose createdAt === updatedAt is still excluded when it carries messages.
    homeMocks.classicLayoutTopics = [
      {
        id: 'topic-chatted-blank',
        assistantId: 'assistant-2',
        name: '',
        activeNodeId: 'node-chatted',
        createdAt: '2026-01-03T00:00:00.000Z',
        updatedAt: '2026-01-03T00:00:00.000Z'
      }
    ]
    homeMocks.createTopic.mockResolvedValue({ ...createdTopic, assistantId: 'assistant-2' })

    render(<HomePage />)

    fireEvent.click(screen.getByRole('button', { name: 'Open assistant picker' }))
    fireEvent.click(screen.getByRole('button', { name: 'Select my assistant' }))

    await waitFor(() => expect(homeMocks.createTopic).toHaveBeenCalledWith({ assistantId: 'assistant-2' }))
  })

  it('reuses an empty topic whose updatedAt was bumped past createdAt with no active node in the classic-layout picker', async () => {
    homeMocks.preferenceValues.set('topic.tab.display_mode', 'assistant')
    // A non-message write (e.g. a group/trace update) can move updatedAt past createdAt while the topic
    // stays empty. Emptiness is decided by `activeNodeId`, not the timestamp, so this is still reused.
    homeMocks.classicLayoutTopics = [
      {
        id: 'topic-empty-bumped',
        assistantId: 'assistant-2',
        name: '',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-03T00:00:00.000Z'
      }
    ]

    render(<HomePage />)

    fireEvent.click(screen.getByRole('button', { name: 'Open assistant picker' }))
    fireEvent.click(screen.getByRole('button', { name: 'Select my assistant' }))

    await waitFor(() => expect(screen.getByTestId('active-topic')).toHaveTextContent('topic-empty-bumped'))
    expect(homeMocks.createTopic).not.toHaveBeenCalled()
  })

  it('ignores a rapid double-click on the classic-layout composer new-topic action', () => {
    homeMocks.preferenceValues.set('topic.tab.display_mode', 'assistant')
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

  it('selects a reused topic in the current tab even when another tab may already show it', async () => {
    homeMocks.preferenceValues.set('topic.tab.display_mode', 'assistant')
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

    await waitFor(() => expect(screen.getByTestId('active-topic')).toHaveTextContent('topic-empty-latest'))
    expect(homeMocks.createTopic).not.toHaveBeenCalled()
  })

  it('toasts and leaves the active topic untouched when classic-layout picker topic creation fails', async () => {
    homeMocks.preferenceValues.set('topic.tab.display_mode', 'assistant')
    homeMocks.classicLayoutTopics = []
    homeMocks.createTopic.mockRejectedValue(new Error('create failed'))

    render(<HomePage />)

    fireEvent.click(screen.getByRole('button', { name: 'Open assistant picker' }))
    fireEvent.click(screen.getByRole('button', { name: 'Select my assistant' }))

    await waitFor(() => expect(homeMocks.createTopic).toHaveBeenCalledWith({ assistantId: 'assistant-2' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(screen.queryByTestId('active-topic')?.textContent).not.toBe('topic-created')
  })

  it('toasts when the classic-layout composer empty-topic creation fails', async () => {
    homeMocks.preferenceValues.set('topic.tab.display_mode', 'assistant')
    homeMocks.assistants = [{ id: 'assistant-1' }, { id: 'assistant-default' }]
    homeMocks.classicLayoutTopics = []
    homeMocks.createTopic.mockRejectedValue(new Error('create failed'))

    render(<HomePage />)

    fireEvent.click(screen.getByRole('button', { name: 'Create empty topic from composer' }))

    await waitFor(() => expect(homeMocks.createTopic).toHaveBeenCalled())
    await waitFor(() => expect(toast.error).toHaveBeenCalled())
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
  it('temporarily hides and restores the topic sidebar for responsive auto-collapse without changing the user preference', async () => {
    homeMocks.preferenceValues.set('topic.tab.show', true)

    render(<HomePage />)

    expect(screen.getByTestId('pane-open')).toHaveTextContent('true')

    fireEvent.click(screen.getByRole('button', { name: 'Auto collapse pane' }))

    await waitFor(() => expect(screen.getByTestId('pane-open')).toHaveTextContent('false'))
    expect(homeMocks.setShowSidebar).not.toHaveBeenCalled()
    expect(homeMocks.preferenceValues.get('topic.tab.show')).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Auto restore pane' }))

    await waitFor(() => expect(screen.getByTestId('pane-open')).toHaveTextContent('true'))
    expect(homeMocks.setShowSidebar).not.toHaveBeenCalled()
    expect(homeMocks.preferenceValues.get('topic.tab.show')).toBe(true)
  })

  it('keeps the topic sidebar open after selecting a topic from the sidebar', async () => {
    homeMocks.preferenceValues.set('topic.tab.show', true)

    render(<HomePage />)

    fireEvent.click(screen.getByRole('button', { name: 'Select topic next' }))

    await waitFor(() => expect(screen.getByTestId('active-topic')).toHaveTextContent('topic-next'))
    expect(homeMocks.setShowSidebar).not.toHaveBeenCalledWith(false)
    expect(screen.getByTestId('pane-open')).toHaveTextContent('true')
  })

  it('creates an empty topic when history clears the selected topic', async () => {
    homeMocks.createTopic.mockResolvedValue({ ...createdTopic, assistantId: 'assistant-default' })

    render(<HomePage />)

    fireEvent.click(screen.getByRole('button', { name: 'Open history records' }))
    fireEvent.click(screen.getByRole('button', { name: 'Clear history selection' }))

    await waitFor(() => expect(homeMocks.createTopic).toHaveBeenCalledWith({ assistantId: 'assistant-default' }))
    expect(screen.getByTestId('active-topic')).toHaveTextContent('topic-created')
    expect(screen.getByTestId('active-topic-assistant')).toHaveTextContent('assistant-default')
  })

  it('toggles the left sidebar off with the left sidebar shortcut', () => {
    homeMocks.preferenceValues.set('topic.tab.show', true)

    render(<HomePage />)

    const shortcutHandler = vi
      .mocked(useCommandHandler)
      .mock.calls.filter(([command]) => command === 'app.sidebar.toggle')
      .at(-1)?.[1]

    expect(shortcutHandler).toBeDefined()

    act(() => {
      void shortcutHandler?.()
    })

    expect(homeMocks.setShowSidebar).toHaveBeenCalledWith(false)
  })

  it('keeps detached topic sidebar state local, default-closed, and fixed on the left', () => {
    homeMocks.preferenceValues.set('topic.tab.show', true)
    homeMocks.preferenceValues.set('topic.tab.display_mode', 'assistant')
    homeMocks.preferenceValues.set('topic.tab.position', 'right')

    const { unmount } = render(
      <WindowFrameProvider value={{ mode: 'window' }}>
        <HomePage />
      </WindowFrameProvider>
    )

    expect(screen.getByTestId('pane-open')).toHaveTextContent('false')
    expect(screen.getByTestId('show-resource-list-controls')).toHaveTextContent('true')
    expect(screen.getByTestId('home-tabs')).toBeInTheDocument()
    expect(screen.queryByTestId('assistant-resource-list')).not.toBeInTheDocument()
    expect(screen.queryByTestId('topic-resource-panel')).not.toBeInTheDocument()
    expect(screen.queryByTestId('resource-pane-count')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Move topics right' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open history records' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'assistants.presets.manage.title' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Toggle sidebar' }))
    expect(screen.getByTestId('pane-open')).toHaveTextContent('true')

    fireEvent.click(screen.getByRole('button', { name: 'Select topic next' }))
    expect(screen.getByTestId('active-topic')).toHaveTextContent('topic-next')
    expect(screen.getByTestId('pane-open')).toHaveTextContent('true')

    const shortcutHandler = vi
      .mocked(useCommandHandler)
      .mock.calls.filter(([command]) => command === 'app.sidebar.toggle')
      .at(-1)?.[1]

    act(() => {
      void shortcutHandler?.()
    })

    expect(screen.getByTestId('pane-open')).toHaveTextContent('false')
    expect(homeMocks.setShowSidebar).not.toHaveBeenCalled()

    unmount()
    homeMocks.persistCacheValues.set('ui.global_search.recent_items', [])
    render(
      <WindowFrameProvider value={{ mode: 'window' }}>
        <HomePage />
      </WindowFrameProvider>
    )
    expect(screen.getByTestId('pane-open')).toHaveTextContent('false')
  })

  it('uses the compact minimum window width even while the topic sidebar is open', async () => {
    homeMocks.preferenceValues.set('topic.tab.show', true)

    render(<HomePage />)

    await waitFor(() => {
      expect(ipcMocks.request).toHaveBeenCalledWith('window.main.set_minimum_size', {
        width: SECOND_MIN_WINDOW_WIDTH,
        height: MIN_WINDOW_HEIGHT
      })
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
      topicMessageHandler?.({ topic: historyTopic, messageId: 'message-target', targetTabId: 'chat-tab' })
    })

    await waitFor(() => expect(screen.getByTestId('active-topic')).toHaveTextContent('topic-history'))
    expect(screen.getByTestId('locate-message-id')).toHaveTextContent('message-target')

    fireEvent.click(screen.getByRole('button', { name: 'Locate handled' }))
    expect(screen.getByTestId('locate-message-id')).toHaveTextContent('')
  })

  it('writes locate state into the current tab for a global-search topic message', async () => {
    homeMocks.locationState = undefined

    render(<HomePage />)

    const topicMessageHandler = vi
      .mocked(EventEmitter.on)
      .mock.calls.find(([eventName]) => eventName === EVENT_NAMES.GLOBAL_SEARCH_SELECT_TOPIC_MESSAGE)?.[1] as
      | ((payload: unknown) => void)
      | undefined

    act(() => {
      topicMessageHandler?.({ topic: historyTopic, messageId: 'message-target', targetTabId: 'chat-tab' })
    })

    await waitFor(() => expect(screen.getByTestId('active-topic')).toHaveTextContent('topic-history'))
    expect(screen.getByTestId('locate-message-id')).toHaveTextContent('message-target')
  })

  it('ignores a global-search topic message targeted at another tab', async () => {
    render(<HomePage />)

    const topicMessageHandler = vi
      .mocked(EventEmitter.on)
      .mock.calls.find(([eventName]) => eventName === EVENT_NAMES.GLOBAL_SEARCH_SELECT_TOPIC_MESSAGE)?.[1] as
      | ((payload: unknown) => void)
      | undefined

    act(() => {
      topicMessageHandler?.({ topic: historyTopic, messageId: 'message-target', targetTabId: 'other-chat-tab' })
    })

    await waitFor(() => expect(screen.getByTestId('active-topic')).toHaveTextContent('topic-initial'))
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

  it('waits for a cached active topic before creating the first-launch empty topic', () => {
    homeMocks.locationState = undefined
    homeMocks.activeTopicLoading = true
    homeMocks.forceActiveTopicUndefined = true

    const { rerender } = render(<HomePage />)

    expect(screen.queryByTestId('active-topic')).not.toBeInTheDocument()
    expect(homeMocks.createTopic).not.toHaveBeenCalled()
    const provider = screen.getByTestId('topic-right-pane-provider')
    const viewport = screen.getByTestId('topic-right-pane-viewport')

    homeMocks.activeTopicLoading = false
    homeMocks.forceActiveTopicUndefined = false
    homeMocks.activeTopicOverride = initialTopic
    rerender(<HomePage />)

    expect(screen.getByTestId('active-topic')).toHaveTextContent('topic-initial')
    expect(screen.getByTestId('topic-right-pane-provider')).toBe(provider)
    expect(screen.getByTestId('topic-right-pane-viewport')).toBe(viewport)
    expect(homeMocks.createTopic).not.toHaveBeenCalled()
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

  it('creates the first-launch empty topic from the remembered assistant', async () => {
    homeMocks.locationState = undefined
    homeMocks.assistants = [{ id: 'assistant-default' }, { id: 'assistant-2' }]
    homeMocks.persistCacheValues.set('ui.chat.last_used_assistant_id', 'assistant-2')
    homeMocks.createTopic.mockResolvedValue({ ...createdTopic, assistantId: 'assistant-2' })

    render(<HomePage />)

    await waitFor(() => expect(homeMocks.createTopic).toHaveBeenCalledWith({ assistantId: 'assistant-2' }))
    expect(screen.getByTestId('active-topic')).toHaveTextContent('topic-created')
    expect(vi.mocked(useTabSelfMetadata)).toHaveBeenLastCalledWith(
      expect.objectContaining({
        instanceAppId: 'assistants',
        instanceKey: 'topic-created'
      })
    )
  })

  it('reuses a first-launch empty topic from the shared topic source', async () => {
    homeMocks.locationState = undefined
    homeMocks.assistants = [{ id: 'assistant-default' }, { id: 'assistant-2' }]
    homeMocks.persistCacheValues.set('ui.chat.last_used_assistant_id', 'assistant-2')
    homeMocks.classicLayoutTopics = [
      {
        id: 'topic-empty-first-launch',
        assistantId: 'assistant-2',
        name: '',
        createdAt: '2026-01-04T00:00:00.000Z',
        updatedAt: '2026-01-04T00:00:00.000Z'
      }
    ]

    render(<HomePage />)

    await waitFor(() => expect(screen.getByTestId('active-topic')).toHaveTextContent('topic-empty-first-launch'))
    expect(homeMocks.createTopic).not.toHaveBeenCalled()
  })

  it('creates a new topic from the selected assistant payload', async () => {
    homeMocks.assistants = [{ id: 'assistant-default' }, { id: 'assistant-2' }]
    homeMocks.createTopic.mockResolvedValue({ ...createdTopic, assistantId: 'assistant-2' })

    render(<HomePage />)

    fireEvent.click(screen.getByRole('button', { name: 'New topic with assistant 2' }))

    await waitFor(() => expect(homeMocks.createTopic).toHaveBeenCalledWith({ assistantId: 'assistant-2' }))
    expect(screen.getByTestId('active-topic-assistant')).toHaveTextContent('assistant-2')
  })

  it('reuses a modern-layout empty topic from the shared topic source', async () => {
    homeMocks.assistants = [{ id: 'assistant-default' }, { id: 'assistant-2' }]
    homeMocks.classicLayoutTopics = [
      {
        id: 'topic-empty-modern',
        assistantId: 'assistant-2',
        name: '',
        createdAt: '2026-01-04T00:00:00.000Z',
        updatedAt: '2026-01-04T00:00:00.000Z'
      }
    ]

    render(<HomePage />)

    fireEvent.click(screen.getByRole('button', { name: 'New topic with assistant 2' }))

    await waitFor(() => expect(screen.getByTestId('active-topic')).toHaveTextContent('topic-empty-modern'))
    expect(homeMocks.createTopic).not.toHaveBeenCalled()
  })

  it('excludes the just-deleted topic from reuse so the post-delete replacement creates a fresh one', async () => {
    // Regression: after deleting the last topic of an assistant, the stale candidate list still holds
    // the deleted empty topic. Without the exclusion the fallback would reactivate the deleted id
    // instead of creating a replacement, stranding the view on a non-existent topic.
    homeMocks.assistants = [{ id: 'assistant-default' }, { id: 'assistant-2' }]
    homeMocks.classicLayoutTopics = [
      {
        id: 'topic-empty-modern',
        assistantId: 'assistant-2',
        name: '',
        createdAt: '2026-01-04T00:00:00.000Z',
        updatedAt: '2026-01-04T00:00:00.000Z'
      }
    ]
    homeMocks.createTopic.mockResolvedValue({ ...createdTopic, assistantId: 'assistant-2' })

    render(<HomePage />)

    fireEvent.click(screen.getByRole('button', { name: 'Replace deleted topic for assistant 2' }))

    await waitFor(() => expect(homeMocks.createTopic).toHaveBeenCalledWith({ assistantId: 'assistant-2' }))
    await waitFor(() => expect(screen.getByTestId('active-topic')).toHaveTextContent('topic-created'))
    expect(screen.getByTestId('active-topic')).not.toHaveTextContent('topic-empty-modern')
  })

  it('clears the active topic when the post-delete replacement create fails', async () => {
    // Delete flow passes `excludeReuseTopicId`; when the replacement create rejects, the active topic
    // still points at the just-deleted topic, so it must be cleared instead of stranding the view.
    homeMocks.assistants = [{ id: 'assistant-default' }, { id: 'assistant-2' }]
    homeMocks.classicLayoutTopics = []
    homeMocks.createTopic.mockRejectedValue(new Error('create failed'))

    render(<HomePage />)
    expect(screen.getByTestId('active-topic')).toHaveTextContent('topic-initial')

    fireEvent.click(screen.getByRole('button', { name: 'Replace deleted topic for assistant 2' }))

    await waitFor(() => expect(homeMocks.createTopic).toHaveBeenCalled())
    await waitFor(() => expect(screen.queryByTestId('active-topic')).not.toBeInTheDocument())
  })

  it('reuses the current modern-layout empty topic even before the topic source refreshes', async () => {
    homeMocks.assistants = [{ id: 'assistant-1' }, { id: 'assistant-default' }]
    homeMocks.locationState = {
      topic: {
        ...initialTopic,
        id: 'topic-empty-current',
        name: '',
        createdAt: '2026-01-04T00:00:00.000Z',
        updatedAt: '2026-01-04T00:00:00.000Z'
      }
    }
    homeMocks.classicLayoutTopics = []

    render(<HomePage />)

    fireEvent.click(screen.getByRole('button', { name: 'Create empty topic from composer' }))

    await waitFor(() => expect(screen.getByTestId('active-topic')).toHaveTextContent('topic-empty-current'))
    expect(homeMocks.createTopic).not.toHaveBeenCalled()
  })

  it('creates the first-launch topic immediately without opening a stream', async () => {
    homeMocks.locationState = undefined
    homeMocks.assistants = [{ id: 'assistant-default' }, { id: 'assistant-2' }]
    homeMocks.persistCacheValues.set('ui.chat.last_used_assistant_id', 'assistant-2')
    homeMocks.createTopic.mockResolvedValue({ ...createdTopic, assistantId: 'assistant-2' })

    render(<HomePage />)

    await waitFor(() => expect(homeMocks.createTopic).toHaveBeenCalledWith({ assistantId: 'assistant-2' }))
    await waitFor(() => expect(screen.getByTestId('active-topic')).toHaveTextContent('topic-created'))
    expect(homeMocks.refreshTopics).toHaveBeenCalled()
  })

  it('unlocks first-launch empty topic creation after a failure', async () => {
    homeMocks.locationState = undefined
    homeMocks.createTopic
      .mockRejectedValueOnce(new Error('create failed'))
      .mockResolvedValueOnce({ ...createdTopic, assistantId: 'assistant-default' })
    vi.mocked(toast.error).mockClear()

    const { rerender } = render(<HomePage />)

    await waitFor(() => expect(homeMocks.createTopic).toHaveBeenCalledTimes(1))
    expect(toast.error).toHaveBeenCalled()

    rerender(<HomePage />)

    await waitFor(() => expect(homeMocks.createTopic).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getByTestId('active-topic')).toHaveTextContent('topic-created'))
  })

  it('uses a valid explicit payload assistant before remembered and first assistants', async () => {
    homeMocks.assistants = [{ id: 'assistant-1' }, { id: 'assistant-2' }]
    homeMocks.persistCacheValues.set('ui.chat.last_used_assistant_id', 'assistant-1')

    render(<HomePage />)

    fireEvent.click(screen.getByRole('button', { name: 'New topic with assistant 2' }))

    await waitFor(() => expect(homeMocks.createTopic).toHaveBeenCalledWith({ assistantId: 'assistant-2' }))
    expect(screen.getByTestId('active-topic-assistant')).toHaveTextContent('assistant-2')
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
