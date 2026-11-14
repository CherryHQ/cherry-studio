import { createRootRoute, createRoute, createRouter, createMemoryHistory, RouterProvider } from '@tanstack/react-router'
import { MockCacheUtils } from '@test-mocks/renderer/CacheService'
import { MockDataApiUtils } from '@test-mocks/renderer/DataApiService'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import type * as ReactI18nextModule from 'react-i18next'
import { SWRConfig } from 'swr'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { dataApiService } from '@data/DataApiService'
import type { Topic } from '@renderer/types/topic'
import { DataApiErrorFactory } from '@shared/data/api/errors'

const virtualMocks = vi.hoisted(() => ({
  useVirtualizer: vi.fn((options: { count: number; estimateSize: (index: number) => number }) => ({
    getVirtualItems: () =>
      Array.from({ length: options.count }, (_, index) => ({
        index,
        key: `row-${index}`,
        start: index * options.estimateSize(index),
        size: options.estimateSize(index)
      })),
    getTotalSize: () => options.count * 56,
    measureElement: vi.fn(),
    scrollElement: null,
    scrollToIndex: virtualMocks.scrollToIndex
  })),
  scrollToIndex: vi.fn()
}))

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: virtualMocks.useVirtualizer,
  defaultRangeExtractor: vi.fn((range) =>
    Array.from({ length: range.endIndex - range.startIndex + 1 }, (_, i) => range.startIndex + i)
  )
}))

const dndMocks = vi.hoisted(() => ({
  droppableData: new Map<string, unknown>(),
  onDragEnd: undefined as undefined | ((event: any) => void),
  onDragOver: undefined as undefined | ((event: any) => void),
  sortableData: new Map<string, unknown>()
}))

vi.mock('@dnd-kit/core', () => {
  const React = require('react')
  return {
    DndContext: ({ children, onDragEnd, onDragOver }: { children: ReactNode; onDragEnd?: any; onDragOver?: any }) => {
      dndMocks.onDragEnd = onDragEnd
      dndMocks.onDragOver = onDragOver
      return React.createElement('div', { 'data-testid': 'dnd-context' }, children)
    },
    DragOverlay: ({ children }: { children: ReactNode }) =>
      React.createElement('div', { 'data-testid': 'drag-overlay' }, children),
    KeyboardSensor: vi.fn(),
    PointerSensor: vi.fn(),
    useDroppable: ({ data, id }: { data: unknown; id: string }) => {
      dndMocks.droppableData.set(id, data)
      return { isOver: false, setNodeRef: vi.fn() }
    },
    useSensor: vi.fn((sensor, options) => ({ sensor, options })),
    useSensors: vi.fn((...sensors) => sensors)
  }
})

vi.mock('@dnd-kit/sortable', () => {
  const React = require('react')
  return {
    SortableContext: ({ children }: { children: ReactNode }) =>
      React.createElement('div', { 'data-testid': 'sortable-context' }, children),
    useSortable: ({ data, id }: { data?: unknown; id: string }) => {
      if (data) {
        dndMocks.sortableData.set(id, data)
      }

      return {
        attributes: { 'data-sortable-id': id },
        listeners: {},
        setActivatorNodeRef: vi.fn(),
        setNodeRef: vi.fn(),
        transform: null,
        transition: undefined,
        isDragging: false
      }
    },
    verticalListSortingStrategy: vi.fn(() => null)
  }
})

const initialTopic: Topic = {
  id: 'topic-initial',
  assistantId: 'assistant-1',
  name: 'Initial topic',
  lastActivityAt: '2026-01-01T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  messages: [],
  pinned: false,
  isNameManuallyEdited: false
}

const homeMocks = vi.hoisted(() => ({
  cacheSetPersist: vi.fn(),
  addAssistant: vi.fn(),
  setShowSidebar: vi.fn(),
  assistants: [] as Array<{ id: string }>,
  assistantsTotal: undefined as number | undefined,
  missingAssistant: false,
  assistantsLoaded: true,
  assistantsLoading: false,
  assistantsRefreshing: false,
  assistantsError: undefined,
  persistCacheValues: new Map<string, unknown>(),
  preferenceValues: new Map<string, unknown>(),
  classicLayoutTopics: [] as Topic[],
  isTopicsFirstPageLoading: false,
  isTopicsLoadingAll: false,
  isTopicsFullyLoaded: true,
  loadLatestTopic: vi.fn(),
  reuseOrCreateTopic: vi.fn(),
  createdAssistantTopicsSource: undefined as unknown,
  isActiveTab: false,
  realHandler: false,
  realTopics: false,
  realOwnerQuery: false,
  deferOwnerNotification: false,
  ownerNotification: undefined as (() => void) | undefined,
  ownerChanged: undefined as ((topic: Topic) => void) | undefined,
  archiveUndo: vi.fn(),
  archiveRelease: vi.fn(),
  archiveOnPending: undefined as ((id: string, pending: boolean, token?: symbol) => void) | undefined,
  archiveNeighbour: undefined as ((archived: Topic, replacement: Topic, token?: symbol) => void) | undefined,
  archiveSelect: undefined as ((topic: Topic) => void) | undefined,
  archiveOnSettled: undefined as ((topic: Topic, token?: symbol) => void) | undefined
}))

vi.mock('@renderer/services/recycleBinFeedback', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@renderer/services/recycleBinFeedback')>()),
  showRecycleBinUndo: homeMocks.archiveUndo
}))
vi.mock('@cherrystudio/ui', async (importOriginal) => {
  const { MockCherrystudioUI } = await import('@test-mocks/renderer/CherrystudioUI')
  return { ...(await importOriginal<typeof import('@cherrystudio/ui')>()), ...MockCherrystudioUI }
})
vi.mock('@renderer/hooks/command', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@renderer/hooks/command')>()),
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
    useMultiplePreferences: () => [{}, vi.fn()],
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

vi.mock('@renderer/data/hooks/useCache', async (importOriginal) => {
  const React = await import('react')

  return {
    ...(await importOriginal<typeof import('@renderer/data/hooks/useCache')>()),
    useSharedCacheValue: () => undefined,
    useCache: () => [undefined, vi.fn()],
    usePersistCache: (key: string) => {
      const [value, setValue] = React.useState<unknown>(() => {
        if (homeMocks.persistCacheValues.has(key)) {
          return homeMocks.persistCacheValues.get(key)
        }

        return null
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
vi.mock('@renderer/hooks/tab', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@renderer/hooks/tab')>()),
  useCloseConversationTabs: () => vi.fn(),
  useOptionalTabsContext: () => null,
  useCurrentTabId: () => 'chat-tab',
  useIsActiveTab: () => homeMocks.isActiveTab,
  useTabSelfVisuals: vi.fn()
}))
vi.mock('@renderer/hooks/useAssistant', async (importOriginal) => {
  const original = await importOriginal<typeof import('@renderer/hooks/useAssistant')>()
  return {
    ...original,
    useAssistants: () => ({
      assistants: homeMocks.assistants,
      total: homeMocks.assistantsTotal ?? homeMocks.assistants.length,
      hasLoaded: homeMocks.assistantsLoaded,
      isLoading: homeMocks.assistantsLoading,
      isRefreshing: homeMocks.assistantsRefreshing,
      error: homeMocks.assistantsError,
      refetch: vi.fn(),
      addAssistant: homeMocks.addAssistant,
      removeAssistant: vi.fn(),
      updateAssistant: vi.fn()
    }),
    useAssistantApiById: (id?: string) =>
      homeMocks.realOwnerQuery
        ? original.useAssistantApiById(id)
        : {
            assistant: id && !homeMocks.missingAssistant ? { id } : undefined,
            isLoading: false,
            error: homeMocks.missingAssistant ? DataApiErrorFactory.notFound('Assistant', id ?? '') : undefined,
            refetch: vi.fn(),
            mutate: vi.fn()
          }
  }
})
vi.mock('@renderer/hooks/resourceViewSources', async () => {
  const React = await import('react')

  return {
    // Match the real useTopics shape: isLoading (first page) / isLoadingAll / isFullyLoaded present.
    useAssistantTopicsSource: () => {
      const topics = homeMocks.classicLayoutTopics
      const source = React.useMemo(
        () => ({
          topics,
          // Mirror the real mapped view: rendererTopics are separate renderer-shape
          // objects, so a consumer reading the raw `topics` list fails identity checks.
          rendererTopics: topics.map((topic) => ({ ...topic, messages: [], pinned: false })),
          refetch: vi.fn(),
          orderSignature: '',
          isLoading: homeMocks.isTopicsFirstPageLoading,
          isLoadingAll: homeMocks.isTopicsLoadingAll,
          isFullyLoaded: homeMocks.isTopicsFullyLoaded,
          error: undefined,
          loadLatestTopic: homeMocks.loadLatestTopic,
          reuseOrCreateTopic: homeMocks.reuseOrCreateTopic
        }),
        [topics]
      )
      homeMocks.createdAssistantTopicsSource = source
      return source
    }
  }
})

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactI18nextModule>()),
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'chat.home.welcome_title': 'Welcome',
        'chat.topics.title': '对话',
        'common.loading': 'Loading...'
      })[key] ?? key
  })
}))
vi.mock('../components/TopicRightPane', () => {
  const TopicRightPaneScope = ({
    children,
    defaultOpen,
    onOpenChange,
    present,
    resourcePane,
    userOpenIntentSeq
  }: {
    children: ReactNode
    defaultOpen?: boolean
    onOpenChange?: (open: boolean) => void
    present?: boolean
    resourcePane?: { node?: ReactNode; label?: string } | null
    userOpenIntentSeq?: number
  }) => (
    <div
      data-default-open={String(Boolean(defaultOpen))}
      data-default-tab={resourcePane ? 'resources' : 'branch'}
      data-present={String(present !== false)}
      data-user-open-intent-seq={String(userOpenIntentSeq ?? 0)}
      data-testid="topic-right-pane-provider">
      {onOpenChange && (
        <button type="button" onClick={() => onOpenChange(false)}>
          Close topic right pane
        </button>
      )}
      {resourcePane?.node}
      {children}
    </div>
  )
  const TopicRightPane = {
    Scope: TopicRightPaneScope,
    Viewport: () => <div data-testid="topic-right-pane-viewport" />,
    Shortcuts: () => <button type="button">Topic right pane shortcuts</button>
  }

  return {
    TopicRightPane
  }
})

vi.mock('@renderer/services/EventService', () => ({
  EVENT_NAMES: {
    FOCUS_CHAT_COMPOSER: 'FOCUS_CHAT_COMPOSER',
    GLOBAL_SEARCH_SELECT_TOPIC: 'GLOBAL_SEARCH_SELECT_TOPIC',
    GLOBAL_SEARCH_SELECT_TOPIC_MESSAGE: 'GLOBAL_SEARCH_SELECT_TOPIC_MESSAGE',
    REVEAL_ACTIVE_RESOURCE_LIST: 'REVEAL_ACTIVE_RESOURCE_LIST'
  },
  EventEmitter: {
    emit: vi.fn(),
    on: vi.fn(() => vi.fn())
  }
}))
vi.unmock('@tanstack/react-router')
vi.mock('@data/hooks/useDataApi', (importOriginal) => importOriginal())
vi.mock('@renderer/data/hooks/useDataApi', (importOriginal) => importOriginal())
vi.mock('@renderer/components/VirtualList', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@renderer/components/VirtualList')>()),
  DynamicVirtualList: ({ list, children, header }: any) => (
    <div>
      {header}
      {list.map((item: any, index: number) => (
        <div key={item.id ?? index}>{children(item, index)}</div>
      ))}
    </div>
  )
}))
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: vi.fn() }, useIpcOn: vi.fn() }))
vi.mock('../Chat', () => ({
  default: ({ activeTopic, pane, centerSurface }: any) => (
    <div>
      <output aria-label="Active topic">{activeTopic?.id ?? 'empty'}</output>
      <output aria-label="Active owner">{activeTopic?.assistantId ?? 'none'}</output>
      {pane}
      {centerSurface?.content}
    </div>
  )
}))
vi.mock('../components/ChatNavbar', () => ({ ChatNavbar: () => null }))
vi.mock('@renderer/components/chat/resourceList/AssistantResourceList', () => ({
  AssistantResourceList: ({ activeAssistantId, onOpenHistoryRecords }: any) => (
    <div>
      <output aria-label="Assistant">{activeAssistantId ?? 'none'}</output>
      <button type="button" onClick={onOpenHistoryRecords}>
        History
      </button>
    </div>
  )
}))
vi.mock('../Tabs/HomeTabs', async () => {
  const { Topics } = await import('../Tabs/components/topics')
  return {
    default: (props: any) =>
      homeMocks.realTopics ? (
        <>
          <button type="button" onClick={props.onOpenHistoryRecords}>
            History
          </button>
          <Topics {...props} />
        </>
      ) : null
  }
})
vi.mock('../Tabs/components/topics', async (importOriginal) => {
  const original = await importOriginal<typeof import('../Tabs/components/topics')>()
  return {
    Topics: (props: any) => {
      homeMocks.ownerChanged = props.onSelectedTopicOwnerChanged
      homeMocks.archiveNeighbour = props.onLocalArchiveRecordSelected
      homeMocks.archiveOnPending = props.onLocalArchivePendingChange
      homeMocks.archiveOnSettled = props.onActiveTopicArchived
      homeMocks.archiveSelect = props.setActiveTopic
      return homeMocks.realTopics ? (
        <original.Topics
          {...props}
          onSelectedTopicOwnerChanged={(topic) => {
            if (homeMocks.deferOwnerNotification)
              homeMocks.ownerNotification = () => props.onSelectedTopicOwnerChanged?.(topic)
            else props.onSelectedTopicOwnerChanged?.(topic)
          }}
        />
      ) : null
    }
  }
})
vi.mock('../components/AssistantConversationPickerDialog', () => ({ AssistantConversationPickerDialog: () => null }))
vi.mock('@renderer/components/history/HistoryRecordsView', async (importOriginal) => {
  const original = await importOriginal<typeof import('@renderer/components/history/HistoryRecordsView')>()
  return {
    ...original,
    default: (props: any) => (
      <original.default
        {...props}
        onLocalArchivePendingChange={(id: string, pending: boolean, token?: symbol) => {
          props.onLocalArchivePendingChange?.(id, pending, token)
          if (!pending) homeMocks.archiveRelease(id, token)
        }}
      />
    )
  }
})
import { ipcApi } from '@renderer/ipc'
import { Route as ChatRoute } from '@renderer/routes/app/chat'

import HomePage from '../HomePage'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

// Real History cases drive the archive action through IPC; the remaining cases isolate page ownership.
describe('HomePage archive route settlement', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    homeMocks.assistantsTotal = undefined
    homeMocks.missingAssistant = false
    homeMocks.archiveRelease.mockReset()
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    MockCacheUtils.resetMocks()
    MockDataApiUtils.resetMocks()
    homeMocks.assistants = [{ id: 'assistant-1' }, { id: 'assistant-2' }]
    homeMocks.preferenceValues.clear()
    homeMocks.preferenceValues.set('topic.tab.display_mode', 'assistant')
    homeMocks.preferenceValues.set('topic.tab.position', 'right')
    homeMocks.preferenceValues.set('topic.tab.show', false)
    homeMocks.persistCacheValues.clear()
    homeMocks.persistCacheValues.set('ui.chat.last_used_assistant_id', 'assistant-1')
    homeMocks.deferOwnerNotification = false
    homeMocks.ownerNotification = undefined
    homeMocks.realOwnerQuery = false
    homeMocks.realTopics = false
    homeMocks.realHandler = false
    homeMocks.classicLayoutTopics = []
  })

  it.each([
    'current-neighbour',
    'stale-neighbour',
    'released-neighbour',
    'changed-owner',
    'drag-owner',
    'real-delayed-owner',
    'real-separate-drag',
    'real-inline-pending',
    'real-empty-pane',
    'real-exactly-500-orphan',
    'not-found-first',
    'settlement-first',
    'failure',
    'explicit-empty-switch',
    'real-not-found-first',
    'real-settlement-first',
    'same-selection',
    'duplicate',
    'abandoned',
    'real-unmount',
    'real-duplicate',
    'real-explicit-switch',
    'real-abandoned',
    'real-same-selection'
  ] as const)('preserves archive ownership: %s', runSchedule)

  // Move/archive coordination is deferred; retain the intended context as an explicit known failure.
  it.fails('records the unresolved moved-owner archive context risk', () => runSchedule('real-drag-owner'))

  async function runSchedule(schedule: string) {
    homeMocks.deferOwnerNotification = schedule === 'real-separate-drag'
    const archived = { ...initialTopic, assistantId: 'assistant-2', orderKey: 'a' }
    homeMocks.realHandler = schedule.startsWith('real-')
    homeMocks.realTopics = [
      'real-delayed-owner',
      'real-drag-owner',
      'real-separate-drag',
      'real-inline-pending',
      'real-empty-pane'
    ].includes(schedule)
    if (['real-delayed-owner', 'real-drag-owner', 'real-separate-drag', 'real-inline-pending'].includes(schedule))
      homeMocks.preferenceValues.set('topic.tab.position', 'left')
    homeMocks.classicLayoutTopics =
      schedule === 'real-unmount' ? [archived, { ...archived, id: 'B2', name: 'Neighbour' }] : [archived]
    if (['real-drag-owner', 'real-separate-drag'].includes(schedule))
      homeMocks.classicLayoutTopics.push({ ...initialTopic, id: 'A1', name: 'A1' })
    if (schedule === 'real-empty-pane')
      homeMocks.classicLayoutTopics.push({
        ...initialTopic,
        id: 'unlinked',
        assistantId: undefined,
        name: 'Unlinked topic'
      })
    if (schedule === 'real-empty-pane') {
      homeMocks.realOwnerQuery = true
      homeMocks.assistants = [{ id: 'assistant-1' }]
      homeMocks.assistantsTotal = 501
    }
    if (schedule === 'real-exactly-500-orphan') {
      homeMocks.assistants = Array.from({ length: 500 }, (_, id) => ({ id: id === 0 ? 'assistant-1' : `owner-${id}` }))
      homeMocks.assistantsTotal = 500
      homeMocks.classicLayoutTopics.push({ ...initialTopic, id: 'topic-of-A', name: 'Global neighbour' })
    }
    const archiveGate = deferred()
    const firstArchiveGate = deferred()
    const firstReleased = deferred()
    homeMocks.archiveRelease.mockImplementationOnce(() => firstReleased.resolve())
    let archiveCalls = 0
    vi.mocked(ipcApi.request).mockImplementation(async () => {
      archiveCalls += 1
      if (schedule === 'real-duplicate' && archiveCalls === 1) {
        await firstArchiveGate.promise
        return { deletedIds: [], deletedCount: 0 } as never
      }
      await archiveGate.promise
      return { deletedIds: [archived.id], deletedCount: 1 } as never
    })
    let moved = false
    vi.mocked(dataApiService.post).mockImplementation(async (path) => {
      if (path === `/topics/${archived.id}/move`) {
        moved = true
        homeMocks.classicLayoutTopics = homeMocks.classicLayoutTopics.map((topic) =>
          topic.id === archived.id ? { ...topic, assistantId: 'assistant-1' } : topic
        )
        return { ...archived, assistantId: 'assistant-1' } as never
      }
      return undefined as never
    })
    let missing = false
    const byIdGate = deferred()
    const byIdStarted = deferred()
    const byIdRejected = deferred()
    vi.mocked(dataApiService.get).mockImplementation(async (path, options) => {
      if (path === '/assistants/assistant-2') return { id: 'assistant-2', name: 'B' } as never
      if (path === '/pins') return [] as never
      if (path === '/topics' && ['real-drag-owner', 'real-separate-drag'].includes(schedule))
        return { items: homeMocks.classicLayoutTopics, total: homeMocks.classicLayoutTopics.length } as never
      if (path === '/assistants') return { items: homeMocks.assistants, total: homeMocks.assistants.length } as never
      if (path === '/topics/latest')
        return { topic: options?.query?.assistantId ? null : { ...initialTopic, id: 'topic-of-A' } } as never
      if (path === '/topics/topic-of-A') return { ...initialTopic, id: 'topic-of-A' } as never
      if (path === '/topics/A1') return { ...initialTopic, id: 'A1' } as never
      if (path === `/topics/${archived.id}`) {
        if (['real-delayed-owner', 'real-inline-pending'].includes(schedule) && !missing) {
          byIdStarted.resolve()
          await byIdGate.promise
          byIdRejected.resolve()
          throw DataApiErrorFactory.notFound('Topic', archived.id)
        }
        if (missing) {
          byIdStarted.resolve()
          if (schedule.endsWith('settlement-first')) await byIdGate.promise
          byIdRejected.resolve()
          throw DataApiErrorFactory.notFound('Topic', archived.id)
        }
        return (moved ? { ...archived, assistantId: 'assistant-1' } : archived) as never
      }
      return { items: [], total: 0 } as never
    })
    const root = createRootRoute()
    const app = createRoute({ getParentRoute: () => root, path: 'app' })
    const chat = createRoute({
      getParentRoute: () => app,
      path: 'chat',
      validateSearch: (search: Record<string, unknown>) => search as { topicId?: string; assistantId?: string },
      beforeLoad: async (context) => {
        await ChatRoute.options.beforeLoad?.(context as never)
      },
      component: HomePage
    })
    const router = createRouter({
      routeTree: root.addChildren([app.addChildren([chat])]),
      history: createMemoryHistory({ initialEntries: [`/app/chat?topicId=${archived.id}`] })
    })
    const urls: string[] = []
    router.subscribe('onResolved', () => urls.push(router.state.location.href))
    const queryCache = new Map()
    render(
      <SWRConfig value={{ provider: () => queryCache, dedupingInterval: 0 }}>
        <RouterProvider router={router} />
      </SWRConfig>
    )
    if (['real-delayed-owner', 'real-inline-pending'].includes(schedule))
      await waitFor(() => expect(dataApiService.get).toHaveBeenCalledWith(`/topics/${archived.id}`, expect.anything()))
    else await waitFor(() => expect(screen.getByLabelText('Active topic')).toHaveTextContent(archived.id))
    if (schedule === 'real-inline-pending') {
      fireEvent.click(await screen.findByRole('button', { name: 'common.archive' }))
      await waitFor(() => expect(ipcApi.request).toHaveBeenCalled())
    } else if (homeMocks.realHandler && schedule !== 'real-separate-drag') {
      fireEvent.click(screen.getByRole('button', { name: 'History' }))
      await waitFor(() => expect(screen.getAllByTestId('history-delete-button').length).toBeGreaterThan(0), {
        timeout: 10000
      })
      fireEvent.click(screen.getAllByTestId('history-delete-button')[0])
      await waitFor(() => expect(ipcApi.request).toHaveBeenCalled())
    } else if (!homeMocks.realHandler) act(() => homeMocks.archiveOnPending?.(archived.id, true))
    if (
      ['current-neighbour', 'stale-neighbour', 'released-neighbour', 'changed-owner', 'drag-owner'].includes(schedule)
    ) {
      const token = Symbol()
      act(() => homeMocks.archiveOnPending?.(archived.id, true, token))
      const captured = homeMocks.archiveNeighbour
      if (schedule === 'released-neighbour') act(() => homeMocks.archiveOnPending?.(archived.id, false, token))
      else if (schedule === 'drag-owner') {
        act(() => homeMocks.ownerChanged?.({ ...archived, assistantId: 'assistant-1' }))
      } else if (schedule !== 'current-neighbour') {
        act(() =>
          homeMocks.archiveSelect?.(
            schedule === 'changed-owner' ? { ...archived, assistantId: 'assistant-1' } : { ...initialTopic, id: 'A1' }
          )
        )
        await waitFor(() =>
          expect(router.state.location.search).toEqual({ topicId: schedule === 'changed-owner' ? archived.id : 'A1' })
        )
      }
      if (schedule === 'current-neighbour') act(() => homeMocks.archiveSelect?.(archived))
      const selection = { ...router.state.location.search }
      act(() => captured?.(archived, { ...archived, id: 'B2' }, token))
      await act(async () => {
        await Promise.resolve()
      })
      if (schedule === 'current-neighbour') {
        await waitFor(() => expect(router.state.location.search).toEqual({ topicId: 'B2' }))
        return
      }
      expect(router.state.location.search).toEqual(selection)
      expect(urls.some((url) => url.includes('topicId=B2'))).toBe(false)
      return
    }
    if (schedule === 'real-delayed-owner') {
      fireEvent.click(
        screen.getByTestId('resource-list-topic').querySelector('[data-testid=topic-list-row]') as HTMLElement
      )
    }
    if (['real-drag-owner', 'real-separate-drag'].includes(schedule)) {
      act(() =>
        dndMocks.onDragEnd?.({
          active: {
            id: `item:${archived.id}`,
            data: { current: dndMocks.sortableData.get(`item:${archived.id}`) },
            rect: { current: { initial: null, translated: { top: 100, height: 20 } } }
          },
          over: {
            id: 'item:A1',
            data: { current: dndMocks.sortableData.get('item:A1') },
            rect: { top: 10, height: 20 }
          }
        })
      )
      await waitFor(() => expect(dataApiService.post).toHaveBeenCalled())
      await waitFor(() => expect(screen.getByLabelText('Active topic')).toHaveTextContent(archived.id))
      await waitFor(() => expect(screen.getByLabelText('Active owner')).toHaveTextContent('assistant-1'))
      if (schedule === 'real-separate-drag') {
        await waitFor(() => expect(homeMocks.ownerNotification).toBeTypeOf('function'))
        // Deliver the committed move notification after cache renders, with no following page render.
        act(() => homeMocks.ownerNotification?.())
        fireEvent.click(
          screen
            .getAllByTestId('topic-list-row')
            .find((row) => row.textContent?.includes('Initial topic'))
            ?.querySelector('[aria-label="common.archive"]') as HTMLElement
        )
        await waitFor(() => expect(ipcApi.request).toHaveBeenCalled())
      }
      homeMocks.classicLayoutTopics = homeMocks.classicLayoutTopics.filter((topic) => topic.id !== archived.id)
      missing = true
      act(() => archiveGate.resolve())
      await waitFor(() => expect(homeMocks.archiveUndo).toHaveBeenCalled(), { timeout: 10000 })
      act(() =>
        MockDataApiUtils.emitDataChange([
          { endpoint: '/topics/:id', entityIds: [archived.id], routeParams: { id: archived.id } }
        ])
      )
      // Revalidate the removed row even if settlement already changed the subscribed route.
      await expect(dataApiService.get(`/topics/${archived.id}`)).rejects.toMatchObject({ code: 'NOT_FOUND' })
      await act(async () => byIdRejected.promise)
      await waitFor(() =>
        expect(router.state.location.search).toEqual(
          schedule === 'real-separate-drag' ? { topicId: 'A1' } : { assistantId: 'assistant-1' }
        )
      )
      expect(screen.getByLabelText('Active topic')).not.toHaveTextContent(archived.id)
      expect(screen.getByLabelText('Active owner')).not.toHaveTextContent('assistant-2')
      expect(homeMocks.classicLayoutTopics.some((topic) => topic.id === archived.id)).toBe(false)
      expect(urls.some((url) => url.includes('topic-of-A') || url === '/app/chat')).toBe(false)
      return
    }
    if (schedule === 'real-exactly-500-orphan') {
      act(() => archiveGate.resolve())
      await waitFor(() => expect(homeMocks.archiveRelease).toHaveBeenCalledTimes(1))
      await waitFor(() => expect(router.state.location.search).toEqual({ topicId: 'topic-of-A' }))
      expect(urls.some((url) => url.includes('assistantId=assistant-2'))).toBe(false)
      return
    }
    const secondAttempt = Symbol()
    if (schedule === 'duplicate') {
      act(() => homeMocks.archiveOnPending?.(archived.id, true, secondAttempt))
      act(() => homeMocks.archiveOnPending?.(archived.id, false))
    }
    if (schedule === 'same-selection') act(() => homeMocks.archiveSelect?.(archived))
    if (schedule === 'real-same-selection') fireEvent.click(screen.getByText('Initial topic'))
    if (schedule === 'real-duplicate') {
      fireEvent.click(screen.getAllByTestId('history-delete-button')[0])
      await waitFor(() => expect(ipcApi.request).toHaveBeenCalledTimes(2))
      act(() => firstArchiveGate.resolve())
      await act(async () => firstReleased.promise)
      expect(homeMocks.archiveRelease).toHaveBeenCalledTimes(1)
    }
    missing = true
    act(() =>
      MockDataApiUtils.emitDataChange([
        { endpoint: '/topics/:id', entityIds: [archived.id], routeParams: { id: archived.id } }
      ])
    )
    await act(async () => byIdStarted.promise)
    if (schedule.endsWith('settlement-first')) {
      expect(homeMocks.archiveUndo).not.toHaveBeenCalled()
      expect([...queryCache.values()].some((entry) => entry.error?.code === 'NOT_FOUND')).toBe(false)
    }
    if (!schedule.endsWith('settlement-first') && !['real-delayed-owner', 'real-inline-pending'].includes(schedule)) {
      await waitFor(() => expect(screen.getByLabelText('Active topic')).toHaveTextContent('empty'))
      expect(router.state.location.search).toEqual({ topicId: archived.id })
    }
    if (
      ['explicit-empty-switch', 'abandoned', 'real-abandoned', 'real-unmount', 'real-explicit-switch'].includes(
        schedule
      )
    ) {
      if (schedule === 'real-explicit-switch' || schedule === 'real-unmount') {
        act(() => homeMocks.archiveSelect?.({ ...initialTopic, id: 'A1' }))
        await waitFor(() => expect(screen.queryByTestId('history-records-view')).not.toBeInTheDocument())
      } else
        await act(async () => {
          await router.navigate({
            to: '/app/chat',
            search: { assistantId: 'assistant-1' }
          })
        })
    }
    if (schedule.endsWith('abandoned')) {
      await act(async () => {
        await router.navigate({ to: '/app/chat', search: { topicId: archived.id } })
      })
      await waitFor(() => expect(router.state.location.search).toEqual({ topicId: 'topic-of-A' }))
      return
    }
    act(() => {
      if (homeMocks.realHandler) {
        homeMocks.classicLayoutTopics =
          schedule === 'real-empty-pane'
            ? homeMocks.classicLayoutTopics.filter((topic) => topic.id !== archived.id)
            : []
        archiveGate.resolve()
        return
      }
      if (schedule !== 'failure')
        homeMocks.archiveOnSettled?.(archived, schedule === 'duplicate' ? secondAttempt : undefined)
      homeMocks.archiveOnPending?.(archived.id, false, schedule === 'duplicate' ? secondAttempt : undefined)
    })
    if (homeMocks.realHandler && schedule !== 'real-inline-pending')
      await waitFor(() => expect(homeMocks.archiveRelease).toHaveBeenCalledTimes(schedule === 'real-duplicate' ? 2 : 1))
    if (['explicit-empty-switch', 'real-unmount', 'real-explicit-switch'].includes(schedule)) {
      await waitFor(() =>
        expect(router.state.location.search).toEqual(
          schedule.startsWith('real-') ? { topicId: 'A1' } : { assistantId: 'assistant-1' }
        )
      )
      expect(urls.some((url) => url.includes('topicId=B2'))).toBe(false)
      expect(screen.getByLabelText('Assistant')).toHaveTextContent('assistant-1')
      return
    }
    if (schedule === 'failure') {
      await waitFor(() => expect(router.state.location.search).toEqual({ topicId: 'topic-of-A' }))
    } else {
      await waitFor(() => expect(router.state.location.search).toEqual({ assistantId: 'assistant-2' }))
      if (schedule.endsWith('settlement-first'))
        expect([...queryCache.values()].some((entry) => entry.error?.code === 'NOT_FOUND')).toBe(false)
      act(() => byIdGate.resolve())
      await act(async () => byIdRejected.promise)
      await waitFor(() =>
        expect([...queryCache.values()].some((entry) => entry.error?.code === 'NOT_FOUND')).toBe(true)
      )
      if (!homeMocks.realTopics)
        await waitFor(() => expect(screen.getByLabelText('Assistant')).toHaveTextContent('assistant-2'))
      if (schedule === 'real-empty-pane') {
        await waitFor(() =>
          expect(dataApiService.get).toHaveBeenCalledWith('/assistants/assistant-2', expect.anything())
        )
        expect(screen.getByLabelText('Assistant')).toHaveTextContent('assistant-2')
        expect(screen.getByText('chat.topics.empty.title')).toBeInTheDocument()
        expect(screen.queryByText('Unlinked topic')).not.toBeInTheDocument()
      }
      if (schedule === 'real-delayed-owner') expect(screen.queryByText('Initial topic')).not.toBeInTheDocument()
      expect(screen.getByLabelText('Active topic')).toHaveTextContent('empty')
      expect(urls.filter((url) => url.includes('topic-of-A') || url === '/app/chat')).toEqual([])
      // After release, a genuinely stale explicit route still uses normal recovery.
      await act(async () => {
        await router.navigate({ to: '/app/chat', search: { topicId: archived.id } })
      })
      await waitFor(() => expect(router.state.location.search).toEqual({ topicId: 'topic-of-A' }))
    }
  }
})
