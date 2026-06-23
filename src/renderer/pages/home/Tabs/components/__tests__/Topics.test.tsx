import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

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

const dndMocks = vi.hoisted(() => ({
  droppableData: new Map<string, unknown>(),
  onDragEnd: undefined as undefined | ((event: any) => void),
  onDragOver: undefined as undefined | ((event: any) => void),
  sortableData: new Map<string, unknown>()
}))

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: virtualMocks.useVirtualizer,
  defaultRangeExtractor: vi.fn((range) =>
    Array.from({ length: range.endIndex - range.startIndex + 1 }, (_, i) => range.startIndex + i)
  )
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
        setNodeRef: vi.fn(),
        transform: null,
        transition: undefined,
        isDragging: false
      }
    },
    verticalListSortingStrategy: vi.fn(() => null)
  }
})

vi.mock('@dnd-kit/utilities', () => ({
  CSS: {
    Transform: {
      toString: () => undefined
    }
  }
}))

const notesSettingsMocks = vi.hoisted(() => ({
  useNotesSettings: vi.fn(() => ({ notesPath: '/notes' }))
}))

vi.mock('@renderer/hooks/useNotesSettings', () => notesSettingsMocks)

const tabsContextMocks = vi.hoisted(() => ({
  openTab: vi.fn(),
  setActiveTab: vi.fn(),
  tabs: [] as Array<{ id: string; type: string; url: string }>
}))

vi.mock('@renderer/context/TabsContext', () => ({
  useOptionalTabsContext: () => ({
    openTab: tabsContextMocks.openTab,
    setActiveTab: tabsContextMocks.setActiveTab,
    tabs: tabsContextMocks.tabs
  })
}))

vi.mock('@renderer/components/resource/dialogs', () => ({
  ResourceEditDialogHost: ({ target }: { target: { kind: string; id: string } | null }) =>
    target ? <div data-testid="resource-edit-dialog-host" data-kind={target.kind} data-id={target.id} /> : null
}))

const topicDataMocks = vi.hoisted(() => ({
  deleteTopicsByAssistantId: vi.fn().mockResolvedValue({ deletedIds: [] as string[], deletedCount: 0 }),
  deleteTopic: vi.fn().mockResolvedValue(undefined),
  refreshTopics: vi.fn().mockResolvedValue(undefined),
  updateTopic: vi.fn().mockResolvedValue(undefined)
}))

const pinMutationMocks = vi.hoisted(() => ({
  createPin: vi.fn(),
  deletePin: vi.fn()
}))

const topicStreamStatusMocks = vi.hoisted(() => ({
  markSeen: vi.fn(),
  statuses: new Map<string, { isFulfilled?: boolean; isPending?: boolean }>()
}))

const cacheHookMocks = vi.hoisted(() => ({
  setCache: vi.fn(),
  values: new Map<string, unknown>()
}))

vi.mock('@data/hooks/useCache', () => ({
  useCache: (key: string) => [
    cacheHookMocks.values.get(key) ?? [],
    (value: unknown) => {
      cacheHookMocks.values.set(key, value)
      cacheHookMocks.setCache(key, value)
    }
  ],
  usePersistCache: (key: string) => [
    cacheHookMocks.values.get(key),
    (value: unknown) => {
      cacheHookMocks.values.set(key, value)
      cacheHookMocks.setCache(key, value)
    }
  ]
}))

vi.mock('@renderer/hooks/useTopic', async () => {
  const actual = await vi.importActual<typeof TopicDataApiModule>('@renderer/hooks/useTopic')
  return {
    ...actual,
    finishTopicRenaming: vi.fn(),
    getTopicMessages: vi.fn().mockResolvedValue([]),
    startTopicRenaming: vi.fn(),
    useTopicMutations: () => ({
      updateTopic: topicDataMocks.updateTopic,
      deleteTopic: topicDataMocks.deleteTopic,
      deleteTopicsByAssistantId: topicDataMocks.deleteTopicsByAssistantId,
      refreshTopics: topicDataMocks.refreshTopics
    })
  }
})

vi.mock('@renderer/hooks/useTopicStreamStatus', () => ({
  useTopicStreamStatus: (topicId: string) => {
    const status = topicStreamStatusMocks.statuses.get(topicId)
    return {
      activeExecutions: [],
      isFulfilled: status?.isFulfilled ?? false,
      isPending: status?.isPending ?? false,
      markSeen: () => topicStreamStatusMocks.markSeen(topicId),
      status: undefined
    }
  }
}))

vi.mock('@renderer/services/ApiService', () => ({
  fetchMessagesSummary: vi.fn().mockResolvedValue({ text: 'Auto title' })
}))

vi.mock('@renderer/services/EventService', () => ({
  EVENT_NAMES: {
    CLEAR_MESSAGES: 'CLEAR_MESSAGES',
    COPY_TOPIC_IMAGE: 'COPY_TOPIC_IMAGE',
    EXPORT_TOPIC_IMAGE: 'EXPORT_TOPIC_IMAGE'
  },
  EventEmitter: {
    emit: vi.fn()
  }
}))

vi.mock('@renderer/components/Popups/ObsidianExportPopup', () => ({
  default: { show: vi.fn() }
}))

vi.mock('@renderer/components/Popups/PromptPopup', () => ({
  default: { show: vi.fn() }
}))

vi.mock('@renderer/components/Popups/SaveToKnowledgePopup', () => ({
  default: { showForTopic: vi.fn() }
}))

vi.mock('@renderer/utils/export', () => ({
  copyTopicAsMarkdown: vi.fn(),
  exportMarkdownToJoplin: vi.fn(),
  exportMarkdownToSiyuan: vi.fn(),
  exportMarkdownToYuque: vi.fn(),
  exportTopicAsMarkdown: vi.fn(),
  exportTopicToNotes: vi.fn(),
  exportTopicToNotion: vi.fn(),
  topicToMarkdown: vi.fn().mockResolvedValue('# topic')
}))

vi.mock('@renderer/utils/copy', () => ({
  copyTopicAsMarkdown: vi.fn(),
  copyTopicAsPlainText: vi.fn()
}))

vi.mock('react-i18next', () => ({
  initReactI18next: {
    init: vi.fn(),
    type: '3rdParty'
  },
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (key === 'selector.common.pinned_title') return 'Pinned'
      if (key === 'chat.topics.title') return 'Conversations'
      if (key === 'chat.topics.list') return 'Conversation List'
      if (key === 'chat.topics.display.title') return 'Display mode'
      if (key === 'chat.topics.display.time') return 'Time'
      if (key === 'chat.topics.display.assistant') return 'Assistant'
      if (key === 'chat.topics.group.today') return 'Today'
      if (key === 'chat.topics.group.yesterday') return 'Yesterday'
      if (key === 'chat.topics.group.this_week') return 'This week'
      if (key === 'chat.topics.group.earlier') return 'Earlier'
      if (key === 'chat.topics.group.unknown_assistant') return 'Unlinked Assistant'
      if (key === 'chat.topics.group.show_more') return 'Show more conversations'
      if (key === 'chat.topics.group.collapse') return 'Collapse conversations'
      if (key === 'chat.topics.group.collapse_all') return 'Collapse all'
      if (key === 'chat.topics.group.expand_all') return 'Expand all'
      if (key === 'chat.topics.search.placeholder') return 'Search conversations'
      if (key === 'chat.topics.search.title') return 'Search conversations'
      if (key === 'chat.topics.pin') return 'Pin Conversation'
      if (key === 'chat.topics.unpin') return 'Unpin Conversation'
      if (key === 'chat.topics.auto_rename') return 'Generate conversation name'
      if (key === 'chat.topics.edit.title') return 'Edit conversation name'
      if (key === 'chat.topics.empty.description')
        return 'Create a chat and it will stay here so you can continue with its context later.'
      if (key === 'chat.topics.empty.title') return 'No chats yet'
      if (key === 'assistants.edit.title') return 'Edit Assistant'
      if (key === 'assistants.pin.title') return 'Pin Assistant'
      if (key === 'assistants.unpin.title') return 'Unpin Assistant'
      if (key === 'assistants.clear.menu_title') return 'Delete all assistant conversations'
      if (key === 'assistants.clear.title') return 'Clear conversations'
      if (key === 'assistants.clear.content') return 'Delete all assistant conversations?'
      if (key === 'chat.topics.clear.title') return 'Clear messages'
      if (key === 'notes.save') return 'Save to notes'
      if (key === 'chat.save.topic.knowledge.menu_title') return 'Save to knowledge base'
      if (key === 'chat.save.topic.knowledge.title') return 'Save to knowledge base'
      if (key === 'chat.topics.copy.title') return 'Copy'
      if (key === 'chat.topics.copy.image') return 'Copy as Image'
      if (key === 'chat.topics.copy.md') return 'Copy as Markdown'
      if (key === 'chat.topics.copy.plain_text') return 'Copy as Plain Text'
      if (key === 'chat.topics.export.title') return 'Export'
      if (key === 'chat.topics.export.image') return 'Export as Image'
      if (key === 'chat.topics.export.image_exporting_keep_page') return 'Exporting image. Please stay on this page.'
      if (key === 'chat.topics.export.image_saved') return 'Image saved successfully'
      if (key === 'chat.topics.export.failed') return 'Export failed'
      if (key === 'chat.topics.export.md.label') return 'Export as Markdown'
      if (key === 'chat.topics.export.md.reason') return 'Export as Markdown with Reasoning'
      if (key === 'chat.topics.export.word') return 'Export as Word'
      if (key === 'chat.topics.export.notion') return 'Export to Notion'
      if (key === 'chat.topics.export.yuque') return 'Export to Yuque'
      if (key === 'chat.topics.export.obsidian') return 'Export to Obsidian'
      if (key === 'chat.topics.export.joplin') return 'Export to Joplin'
      if (key === 'chat.topics.export.siyuan') return 'Export to Siyuan'
      if (key === 'common.delete') return 'Delete'
      if (key === 'common.more') return 'More'
      if (key === 'common.open_in_new_tab') return 'Open in new tab'
      if (key === 'tab.open_in_new_window') return 'Open in New Window'
      if (key === 'common.cancel') return 'Cancel'
      if (key === 'common.copy_failed') return 'Copy failed'
      if (key === 'common.name') return 'Name'
      if (key === 'common.required_field') return 'Required field'
      if (key === 'common.save') return 'Save'
      if (key === 'common.select_all') return 'Select All'
      if (key === 'chat.topics.manage.deselect_all') return 'Deselect All'
      if (key === 'chat.topics.manage.delete.confirm.title') return 'Delete Conversations'
      if (key === 'chat.topics.manage.delete.confirm.content') return `Delete ${options?.count ?? 0} conversation(s)?`
      if (key === 'chat.topics.manage.error.at_least_one') return 'At least one conversation must be kept'
      if (key === 'chat.add.topic.title') return 'New Conversation'
      if (key === 'chat.default.name') return 'Default Assistant'
      if (key === 'common.prompt') return 'Prompt'
      if (key === 'assistants.reorder.error.failed') return 'Failed to reorder assistants'
      if (key === 'chat.topics.delete.shortcut') return `Hold ${options?.key ?? 'Ctrl'} to delete directly`
      return key
    }
  })
}))

import { cacheService } from '@data/CacheService'
import { dataApiService } from '@data/DataApiService'
import type { ResourceListRevealRequest } from '@renderer/components/chat/resources'
import type * as TopicDataApiModule from '@renderer/hooks/useTopic'
import type { Topic } from '@renderer/types'
import type { Pin } from '@shared/data/types/pin'
import type { Topic as ApiTopic } from '@shared/data/types/topic'
import { mockUseInfiniteQuery, mockUseMutation, mockUseQuery } from '@test-mocks/renderer/useDataApi'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'

import {
  clearPendingTopicImageActionsForTest,
  consumePendingTopicImageActions,
  requestTopicImageAction,
  settleTopicImageActionRequest
} from '../../../messages/topicImageActionBus'
import { Topics } from '../Topics'
import {
  applyOptimisticTopicDisplayMove,
  TOPIC_ASSISTANT_SECTION_ID,
  TOPIC_PINNED_GROUP_ID,
  TOPIC_PINNED_SECTION_ID,
  TOPIC_UNLINKED_ASSISTANT_GROUP_ID
} from '../topicsHelpers'

const TOPIC_EXPANSION_TIME_KEY = 'ui.topic.expansion.time'
const TOPIC_EXPANSION_ASSISTANT_KEY = 'ui.topic.expansion.assistant'

// The full set of collapsible time groups; the stored cache is a flat list of
// the ones the user explicitly collapsed (denylist). Empty = everything expanded.
const ALL_TOPIC_TIME_GROUP_IDS = [
  TOPIC_PINNED_GROUP_ID,
  'topic:time:today',
  'topic:time:yesterday',
  'topic:time:this-week',
  'topic:time:earlier'
]

type TopicGroupCollapseFixture = {
  time: string[]
  assistant: string[]
}

// Default fixture: nothing collapsed (everything expanded).
function createExpandedTopicGroupExpansionFixture(): TopicGroupCollapseFixture {
  return {
    time: [],
    assistant: []
  }
}

function setTopicGroupExpansionCache(value: TopicGroupCollapseFixture) {
  cacheHookMocks.values.set(TOPIC_EXPANSION_TIME_KEY, value.time)
  cacheHookMocks.values.set(TOPIC_EXPANSION_ASSISTANT_KEY, value.assistant)
}

function getTopicGroupExpansionCache() {
  return {
    time: cacheHookMocks.values.get(TOPIC_EXPANSION_TIME_KEY),
    assistant: cacheHookMocks.values.get(TOPIC_EXPANSION_ASSISTANT_KEY)
  } as TopicGroupCollapseFixture
}

function createApiTopic(overrides: Partial<ApiTopic> = {}) {
  return {
    id: 'topic-a',
    name: 'Alpha topic',
    isNameManuallyEdited: false,
    assistantId: 'assistant-1',
    orderKey: 'a',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

function createRendererTopic(overrides: Partial<Topic> = {}): Topic {
  return {
    id: 'topic-a',
    assistantId: 'assistant-1',
    name: 'Alpha topic',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    messages: [],
    pinned: false,
    isNameManuallyEdited: false,
    ...overrides
  }
}

function createTopicPageItems(count: number): ApiTopic[] {
  return Array.from({ length: count }, (_, index) =>
    createApiTopic({
      id: `topic-${index + 1}`,
      name: `Topic ${index + 1}`,
      assistantId: 'assistant-1',
      orderKey: String(index + 1).padStart(3, '0'),
      createdAt: '2026-01-03T01:00:00.000Z',
      updatedAt: '2026-01-03T01:00:00.000Z'
    })
  )
}

function createTopicPin(overrides: Partial<Pin> = {}): Pin {
  return {
    id: 'pin-topic-a',
    entityId: 'topic-a',
    entityType: 'topic',
    orderKey: 'a',
    createdAt: '2026-01-03T12:00:00.000Z',
    updatedAt: '2026-01-03T12:00:00.000Z',
    ...overrides
  }
}

function createAssistant(overrides: Record<string, unknown> = {}) {
  return {
    id: 'assistant-1',
    name: 'Alpha Assistant',
    emoji: '🧪',
    orderKey: 'a',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

type OnNewTopicMock = Mock<(payload?: { assistantId?: string | null }) => void>

function renderTopicList({
  activeTopic = createRendererTopic(),
  onNewTopic = vi.fn(),
  revealRequest
}: {
  activeTopic?: Topic
  onNewTopic?: OnNewTopicMock
  revealRequest?: ResourceListRevealRequest
} = {}) {
  const setActiveTopic = vi.fn()
  const renderNode = (nextRevealRequest = revealRequest, nextActiveTopic = activeTopic) => (
    <Topics
      activeTopic={nextActiveTopic}
      setActiveTopic={setActiveTopic}
      onNewTopic={onNewTopic}
      revealRequest={nextRevealRequest}
    />
  )
  const view = render(renderNode())
  return {
    ...view,
    onNewTopic,
    rerenderTopicList: (nextRevealRequest = revealRequest, nextActiveTopic = activeTopic) =>
      view.rerender(renderNode(nextRevealRequest, nextActiveTopic)),
    setActiveTopic
  }
}

function openTopicListOptions() {
  fireEvent.click(screen.getByLabelText('Display mode'))
  return screen.getAllByTestId('popover-content').find((element) => element.className.includes('w-44'))
}

function getTopicRow(topicName: string) {
  const row = screen.getByText(topicName).closest('[data-testid="topic-list-row"]')
  expect(row).toBeInTheDocument()
  return row as HTMLElement
}

function sortableData(id: string) {
  const data = dndMocks.sortableData.get(id)
  if (!data) {
    throw new Error(`Expected sortable data for ${id}`)
  }
  return { current: data }
}

function droppableData(id: string) {
  const data = dndMocks.droppableData.get(id)
  if (!data) {
    throw new Error(`Expected droppable data for ${id}`)
  }
  return { current: data }
}

const topicStreamStatusCacheKey = (topicId: string) => `topic.stream.statuses.${topicId}` as never
const topicStreamLastSeenCompletionCacheKey = (topicId: string) =>
  `topic.stream.last_seen_completion.${topicId}` as never

function setTopicStreamCacheStatus(topicId: string, status: 'done' | 'pending' | 'streaming') {
  cacheService.setShared(topicStreamStatusCacheKey(topicId), { status } as never)
  cacheService.deleteShared(topicStreamLastSeenCompletionCacheKey(topicId))
}

function clearTopicStreamCache(...topicIds: string[]) {
  for (const topicId of topicIds) {
    cacheService.deleteShared(topicStreamStatusCacheKey(topicId))
    cacheService.deleteShared(topicStreamLastSeenCompletionCacheKey(topicId))
  }
}

describe('Topics', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.assign(window, {
      modal: {
        confirm: vi.fn().mockResolvedValue(true)
      },
      toast: {
        error: vi.fn(),
        closeToast: vi.fn(),
        loading: vi.fn(),
        success: vi.fn(),
        warning: vi.fn()
      }
    })
    clearPendingTopicImageActionsForTest()
    topicStreamStatusMocks.statuses.clear()
    clearTopicStreamCache('topic-a', 'topic-b', 'topic-c', 'topic-d', 'topic-e')
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date(2026, 0, 3, 12))
    MockUsePreferenceUtils.resetMocks()
    cacheHookMocks.values.clear()
    setTopicGroupExpansionCache(createExpandedTopicGroupExpansionFixture())
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'topic.tab.display_mode': 'assistant',
      'data.export.menus.docx': true,
      'data.export.menus.image': true,
      'data.export.menus.joplin': true,
      'data.export.menus.markdown': true,
      'data.export.menus.markdown_reason': true,
      'data.export.menus.notes': true,
      'data.export.menus.notion': true,
      'data.export.menus.obsidian': true,
      'data.export.menus.plain_text': true,
      'data.export.menus.siyuan': true,
      'data.export.menus.yuque': true
    })
    pinMutationMocks.createPin.mockResolvedValue(createTopicPin())
    pinMutationMocks.deletePin.mockResolvedValue(undefined)
    topicDataMocks.deleteTopicsByAssistantId.mockResolvedValue({ deletedIds: [], deletedCount: 0 })
    tabsContextMocks.openTab.mockClear()
    tabsContextMocks.setActiveTab.mockClear()
    tabsContextMocks.tabs = []
    mockUseMutation.mockImplementation((method, path) => {
      if (method === 'POST' && path === '/pins') {
        return { trigger: pinMutationMocks.createPin, isLoading: false, error: undefined }
      }
      if (method === 'DELETE' && path === '/pins/:id') {
        return { trigger: pinMutationMocks.deletePin, isLoading: false, error: undefined }
      }
      return { trigger: vi.fn(), isLoading: false, error: undefined }
    })
    mockUseQuery.mockImplementation((path, options) => {
      if (path === '/pins') {
        const entityType = (options as { query?: { entityType?: string } } | undefined)?.query?.entityType
        const enabled = (options as { enabled?: boolean } | undefined)?.enabled
        return {
          data:
            enabled === false
              ? undefined
              : entityType === 'assistant'
                ? []
                : [{ id: 'pin-topic-b', entityId: 'topic-b', entityType: 'topic' }],
          isLoading: false,
          isRefreshing: false,
          error: undefined,
          refetch: vi.fn().mockResolvedValue(undefined),
          mutate: vi.fn().mockResolvedValue(undefined)
        }
      }
      if (path === '/assistants') {
        return {
          data: {
            items: [
              createAssistant(),
              createAssistant({
                id: 'assistant-2',
                name: 'Beta Assistant',
                emoji: '✍️',
                orderKey: 'b'
              })
            ],
            total: 2
          },
          isLoading: false,
          isRefreshing: false,
          error: undefined,
          refetch: vi.fn().mockResolvedValue(undefined),
          mutate: vi.fn().mockResolvedValue(undefined)
        }
      }
      return {
        data: undefined,
        isLoading: false,
        isRefreshing: false,
        error: undefined,
        refetch: vi.fn().mockResolvedValue(undefined),
        mutate: vi.fn().mockResolvedValue(undefined)
      }
    })
    mockUseInfiniteQuery.mockReturnValue({
      pages: [
        {
          items: [
            createApiTopic({
              id: 'topic-a',
              name: 'Alpha topic',
              assistantId: 'assistant-1',
              orderKey: 'a',
              createdAt: '2026-01-03T01:00:00.000Z',
              updatedAt: '2026-01-03T01:00:00.000Z'
            }),
            createApiTopic({
              id: 'topic-b',
              name: 'Beta pinned',
              assistantId: 'assistant-1',
              orderKey: 'b',
              createdAt: '2026-01-02T01:00:00.000Z',
              updatedAt: '2026-01-02T01:00:00.000Z'
            }),
            createApiTopic({
              id: 'topic-c',
              name: 'Gamma topic',
              assistantId: 'assistant-2',
              orderKey: 'c',
              createdAt: '2026-01-01T01:00:00.000Z',
              updatedAt: '2026-01-01T01:00:00.000Z'
            }),
            createApiTopic({
              id: 'topic-e',
              name: 'Epsilon yesterday',
              assistantId: 'assistant-2',
              orderKey: 'e',
              createdAt: '2026-01-02T01:00:00.000Z',
              updatedAt: '2026-01-02T01:00:00.000Z'
            }),
            createApiTopic({
              id: 'topic-d',
              name: 'Delta archive',
              assistantId: 'assistant-2',
              orderKey: 'd',
              createdAt: '2025-12-20T01:00:00.000Z',
              updatedAt: '2025-12-20T01:00:00.000Z'
            })
          ]
        }
      ],
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      hasNext: false,
      loadNext: vi.fn(),
      refresh: vi.fn(),
      reset: vi.fn(),
      mutate: vi.fn()
    })
    dndMocks.onDragEnd = undefined
    dndMocks.onDragOver = undefined
    dndMocks.droppableData.clear()
    dndMocks.sortableData.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders pinned and time groups and protects pinned rows from inline delete', () => {
    MockUsePreferenceUtils.setPreferenceValue('topic.tab.display_mode' as never, 'time')
    const { getByText, setActiveTopic } = renderTopicList()

    expect(screen.getByText('Pinned')).toBeInTheDocument()
    expect(screen.getByText('Today')).toBeInTheDocument()
    expect(screen.getByText('Yesterday')).toBeInTheDocument()
    expect(screen.getByText('This week')).toBeInTheDocument()
    expect(screen.getByText('Earlier')).toBeInTheDocument()
    expect(screen.getByText('Beta pinned')).toBeInTheDocument()
    const pinnedRow = getByText('Beta pinned').closest('[data-testid="topic-list-row"]')
    const unpinButton = pinnedRow?.querySelector('[aria-label="Unpin Conversation"]')
    expect(unpinButton ?? null).toBeInTheDocument()
    expect(unpinButton).not.toHaveAttribute('data-active')
    expect(pinnedRow?.querySelector('[data-resource-list-leading-slot="true"]') ?? null).not.toBeInTheDocument()
    expect(pinnedRow?.querySelector('[aria-label="Delete"]') ?? null).not.toBeInTheDocument()
    expect(
      getTopicRow('Gamma topic').querySelector('[data-resource-list-leading-slot="true"]') ?? null
    ).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Gamma topic'))
    expect(setActiveTopic).toHaveBeenCalledWith(expect.objectContaining({ id: 'topic-c' }))
  })

  it('hides inline delete for the last remaining unpinned topic', () => {
    mockUseInfiniteQuery.mockReturnValue({
      pages: [
        {
          items: [
            createApiTopic({
              id: 'topic-a',
              name: 'Alpha topic',
              assistantId: 'assistant-1',
              orderKey: 'a'
            })
          ]
        }
      ],
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      hasNext: false,
      loadNext: vi.fn(),
      refresh: vi.fn(),
      reset: vi.fn(),
      mutate: vi.fn()
    })

    renderTopicList()

    const topicRow = getTopicRow('Alpha topic')

    expect(within(topicRow).queryByLabelText('Delete')).not.toBeInTheDocument()
    expect(topicDataMocks.deleteTopic).not.toHaveBeenCalled()
  })

  it('requests and auto-paginates full topic pages with the ResourceList bulk page size', async () => {
    const loadNext = vi.fn()
    mockUseInfiniteQuery.mockReturnValue({
      pages: [{ items: [] }],
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      hasNext: true,
      loadNext,
      refresh: vi.fn(),
      reset: vi.fn(),
      mutate: vi.fn()
    })

    renderTopicList()

    expect(mockUseInfiniteQuery).toHaveBeenCalledWith('/topics', expect.objectContaining({ limit: 200 }))
    await vi.waitFor(() => expect(loadNext).toHaveBeenCalledTimes(1))
  })

  it('shows the empty chat state without a creation action', () => {
    mockUseInfiniteQuery.mockReturnValue({
      pages: [{ items: [] }],
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      hasNext: false,
      loadNext: vi.fn(),
      refresh: vi.fn(),
      reset: vi.fn(),
      mutate: vi.fn()
    })

    const { onNewTopic } = renderTopicList()

    expect(screen.getByText('No chats yet')).toBeInTheDocument()
    expect(
      screen.getByText('Create a chat and it will stay here so you can continue with its context later.')
    ).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'chat.conversation.new' })).toHaveLength(1)
    expect(onNewTopic).not.toHaveBeenCalled()
  })

  it('pins from the trailing row button without selecting the topic', async () => {
    const { getByText, setActiveTopic } = renderTopicList()

    const alphaRow = getByText('Alpha topic').closest('[data-testid="topic-list-row"]')
    const pinButton = alphaRow?.querySelector('[aria-label="Pin Conversation"]')
    expect(pinButton ?? null).toBeInTheDocument()
    expect(pinButton?.closest('[data-resource-list-item-actions="true"]')).toBeInTheDocument()
    expect(
      alphaRow?.querySelector('[data-resource-list-leading-slot="true"] [aria-label="Pin Conversation"]') ?? null
    ).not.toBeInTheDocument()

    fireEvent.click(pinButton as Element)

    await vi.waitFor(() =>
      expect(pinMutationMocks.createPin).toHaveBeenCalledWith({
        body: { entityType: 'topic', entityId: 'topic-a' }
      })
    )
    expect(setActiveTopic).not.toHaveBeenCalled()
  })

  it('unpins from the trailing row button', async () => {
    const { getByText } = renderTopicList()

    const betaRow = getByText('Beta pinned').closest('[data-testid="topic-list-row"]')
    const unpinButton = betaRow?.querySelector('[aria-label="Unpin Conversation"]')
    expect(unpinButton ?? null).toBeInTheDocument()
    expect(betaRow?.querySelector('[data-resource-list-leading-slot="true"]') ?? null).not.toBeInTheDocument()
    expect(unpinButton?.closest('[data-resource-list-item-actions="true"]')).toBeInTheDocument()
    expect(
      betaRow?.querySelector('[data-resource-list-leading-slot="true"] [aria-label="Unpin Conversation"]') ?? null
    ).not.toBeInTheDocument()

    fireEvent.click(unpinButton as Element)

    await vi.waitFor(() => expect(pinMutationMocks.deletePin).toHaveBeenCalledWith({ params: { id: 'pin-topic-b' } }))
  })

  it('moves a topic into the pinned group immediately after pinning without refreshing topics', async () => {
    pinMutationMocks.createPin.mockResolvedValue(createTopicPin())

    const { getByText, rerenderTopicList } = renderTopicList()
    fireEvent.click(screen.getByRole('button', { name: 'Pinned' }))
    expect(screen.queryByText('Alpha topic')).toBeInTheDocument()

    const alphaRow = getByText('Alpha topic').closest('[data-testid="topic-list-row"]')
    fireEvent.click(alphaRow?.querySelector('[aria-label="Pin Conversation"]') as Element)
    await vi.waitFor(() => expect(pinMutationMocks.createPin).toHaveBeenCalled())

    expect(topicDataMocks.refreshTopics).not.toHaveBeenCalled()
    expect(screen.queryByText('Alpha topic')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Pinned' }))
    rerenderTopicList()
    expect(screen.getByText('Alpha topic')).toBeInTheDocument()
  })

  it('keeps pin actions in the topic context menu and removes topic position actions', () => {
    const { getByText } = renderTopicList()

    fireEvent.contextMenu(getByText('Alpha topic'))
    const alphaMenu = getByText('Alpha topic').closest('[data-testid="context-menu"]')
    const menuContent = alphaMenu?.querySelector('[data-testid="context-menu-content"]')

    expect(menuContent ?? null).toBeInTheDocument()
    expect(menuContent).toHaveTextContent('Pin Conversation')
    expect(menuContent).not.toHaveTextContent('Unpin Conversation')
    expect(menuContent).not.toHaveTextContent('Topic position')
  })

  it('groups topic context menu actions and marks delete as destructive', () => {
    const { getByText } = renderTopicList()

    fireEvent.contextMenu(getByText('Alpha topic'))
    const alphaMenu = getByText('Alpha topic').closest('[data-testid="context-menu"]')
    const menuContent = alphaMenu?.querySelector('[data-testid="context-menu-content"]')
    expect(menuContent ?? null).toBeInTheDocument()
    expect(menuContent).not.toHaveTextContent('Edit Assistant')

    expect(Array.from(menuContent?.querySelectorAll('[data-testid="context-menu-separator"]') ?? [])).toHaveLength(2)
    expect(Array.from(menuContent?.children ?? []).map((child) => child.textContent)).toEqual([
      'Generate conversation name',
      'Edit conversation name',
      'Pin Conversation',
      'Open in New Window',
      'Clear messages',
      '',
      'Save to notes',
      'Save to knowledge base',
      'ExportExport as ImageExport as MarkdownExport as Markdown with ReasoningExport as WordExport to NotionExport to YuqueExport to ObsidianExport to JoplinExport to Siyuan',
      'CopyCopy as ImageCopy as MarkdownCopy as Plain Text',
      '',
      'Delete'
    ])
    expect(within(menuContent as HTMLElement).getByRole('button', { name: 'Delete' })).toHaveAttribute(
      'variant',
      'destructive'
    )
  })

  it('opens a topic message page in a new app tab from the context menu', async () => {
    const { getByText } = renderTopicList()

    fireEvent.contextMenu(getByText('Gamma topic'))
    const gammaMenu = getByText('Gamma topic').closest('[data-testid="context-menu"]')
    const menuContent = gammaMenu?.querySelector('[data-testid="context-menu-content"]')
    const animationFrameCallbacks: FrameRequestCallback[] = []
    const requestAnimationFrameSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      animationFrameCallbacks.push(callback)
      return animationFrameCallbacks.length
    })

    fireEvent.click(within(menuContent as HTMLElement).getByRole('button', { name: 'Open in new tab' }))

    expect(tabsContextMocks.openTab).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(animationFrameCallbacks.length).toBeGreaterThan(0))
    act(() => {
      for (const callback of animationFrameCallbacks.splice(0)) {
        callback(0)
      }
    })
    expect(tabsContextMocks.openTab).toHaveBeenCalledWith('/app/chat', {
      forceNew: true,
      title: 'Gamma topic',
      metadata: { instanceAppId: 'assistants', instanceKey: 'topic-c' }
    })
    requestAnimationFrameSpy.mockRestore()
  })

  it('hides open-in-new-tab for the active topic context menu', () => {
    const { getByText } = renderTopicList()

    fireEvent.contextMenu(getByText('Alpha topic'))
    const alphaMenu = getByText('Alpha topic').closest('[data-testid="context-menu"]')
    const menuContent = alphaMenu?.querySelector('[data-testid="context-menu-content"]')

    expect(menuContent).not.toHaveTextContent('Open in new tab')
  })

  it('shows loading while selecting the right-clicked topic before exporting it as an image', async () => {
    const { getByText, rerenderTopicList, setActiveTopic } = renderTopicList()
    fireEvent.contextMenu(getByText('Gamma topic'))
    const gammaMenu = getByText('Gamma topic').closest('[data-testid="context-menu"]')
    const menuContent = gammaMenu?.querySelector('[data-testid="context-menu-content"]')
    const animationFrameCallbacks: FrameRequestCallback[] = []
    const requestAnimationFrameSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      animationFrameCallbacks.push(callback)
      return animationFrameCallbacks.length
    })

    const exportImageItem = within(menuContent as HTMLElement).getByRole('button', { name: 'Export as Image' })
    expect(exportImageItem).not.toBeDisabled()

    fireEvent.click(exportImageItem)

    expect(setActiveTopic).not.toHaveBeenCalled()
    expect(window.toast.loading).not.toHaveBeenCalled()

    await vi.waitFor(() => expect(animationFrameCallbacks.length).toBeGreaterThan(0))
    act(() => {
      for (const callback of animationFrameCallbacks.splice(0)) {
        callback(0)
      }
    })

    expect(window.toast.loading).toHaveBeenCalledWith(
      expect.objectContaining({
        key: expect.stringMatching(/^topic-image-export:/),
        promise: expect.any(Promise),
        title: 'Exporting image. Please stay on this page.'
      })
    )
    expect(setActiveTopic).toHaveBeenCalledWith(expect.objectContaining({ id: 'topic-c' }))
    expect(EventEmitter.emit).toHaveBeenCalledWith(
      EVENT_NAMES.EXPORT_TOPIC_IMAGE,
      expect.objectContaining({ id: 'topic-c' })
    )

    rerenderTopicList(
      undefined,
      createRendererTopic({ assistantId: 'assistant-2', id: 'topic-c', name: 'Gamma topic' })
    )

    const [request] = consumePendingTopicImageActions('topic-c', 'export')
    settleTopicImageActionRequest(request, Promise.resolve())
    await vi.waitFor(() => {
      expect(window.toast.success).toHaveBeenCalledWith('Image saved successfully')
    })
    requestAnimationFrameSpy.mockRestore()
  })

  it('cancels pending topic image requests when the topic list unmounts before runtime consumption', async () => {
    const { unmount } = renderTopicList()
    const request = requestTopicImageAction(
      'export',
      createRendererTopic({ assistantId: 'assistant-2', id: 'topic-c', name: 'Gamma topic' })
    )
    expect(request).toEqual(expect.objectContaining({ topic: expect.objectContaining({ id: 'topic-c' }) }))
    request.promise.catch(() => undefined)

    unmount()

    expect(consumePendingTopicImageActions('topic-c')).toEqual([])
    await expect(request.promise).rejects.toThrow('Topic image export was cancelled')
  })

  it('shows an error toast when a queued topic image copy request fails', async () => {
    const { getByText, setActiveTopic } = renderTopicList()
    fireEvent.contextMenu(getByText('Gamma topic'))
    const gammaMenu = getByText('Gamma topic').closest('[data-testid="context-menu"]')
    const menuContent = gammaMenu?.querySelector('[data-testid="context-menu-content"]')
    const animationFrameCallbacks: FrameRequestCallback[] = []
    const requestAnimationFrameSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      animationFrameCallbacks.push(callback)
      return animationFrameCallbacks.length
    })

    fireEvent.click(within(menuContent as HTMLElement).getByRole('button', { name: 'Copy as Image' }))

    await vi.waitFor(() => expect(animationFrameCallbacks.length).toBeGreaterThan(0))
    act(() => {
      for (const callback of animationFrameCallbacks.splice(0)) {
        callback(0)
      }
    })

    expect(setActiveTopic).toHaveBeenCalledWith(expect.objectContaining({ id: 'topic-c' }))
    expect(window.toast.loading).not.toHaveBeenCalled()
    expect(EventEmitter.emit).toHaveBeenCalledWith(
      EVENT_NAMES.COPY_TOPIC_IMAGE,
      expect.objectContaining({ id: 'topic-c' })
    )

    const [request] = consumePendingTopicImageActions('topic-c', 'copy')
    request.promise.catch(() => undefined)
    settleTopicImageActionRequest(request, Promise.reject(new Error('copy failed')))

    await vi.waitFor(() => {
      expect(window.toast.error).toHaveBeenCalledWith('Copy failed')
    })
    requestAnimationFrameSpy.mockRestore()
  })

  it('autofocuses inline rename when double-clicking a topic title', () => {
    const { getByText } = renderTopicList()

    fireEvent.doubleClick(getByText('Alpha topic'))

    const input = screen.getByLabelText('Edit conversation name')
    expect(input).toHaveFocus()
    expect(topicDataMocks.updateTopic).not.toHaveBeenCalled()
  })

  it('confirms topic deletion from the shared context menu before deleting', async () => {
    const { getByText } = renderTopicList()

    fireEvent.contextMenu(getByText('Alpha topic'))
    const alphaMenu = getByText('Alpha topic').closest('[data-testid="context-menu"]')
    const menuContent = alphaMenu?.querySelector('[data-testid="context-menu-content"]')
    fireEvent.click(within(menuContent as HTMLElement).getByRole('button', { name: 'Delete' }))

    // Deletion is gated behind a confirm popup (command-menu items have no inline dialog).
    await vi.waitFor(() =>
      expect(window.modal.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Delete Conversations' }))
    )
    expect(topicDataMocks.deleteTopic).not.toHaveBeenCalled()

    const confirmOptions = vi.mocked(window.modal.confirm).mock.calls.at(-1)?.[0]
    await confirmOptions?.onOk?.()

    await vi.waitFor(() => expect(topicDataMocks.deleteTopic).toHaveBeenCalledWith('topic-a'))
  })

  it('requires a second inline click before deleting a topic', async () => {
    const { getByText } = renderTopicList()

    const topicRow = getByText('Gamma topic').closest('[role="option"]')
    const deleteButton = within(topicRow as HTMLElement).getByLabelText('Delete')

    act(() => {
      fireEvent.click(deleteButton)
    })

    expect(topicDataMocks.deleteTopic).not.toHaveBeenCalled()
    expect(deleteButton).toHaveAttribute('data-deleting', 'true')

    act(() => {
      fireEvent.click(deleteButton)
    })

    await vi.waitFor(() => expect(topicDataMocks.deleteTopic).toHaveBeenCalledWith('topic-c'))
  })

  it('keeps topic rows compact and only renders the title field in the sidebar list', () => {
    renderTopicList()

    expect(screen.getByText('Alpha topic')).toBeInTheDocument()
    expect(screen.queryByText('2026/01/03 01:00')).not.toBeInTheDocument()
    expect(screen.queryByText('2026/01/02 01:00')).not.toBeInTheDocument()
    expect(screen.queryByText('2025/12/31 01:00')).not.toBeInTheDocument()
    expect(screen.queryByText(/^Prompt:/)).not.toBeInTheDocument()
  })

  it('keeps inactive topic stream indicator in the action slot and opens fulfilled topics', () => {
    setTopicStreamCacheStatus('topic-c', 'pending')
    let view = renderTopicList()
    let setActiveTopic = view.setActiveTopic

    let topicRow = getTopicRow('Gamma topic')
    let indicator = topicRow.querySelector('[data-testid="topic-stream-indicator"] .animation-pulse')
    expect(indicator).toHaveClass('bg-(--color-warning)')
    expect(topicRow.querySelector('[data-deleting]')).not.toBeInTheDocument()
    expect(topicStreamStatusMocks.markSeen).not.toHaveBeenCalled()

    setTopicStreamCacheStatus('topic-c', 'done')
    view.unmount()
    view = renderTopicList()
    setActiveTopic = view.setActiveTopic

    topicRow = getTopicRow('Gamma topic')
    indicator = topicRow.querySelector('[data-testid="topic-stream-indicator"] span')
    expect(indicator).toHaveClass('bg-(--color-success)')
    expect(indicator).not.toHaveClass('animation-pulse')
    expect(topicRow.querySelector('[data-deleting]')).not.toBeInTheDocument()

    fireEvent.click(topicRow)
    expect(setActiveTopic).toHaveBeenCalledWith(expect.objectContaining({ id: 'topic-c' }))
    expect(topicStreamStatusMocks.markSeen).not.toHaveBeenCalled()

    clearTopicStreamCache('topic-c')
    view.unmount()
    view = renderTopicList()

    topicRow = getTopicRow('Gamma topic')
    expect(topicRow.querySelector('[data-testid="topic-stream-indicator"]')).not.toBeInTheDocument()
    expect(topicRow.querySelector('[aria-label="Pin Conversation"]')).toBeInTheDocument()
  })

  it('marks only completed active topic streams as seen', () => {
    topicStreamStatusMocks.statuses.set('topic-a', { isPending: true })
    const { rerenderTopicList } = renderTopicList()

    expect(topicStreamStatusMocks.markSeen).not.toHaveBeenCalled()

    topicStreamStatusMocks.statuses.set('topic-a', { isFulfilled: true })
    rerenderTopicList()

    expect(topicStreamStatusMocks.markSeen).toHaveBeenCalledTimes(1)
    expect(topicStreamStatusMocks.markSeen).toHaveBeenCalledWith('topic-a')
  })

  it('shows five topics per group and loads five more within that group', () => {
    MockUsePreferenceUtils.setPreferenceValue('topic.tab.display_mode' as never, 'time')
    mockUseQuery.mockImplementation((path) => {
      if (path === '/pins') {
        return {
          data: [],
          isLoading: false,
          isRefreshing: false,
          error: undefined,
          refetch: vi.fn().mockResolvedValue(undefined),
          mutate: vi.fn().mockResolvedValue(undefined)
        }
      }
      return {
        data: undefined,
        isLoading: false,
        isRefreshing: false,
        error: undefined,
        refetch: vi.fn().mockResolvedValue(undefined),
        mutate: vi.fn().mockResolvedValue(undefined)
      }
    })
    mockUseInfiniteQuery.mockReturnValue({
      pages: [{ items: createTopicPageItems(11) }],
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      hasNext: false,
      loadNext: vi.fn(),
      refresh: vi.fn(),
      reset: vi.fn(),
      mutate: vi.fn()
    })

    renderTopicList()

    expect(screen.getByText('Today')).toBeInTheDocument()
    expect(screen.getByText('Topic 5')).toBeInTheDocument()
    expect(screen.queryByText('Topic 6')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Show more conversations' }))

    expect(screen.getByText('Topic 10')).toBeInTheDocument()
    expect(screen.getByText('Topic 11')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Collapse conversations' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Collapse conversations' }))

    expect(screen.getByText('Topic 5')).toBeInTheDocument()
    expect(screen.queryByText('Topic 6')).not.toBeInTheDocument()
  })

  it('keeps the expanded topic window after selecting a topic revealed by show more', () => {
    MockUsePreferenceUtils.setPreferenceValue('topic.tab.display_mode' as never, 'time')
    mockUseQuery.mockImplementation((path) => {
      if (path === '/pins') {
        return {
          data: [],
          isLoading: false,
          isRefreshing: false,
          error: undefined,
          refetch: vi.fn().mockResolvedValue(undefined),
          mutate: vi.fn().mockResolvedValue(undefined)
        }
      }
      return {
        data: [],
        isLoading: false,
        isRefreshing: false,
        error: undefined,
        refetch: vi.fn().mockResolvedValue(undefined),
        mutate: vi.fn().mockResolvedValue(undefined)
      }
    })
    mockUseInfiniteQuery.mockReturnValue({
      pages: [{ items: createTopicPageItems(11) }],
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      hasNext: false,
      loadNext: vi.fn(),
      refresh: vi.fn(),
      reset: vi.fn(),
      mutate: vi.fn()
    })

    const { rerenderTopicList, setActiveTopic } = renderTopicList()

    fireEvent.click(screen.getByRole('button', { name: 'Show more conversations' }))
    fireEvent.click(getTopicRow('Topic 6'))

    expect(setActiveTopic).toHaveBeenCalledWith(expect.objectContaining({ id: 'topic-6' }))

    rerenderTopicList(undefined, createRendererTopic({ id: 'topic-6', name: 'Topic 6' }))

    expect(screen.getByText('Topic 10')).toBeInTheDocument()
    expect(screen.getByText('Topic 11')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Collapse conversations' })).toBeInTheDocument()
  })

  it('collapses assistant groups from the display options menu', async () => {
    MockUsePreferenceUtils.setPreferenceValue('topic.tab.display_mode' as never, 'assistant')
    mockUseInfiniteQuery.mockReturnValue({
      pages: [
        {
          items: [
            ...Array.from({ length: 6 }, (_, index) =>
              createApiTopic({
                id: `assistant-1-topic-${index + 1}`,
                name: `Alpha topic ${index + 1}`,
                assistantId: 'assistant-1',
                orderKey: String(index + 1).padStart(3, '0')
              })
            ),
            ...Array.from({ length: 6 }, (_, index) =>
              createApiTopic({
                id: `assistant-2-topic-${index + 1}`,
                name: `Beta topic ${index + 1}`,
                assistantId: 'assistant-2',
                orderKey: String(index + 1).padStart(3, '0')
              })
            )
          ]
        }
      ],
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      hasNext: false,
      loadNext: vi.fn(),
      refresh: vi.fn(),
      reset: vi.fn(),
      mutate: vi.fn()
    })

    const { rerenderTopicList } = renderTopicList({
      activeTopic: createRendererTopic({
        id: 'assistant-1-topic-1',
        assistantId: 'assistant-1',
        name: 'Alpha topic 1'
      })
    })

    expect(screen.getByText('Alpha topic 1')).toBeInTheDocument()
    expect(screen.getByText('Beta topic 1')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Display mode' }))
    const collapseAllButton = screen.getByRole('button', { name: 'Collapse all' })
    expect(collapseAllButton.querySelector('svg')).toHaveClass('lucide-chevrons-down-up')
    fireEvent.click(collapseAllButton)
    await vi.waitFor(() => {
      expect(getTopicGroupExpansionCache().assistant).toEqual(
        expect.arrayContaining(['topic:assistant:assistant-1', 'topic:assistant:assistant-2'])
      )
    })
    rerenderTopicList()

    expect(screen.getByRole('button', { name: 'Alpha Assistant' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('button', { name: 'Beta Assistant' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Alpha topic 1')).not.toBeInTheDocument()
    expect(screen.queryByText('Beta topic 1')).not.toBeInTheDocument()
    expect(getTopicGroupExpansionCache().assistant).not.toContain(TOPIC_ASSISTANT_SECTION_ID)
    expect(getTopicGroupExpansionCache().assistant).toEqual(
      expect.arrayContaining(['topic:assistant:assistant-1', 'topic:assistant:assistant-2'])
    )

    fireEvent.click(screen.getByRole('button', { name: 'Display mode' }))
    const expandAllButton = screen.getByRole('button', { name: 'Expand all' })
    expect(expandAllButton).toBeInTheDocument()
    // Icon flips with the action: expand state shows the opposite chevrons.
    expect(expandAllButton.querySelector('svg')).toHaveClass('lucide-chevrons-up-down')
  })

  it('does not show the assistant section toggle action in time display mode', () => {
    MockUsePreferenceUtils.setPreferenceValue('topic.tab.display_mode' as never, 'time')
    mockUseInfiniteQuery.mockReturnValue({
      pages: [{ items: createTopicPageItems(6) }],
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      hasNext: false,
      loadNext: vi.fn(),
      refresh: vi.fn(),
      reset: vi.fn(),
      mutate: vi.fn()
    })

    renderTopicList()

    fireEvent.click(screen.getByRole('button', { name: 'Show more conversations' }))

    expect(
      screen.getAllByRole('button', { name: 'Assistant' }).some((button) => button.hasAttribute('aria-expanded'))
    ).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Display mode' }))
    expect(screen.queryByRole('button', { name: 'Collapse all' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Collapse conversations' })).toHaveTextContent('Collapse conversations')
  })

  it('subscribes topic stream status only for rows visible in the ResourceList view', () => {
    MockUsePreferenceUtils.setPreferenceValue('topic.tab.display_mode' as never, 'time')
    mockUseQuery.mockImplementation((path) => {
      if (path === '/pins') {
        return {
          data: [],
          isLoading: false,
          isRefreshing: false,
          error: undefined,
          refetch: vi.fn().mockResolvedValue(undefined),
          mutate: vi.fn().mockResolvedValue(undefined)
        }
      }
      return {
        data: undefined,
        isLoading: false,
        isRefreshing: false,
        error: undefined,
        refetch: vi.fn().mockResolvedValue(undefined),
        mutate: vi.fn().mockResolvedValue(undefined)
      }
    })
    mockUseInfiniteQuery.mockReturnValue({
      pages: [{ items: createTopicPageItems(6) }],
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      hasNext: false,
      loadNext: vi.fn(),
      refresh: vi.fn(),
      reset: vi.fn(),
      mutate: vi.fn()
    })
    const subscribeSpy = vi.spyOn(cacheService, 'subscribe')

    try {
      renderTopicList()

      const subscribedKeys = subscribeSpy.mock.calls.map(([key]) => key)
      expect(subscribedKeys).toContain(topicStreamStatusCacheKey('topic-5'))
      expect(subscribedKeys).toContain(topicStreamLastSeenCompletionCacheKey('topic-5'))
      expect(subscribedKeys).not.toContain(topicStreamStatusCacheKey('topic-6'))
      expect(subscribedKeys).not.toContain(topicStreamLastSeenCompletionCacheKey('topic-6'))
    } finally {
      subscribeSpy.mockRestore()
    }
  })

  it('keeps the pinned group first and lets each group collapse independently', () => {
    MockUsePreferenceUtils.setPreferenceValue('topic.tab.display_mode' as never, 'time')
    setTopicGroupExpansionCache(createExpandedTopicGroupExpansionFixture())
    const { rerenderTopicList } = renderTopicList()

    const groupButtons = screen.getAllByRole('button', { expanded: true })
    expect(groupButtons.map((button) => button.textContent)).toEqual([
      'Pinned',
      'Today',
      'Yesterday',
      'This week',
      'Earlier'
    ])
    expect(screen.getByRole('button', { name: 'Pinned' }).querySelector('.lucide-chevron-down')).toBeNull()
    expect(screen.getByRole('button', { name: 'Today' }).querySelector('.lucide-chevron-down')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Pinned' }))
    rerenderTopicList()

    expect(screen.getByRole('button', { name: 'Pinned' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Beta pinned')).not.toBeInTheDocument()
    expect(screen.getByText('Alpha topic')).toBeInTheDocument()
  })

  it('restores and persists collapsed topic groups from cache', () => {
    MockUsePreferenceUtils.setPreferenceValue('topic.tab.display_mode' as never, 'time')
    setTopicGroupExpansionCache({
      ...createExpandedTopicGroupExpansionFixture(),
      // Collapse everything except "today".
      time: ALL_TOPIC_TIME_GROUP_IDS.filter((id) => id !== 'topic:time:today')
    })

    const { rerenderTopicList } = renderTopicList()

    expect(screen.getByRole('button', { name: 'Today' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: 'Today' }).querySelector('.lucide-chevron-down')).toBeNull()
    expect(screen.getByText('Alpha topic')).toBeInTheDocument()
    expect(screen.queryByText('Beta pinned')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Today' }))
    expect(getTopicGroupExpansionCache().time).toContain('topic:time:today')
    rerenderTopicList()
    expect(screen.getByRole('button', { name: 'Today' }).querySelector('.lucide-chevron-down')).toBeNull()
    expect(screen.getByRole('button', { name: 'Today' })).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(screen.getByRole('button', { name: 'Pinned' }))
    expect(getTopicGroupExpansionCache().time).not.toContain('topic:pinned')
    rerenderTopicList()
    expect(screen.getByRole('button', { name: 'Pinned' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('renders the topic header controls and persists display mode selection', () => {
    renderTopicList()

    expect(screen.getByTestId('resource-list-topic')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Search conversations')).not.toBeInTheDocument()

    expect(screen.queryByLabelText('Manage topics')).not.toBeInTheDocument()

    const displayModeContent = openTopicListOptions()
    expect(displayModeContent).toHaveClass('w-44', 'p-1')
    // Each options item now renders a leading icon.
    expect(displayModeContent?.querySelector('svg')).not.toBeNull()
    expect(screen.getByText('Display mode')).toHaveClass('text-xs', 'font-medium', 'text-muted-foreground')
    // Options items rely on MenuItem's built-in `size="sm"` styling; the ad-hoc 11px override is gone.
    expect(within(displayModeContent as HTMLElement).getByRole('button', { name: 'Time' })).not.toHaveClass(
      'text-[11px]'
    )
    expect(within(displayModeContent as HTMLElement).getByRole('button', { name: 'Time' })).toBeInTheDocument()
    expect(within(displayModeContent as HTMLElement).getByRole('button', { name: 'Assistant' })).toBeInTheDocument()
    expect(
      within(displayModeContent as HTMLElement).queryByRole('button', { name: 'Manage topics' })
    ).not.toBeInTheDocument()

    fireEvent.click(within(displayModeContent as HTMLElement).getByRole('button', { name: 'Time' }))
    expect(MockUsePreferenceUtils.getPreferenceValue('topic.tab.display_mode' as never)).toBe('time')

    const nextDisplayModeContent = openTopicListOptions()
    fireEvent.click(within(nextDisplayModeContent as HTMLElement).getByRole('button', { name: 'Assistant' }))
    expect(MockUsePreferenceUtils.getPreferenceValue('topic.tab.display_mode' as never)).toBe('assistant')
  })

  it('keeps assistant grouped topics in the generic loading state until all pages are ready', () => {
    MockUsePreferenceUtils.setPreferenceValue('topic.tab.display_mode' as never, 'assistant')
    mockUseInfiniteQuery.mockReturnValue({
      pages: [
        {
          items: [
            createApiTopic({
              id: 'topic-first-page',
              name: 'First page topic',
              assistantId: 'assistant-1',
              orderKey: 'a'
            })
          ]
        }
      ],
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      hasNext: true,
      loadNext: vi.fn(),
      refresh: vi.fn(),
      reset: vi.fn(),
      mutate: vi.fn()
    })

    renderTopicList()

    expect(screen.getByTestId('resource-list-topic')).toBeInTheDocument()
    expect(screen.queryByTestId('resource-list-grouped-loading')).not.toBeInTheDocument()
    expect(screen.queryByText('Alpha Assistant')).not.toBeInTheDocument()
    expect(screen.queryByText('Beta Assistant')).not.toBeInTheDocument()
    expect(screen.queryByText('First page topic')).not.toBeInTheDocument()
    expect(screen.queryByText('1')).not.toBeInTheDocument()
    expect(screen.queryAllByTestId('topic-list-row')).toHaveLength(0)
    expect(document.querySelectorAll('[data-resource-list-loading-group]')).toHaveLength(2)
    expect(document.querySelectorAll('[data-resource-list-loading-item]')).toHaveLength(5)
    expect(document.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0)
  })

  it('reveals a history-selected topic hidden by show-more', async () => {
    MockUsePreferenceUtils.setPreferenceValue('topic.tab.display_mode' as never, 'time')
    setTopicGroupExpansionCache({
      ...createExpandedTopicGroupExpansionFixture(),
      // Collapse everything except "today".
      time: ALL_TOPIC_TIME_GROUP_IDS.filter((id) => id !== 'topic:time:today')
    })
    mockUseInfiniteQuery.mockReturnValue({
      pages: [
        {
          items: createTopicPageItems(6)
        }
      ],
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      hasNext: false,
      loadNext: vi.fn(),
      refresh: vi.fn(),
      reset: vi.fn(),
      mutate: vi.fn()
    })

    const { rerenderTopicList } = renderTopicList()

    expect(screen.getByRole('button', { name: 'Today' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.queryByText('Topic 6')).not.toBeInTheDocument()

    rerenderTopicList({ itemId: 'topic-6', requestId: 1, clearFilters: true, clearQuery: true })

    expect(await screen.findByText('Topic 6')).toBeInTheDocument()
    const revealedRow = screen.getByText('Topic 6').closest('[role="option"]')
    expect(revealedRow).not.toBeNull()
    expect(revealedRow!).toHaveAttribute('data-reveal-focus', 'true')
    expect(revealedRow!).toHaveClass('animation-resource-list-reveal-focus')
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Today' })).toHaveAttribute('aria-expanded', 'true')
    expect(virtualMocks.scrollToIndex).toHaveBeenCalledWith(expect.any(Number), { align: 'center' })
  })

  it('adds a new topic from the header create action', () => {
    const { onNewTopic } = renderTopicList()

    const assistantHeader = screen.getByRole('button', { name: 'Alpha Assistant' }).closest('div')
    expect(assistantHeader).toBeInTheDocument()

    const createButton = within(assistantHeader as HTMLElement).getByRole('button', { name: 'chat.conversation.new' })
    expect(createButton).toBeInTheDocument()
    expect(createButton).not.toHaveClass('border')
    expect(createButton.querySelector('.lucide-square-pen')).toBeInTheDocument()
    expect(screen.getByRole('listbox')).toHaveClass('pt-0')

    fireEvent.click(createButton)

    expect(onNewTopic).toHaveBeenCalledWith({ assistantId: 'assistant-1' })
  })

  it('does not show group header create actions in time display mode', () => {
    MockUsePreferenceUtils.setPreferenceValue('topic.tab.display_mode' as never, 'time')
    renderTopicList()

    for (const groupName of ['Pinned', 'Today', 'Yesterday', 'This week', 'Earlier'] as const) {
      const header = screen.getByRole('button', { name: groupName }).closest('div')
      expect(header).toBeInTheDocument()
      expect(
        within(header as HTMLElement).queryByRole('button', { name: 'chat.conversation.new' })
      ).not.toBeInTheDocument()
    }
  })

  it('uses a generic header create action in time display mode', () => {
    MockUsePreferenceUtils.setPreferenceValue('topic.tab.display_mode' as never, 'time')
    const { onNewTopic } = renderTopicList()

    fireEvent.click(screen.getByRole('button', { name: 'chat.conversation.new' }))

    expect(onNewTopic).toHaveBeenCalledWith(undefined)
  })

  it('creates a topic from the header using the latest unpinned row', () => {
    mockUseInfiniteQuery.mockReturnValue({
      pages: [
        {
          items: [
            createApiTopic({
              id: 'topic-a',
              name: 'Older alpha',
              assistantId: 'assistant-1',
              orderKey: 'a',
              updatedAt: '2026-01-02T01:00:00.000Z'
            }),
            createApiTopic({
              id: 'topic-b',
              name: 'Pinned newest alpha',
              assistantId: 'assistant-1',
              orderKey: 'b',
              updatedAt: '2026-01-04T01:00:00.000Z'
            }),
            createApiTopic({
              id: 'topic-c',
              name: 'Latest beta',
              assistantId: 'assistant-2',
              orderKey: 'c',
              updatedAt: '2026-01-03T01:00:00.000Z'
            })
          ]
        }
      ],
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      hasNext: false,
      loadNext: vi.fn(),
      refresh: vi.fn(),
      reset: vi.fn(),
      mutate: vi.fn()
    })
    const { onNewTopic } = renderTopicList()

    fireEvent.click(screen.getAllByRole('button', { name: 'chat.conversation.new' })[0])

    expect(onNewTopic).toHaveBeenCalledWith({ assistantId: 'assistant-2' })
  })

  it('does not enable drag reorder in time mode', () => {
    const patchSpy = vi.spyOn(dataApiService, 'patch').mockResolvedValue(undefined as never)
    MockUsePreferenceUtils.setPreferenceValue('topic.tab.display_mode' as never, 'time')

    renderTopicList()

    expect(screen.queryByTestId('dnd-context')).not.toBeInTheDocument()
    dndMocks.onDragEnd?.({ active: { id: 'topic-a' }, over: { id: 'topic-c' } })

    expect(patchSpy).not.toHaveBeenCalled()
  })

  it('renders assistant groups and creates topics with the selected assistant payload', () => {
    MockUsePreferenceUtils.setPreferenceValue('topic.tab.display_mode' as never, 'assistant')
    setTopicGroupExpansionCache({
      ...createExpandedTopicGroupExpansionFixture(),
      // Collapse all assistant groups; sections stay expanded.
      assistant: [TOPIC_UNLINKED_ASSISTANT_GROUP_ID, 'topic:assistant:assistant-1', 'topic:assistant:assistant-2']
    })
    mockUseQuery.mockImplementation((path) => {
      if (path === '/pins') {
        return {
          data: [{ id: 'pin-topic-b', entityId: 'topic-b', entityType: 'topic' }],
          isLoading: false,
          isRefreshing: false,
          error: undefined,
          refetch: vi.fn().mockResolvedValue(undefined),
          mutate: vi.fn().mockResolvedValue(undefined)
        }
      }
      if (path === '/assistants') {
        return {
          data: {
            items: [
              {
                id: 'assistant-1',
                name: 'Alpha Assistant',
                emoji: '🧪',
                createdAt: '2026-01-01T00:00:00.000Z',
                updatedAt: '2026-01-01T00:00:00.000Z'
              },
              {
                id: 'assistant-2',
                name: 'Beta Assistant',
                emoji: '✍️',
                createdAt: '2026-01-01T00:00:00.000Z',
                updatedAt: '2026-01-01T00:00:00.000Z'
              },
              {
                id: 'assistant-3',
                name: 'Gamma Assistant',
                emoji: '🧭',
                createdAt: '2026-01-01T00:00:00.000Z',
                updatedAt: '2026-01-01T00:00:00.000Z'
              }
            ],
            total: 3
          },
          isLoading: false,
          isRefreshing: false,
          error: undefined,
          refetch: vi.fn().mockResolvedValue(undefined),
          mutate: vi.fn().mockResolvedValue(undefined)
        }
      }
      return {
        data: undefined,
        isLoading: false,
        isRefreshing: false,
        error: undefined,
        refetch: vi.fn().mockResolvedValue(undefined),
        mutate: vi.fn().mockResolvedValue(undefined)
      }
    })
    mockUseInfiniteQuery.mockReturnValue({
      pages: [
        {
          items: [
            createApiTopic({
              id: 'topic-a',
              name: 'Known alpha',
              assistantId: 'assistant-1',
              orderKey: 'a'
            }),
            createApiTopic({
              id: 'topic-b',
              name: 'Pinned unknown',
              assistantId: 'missing-assistant',
              orderKey: 'b'
            }),
            createApiTopic({
              id: 'topic-c',
              name: 'Default topic',
              assistantId: undefined,
              orderKey: 'c'
            }),
            createApiTopic({
              id: 'topic-d',
              name: 'Known beta',
              assistantId: 'assistant-2',
              orderKey: 'd'
            }),
            createApiTopic({
              id: 'topic-e',
              name: 'Unknown topic',
              assistantId: 'missing-assistant',
              orderKey: 'e'
            })
          ]
        }
      ],
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      hasNext: false,
      loadNext: vi.fn(),
      refresh: vi.fn(),
      reset: vi.fn(),
      mutate: vi.fn()
    })

    const { onNewTopic } = renderTopicList()

    expect(screen.getByRole('button', { name: 'Pinned' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Default Assistant' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Alpha Assistant' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Beta Assistant' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Gamma Assistant' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Unlinked Assistant' })).not.toBeInTheDocument()
    const assistantSectionButton = screen
      .getAllByRole('button', { name: 'Assistant' })
      .find((button) => button.hasAttribute('aria-expanded'))
    expect(screen.getByRole('button', { name: 'Pinned' })).toHaveAttribute('aria-expanded', 'true')
    expect(assistantSectionButton).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: 'Alpha Assistant' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('button', { name: 'Beta Assistant' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('button', { name: 'Default Assistant' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText('Pinned unknown')).toBeInTheDocument()
    expect(screen.queryByText('Known alpha')).not.toBeInTheDocument()
    expect(screen.queryByText('Known beta')).not.toBeInTheDocument()
    expect(screen.queryByText('Default topic')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Alpha Assistant' }).closest('div')).toHaveTextContent('🧪')
    expect(screen.getByRole('button', { name: 'Beta Assistant' }).closest('div')).toHaveTextContent('✍️')
    expect(screen.getByRole('button', { name: 'Default Assistant' }).closest('div')).toHaveTextContent('😀')

    fireEvent.click(screen.getByRole('button', { name: 'Alpha Assistant' }))

    // Sections stay expanded; expanding Alpha removes it from the collapsed list.
    expect(getTopicGroupExpansionCache().assistant).not.toContain(TOPIC_PINNED_SECTION_ID)
    expect(getTopicGroupExpansionCache().assistant).not.toContain(TOPIC_ASSISTANT_SECTION_ID)
    expect(getTopicGroupExpansionCache().assistant).not.toContain('topic:assistant:assistant-1')
    expect(getTopicGroupExpansionCache().assistant).toContain('topic:assistant:assistant-2')
    const assistantHeader = screen.getByRole('button', { name: 'Alpha Assistant' }).closest('div')
    expect(assistantHeader).toBeInTheDocument()
    fireEvent.click(within(assistantHeader as HTMLElement).getByRole('button', { name: 'chat.conversation.new' }))
    expect(onNewTopic).toHaveBeenCalledWith({ assistantId: 'assistant-1' })

    for (const groupName of ['Pinned', 'Default Assistant'] as const) {
      const header = screen.getByRole('button', { name: groupName }).closest('div')
      expect(header).toBeInTheDocument()
      expect(
        within(header as HTMLElement).queryByRole('button', { name: 'chat.conversation.new' })
      ).not.toBeInTheDocument()
    }
  })

  it('moves assistant group actions into the more menu', async () => {
    MockUsePreferenceUtils.setPreferenceValue('topic.tab.display_mode' as never, 'assistant')
    const { onNewTopic, setActiveTopic } = renderTopicList()

    const assistantGroupButton = screen.getByRole('button', { name: 'Alpha Assistant' })
    const assistantHeader = assistantGroupButton.closest('div')
    expect(assistantHeader).toBeInTheDocument()
    expect((assistantHeader as HTMLElement).querySelector('[aria-label="Edit Assistant"]')).not.toBeInTheDocument()

    const moreButton = within(assistantHeader as HTMLElement).getByRole('button', { name: 'More' })
    fireEvent.click(moreButton)
    expect(assistantGroupButton).toHaveAttribute('aria-expanded', 'true')

    const animationFrameCallbacks: FrameRequestCallback[] = []
    const requestAnimationFrameSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      animationFrameCallbacks.push(callback)
      return animationFrameCallbacks.length
    })

    fireEvent.click(within(assistantHeader as HTMLElement).getByRole('button', { name: 'Edit Assistant' }))
    await vi.waitFor(() => expect(animationFrameCallbacks).toHaveLength(1))
    act(() => {
      for (const callback of animationFrameCallbacks.splice(0)) {
        callback(0)
      }
    })
    expect(screen.getByTestId('resource-edit-dialog-host')).toHaveAttribute('data-kind', 'assistant')
    expect(screen.getByTestId('resource-edit-dialog-host')).toHaveAttribute('data-id', 'assistant-1')
    expect(tabsContextMocks.openTab).not.toHaveBeenCalledWith(
      '/app/library?resourceType=assistant&action=edit&id=assistant-1',
      expect.anything()
    )
    requestAnimationFrameSpy.mockRestore()

    fireEvent.click(moreButton)
    fireEvent.click(within(assistantHeader as HTMLElement).getByRole('button', { name: 'Pin Assistant' }))
    await vi.waitFor(() =>
      expect(pinMutationMocks.createPin).toHaveBeenCalledWith({
        body: { entityType: 'assistant', entityId: 'assistant-1' }
      })
    )

    fireEvent.click(moreButton)
    const deleteAssistantChatsButton = within(assistantHeader as HTMLElement).getByRole('button', {
      name: 'Delete all assistant conversations'
    })
    expect(deleteAssistantChatsButton.querySelector('svg')).toHaveClass('lucide-custom', 'text-destructive')
    topicDataMocks.deleteTopicsByAssistantId.mockResolvedValueOnce({
      deletedIds: ['topic-a', 'topic-b'],
      deletedCount: 2
    })
    fireEvent.click(deleteAssistantChatsButton)

    await vi.waitFor(() =>
      expect(window.modal.confirm).toHaveBeenCalledWith(
        expect.objectContaining({
          content: 'Delete all assistant conversations?',
          title: 'Clear conversations'
        })
      )
    )
    await vi.waitFor(() => expect(topicDataMocks.deleteTopicsByAssistantId).toHaveBeenCalledWith('assistant-1'))
    expect(topicDataMocks.deleteTopic).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(topicDataMocks.refreshTopics).toHaveBeenCalled())
    expect(setActiveTopic).toHaveBeenCalledWith(expect.objectContaining({ id: 'topic-c' }))
    expect(onNewTopic).not.toHaveBeenCalled()

    fireEvent.click(within(assistantHeader as HTMLElement).getByRole('button', { name: 'chat.conversation.new' }))
    expect(onNewTopic).toHaveBeenCalledWith({ assistantId: 'assistant-1' })
  })

  it('blocks concurrent assistant group delete confirmations', async () => {
    let resolveConfirm!: (value: boolean) => void
    const confirmPromise = new Promise<boolean>((resolve) => {
      resolveConfirm = resolve
    })
    const confirm = vi.fn().mockReturnValue(confirmPromise)
    Object.assign(window, {
      modal: { confirm }
    })
    MockUsePreferenceUtils.setPreferenceValue('topic.tab.display_mode' as never, 'assistant')
    topicDataMocks.deleteTopicsByAssistantId.mockResolvedValueOnce({
      deletedIds: ['topic-a', 'topic-b'],
      deletedCount: 2
    })

    renderTopicList()

    const alphaHeader = screen.getByRole('button', { name: 'Alpha Assistant' }).closest('div')
    const betaHeader = screen.getByRole('button', { name: 'Beta Assistant' }).closest('div')
    expect(alphaHeader).toBeInTheDocument()
    expect(betaHeader).toBeInTheDocument()
    fireEvent.click(within(alphaHeader as HTMLElement).getByRole('button', { name: 'More' }))
    fireEvent.click(
      within(alphaHeader as HTMLElement).getByRole('button', { name: 'Delete all assistant conversations' })
    )

    await vi.waitFor(() => expect(confirm).toHaveBeenCalledTimes(1))
    fireEvent.click(within(betaHeader as HTMLElement).getByRole('button', { name: 'More' }))
    const betaDeleteButton = within(betaHeader as HTMLElement).getByRole('button', {
      name: 'Delete all assistant conversations'
    })
    await vi.waitFor(() => expect(betaDeleteButton).toBeDisabled())
    fireEvent.click(betaDeleteButton)

    expect(confirm).toHaveBeenCalledTimes(1)
    expect(topicDataMocks.deleteTopicsByAssistantId).not.toHaveBeenCalled()

    await act(async () => {
      resolveConfirm(true)
      await confirmPromise
    })

    await vi.waitFor(() => expect(topicDataMocks.deleteTopicsByAssistantId).toHaveBeenCalledTimes(1))
    expect(topicDataMocks.deleteTopicsByAssistantId).toHaveBeenCalledWith('assistant-1')
  })

  it('selects the first topic from an assistant group before toggling that selected group', () => {
    MockUsePreferenceUtils.setPreferenceValue('topic.tab.display_mode' as never, 'assistant')
    const { rerenderTopicList, setActiveTopic } = renderTopicList()

    const betaGroupButton = screen.getByRole('button', { name: 'Beta Assistant' })
    expect(betaGroupButton).toHaveAttribute('aria-expanded', 'true')

    fireEvent.click(betaGroupButton)

    expect(setActiveTopic).toHaveBeenCalledWith(expect.objectContaining({ id: 'topic-c' }))
    expect(betaGroupButton).toHaveAttribute('aria-expanded', 'true')
    expect(getTopicGroupExpansionCache().assistant).not.toContain('topic:assistant:assistant-2')

    rerenderTopicList(
      undefined,
      createRendererTopic({ id: 'topic-c', assistantId: 'assistant-2', name: 'Gamma topic' })
    )

    const selectedBetaGroupButton = screen.getByRole('button', { name: 'Beta Assistant' })
    expect(selectedBetaGroupButton).toHaveAttribute('aria-current', 'true')
    expect(selectedBetaGroupButton.closest('[data-selected]')).toHaveAttribute('data-selected', 'true')

    fireEvent.click(selectedBetaGroupButton)
    expect(getTopicGroupExpansionCache().assistant).toContain('topic:assistant:assistant-2')

    rerenderTopicList(
      undefined,
      createRendererTopic({ id: 'topic-c', assistantId: 'assistant-2', name: 'Gamma topic' })
    )
    expect(screen.getByRole('button', { name: 'Beta Assistant' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('opens the assistant group more menu from the group header context menu', () => {
    MockUsePreferenceUtils.setPreferenceValue('topic.tab.display_mode' as never, 'assistant')
    renderTopicList()

    const assistantGroupButton = screen.getByRole('button', { name: 'Alpha Assistant' })
    const assistantHeader = assistantGroupButton.closest('div')
    expect(assistantHeader).toBeInTheDocument()

    fireEvent.contextMenu(assistantHeader as HTMLElement, { clientX: 123, clientY: 456 })

    expect(screen.getAllByRole('button', { name: 'Edit Assistant' }).length).toBeGreaterThan(0)
  })

  it('keeps at least one topic when clearing an assistant group would delete all topics', async () => {
    MockUsePreferenceUtils.setPreferenceValue('topic.tab.display_mode' as never, 'assistant')
    mockUseInfiniteQuery.mockReturnValue({
      pages: [
        {
          items: [
            createApiTopic({
              id: 'topic-a',
              name: 'Alpha topic',
              assistantId: 'assistant-1',
              orderKey: 'a'
            }),
            createApiTopic({
              id: 'topic-b',
              name: 'Beta pinned',
              assistantId: 'assistant-1',
              orderKey: 'b'
            })
          ]
        }
      ],
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      hasNext: false,
      loadNext: vi.fn(),
      refresh: vi.fn(),
      reset: vi.fn(),
      mutate: vi.fn()
    })

    renderTopicList()

    const assistantHeader = screen.getByRole('button', { name: 'Alpha Assistant' }).closest('div')
    expect(assistantHeader).toBeInTheDocument()

    const moreButton = within(assistantHeader as HTMLElement).getByRole('button', { name: 'More' })
    fireEvent.click(moreButton)
    fireEvent.click(
      within(assistantHeader as HTMLElement).getByRole('button', { name: 'Delete all assistant conversations' })
    )

    await vi.waitFor(() => expect(window.toast.error).toHaveBeenCalledWith('At least one conversation must be kept'))
    expect(window.modal.confirm).not.toHaveBeenCalled()
    expect(topicDataMocks.deleteTopic).not.toHaveBeenCalled()
    expect(topicDataMocks.deleteTopicsByAssistantId).not.toHaveBeenCalled()
    expect(topicDataMocks.refreshTopics).not.toHaveBeenCalled()
  })

  it('keeps assistant pin reads disabled outside assistant display mode', () => {
    MockUsePreferenceUtils.setPreferenceValue('topic.tab.display_mode' as never, 'time')

    renderTopicList()

    expect(mockUseQuery).toHaveBeenCalledWith('/pins', {
      enabled: false,
      query: { entityType: 'assistant' }
    })
  })

  it('persists assistant group collapse without affecting time groups', () => {
    MockUsePreferenceUtils.setPreferenceValue('topic.tab.display_mode' as never, 'assistant')
    setTopicGroupExpansionCache({
      ...createExpandedTopicGroupExpansionFixture(),
      // Collapse assistant-1; assistant-2 stays expanded.
      assistant: ['topic:assistant:assistant-1']
    })

    renderTopicList()

    expect(screen.getByRole('button', { name: 'Alpha Assistant' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Alpha topic')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Beta Assistant' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Gamma topic')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Alpha Assistant' }))
    // Expanding Alpha clears the assistant collapse list; time groups stay untouched.
    expect(getTopicGroupExpansionCache().assistant).not.toContain('topic:assistant:assistant-1')
    expect(getTopicGroupExpansionCache().assistant).not.toContain('topic:assistant:assistant-2')
    expect(getTopicGroupExpansionCache().time).toEqual([])
  })

  it('persists assistant group reorder and applies the assistant order optimistically', async () => {
    const patchSpy = vi.spyOn(dataApiService, 'patch').mockResolvedValue(undefined as never)
    MockUsePreferenceUtils.setPreferenceValue('topic.tab.display_mode' as never, 'assistant')

    renderTopicList()

    dndMocks.onDragEnd?.({
      active: {
        data: sortableData('group:topic:assistant:assistant-1'),
        id: 'group:topic:assistant:assistant-1'
      },
      over: {
        data: sortableData('group:topic:assistant:assistant-2'),
        id: 'group:topic:assistant:assistant-2'
      }
    })

    await vi.waitFor(() => {
      const rowTexts = screen.getAllByTestId('topic-list-row').map((row) => row.textContent ?? '')
      expect(rowTexts.findIndex((text) => text.includes('Alpha topic'))).toBeGreaterThan(
        rowTexts.findIndex((text) => text.includes('Gamma topic'))
      )
    })
    await vi.waitFor(() =>
      expect(patchSpy).toHaveBeenCalledWith('/assistants/assistant-1/order', { body: { after: 'assistant-2' } })
    )
    expect(patchSpy).toHaveBeenCalledTimes(1)
  })

  it('shows a toast when assistant group reorder persistence fails', async () => {
    const patchSpy = vi.spyOn(dataApiService, 'patch').mockRejectedValue(new Error('order failed'))
    MockUsePreferenceUtils.setPreferenceValue('topic.tab.display_mode' as never, 'assistant')

    renderTopicList()

    dndMocks.onDragEnd?.({
      active: {
        data: sortableData('group:topic:assistant:assistant-1'),
        id: 'group:topic:assistant:assistant-1'
      },
      over: {
        data: sortableData('group:topic:assistant:assistant-2'),
        id: 'group:topic:assistant:assistant-2'
      }
    })

    await vi.waitFor(() =>
      expect(window.toast.error).toHaveBeenCalledWith('Failed to reorder assistants: order failed')
    )
    expect(patchSpy).toHaveBeenCalledWith('/assistants/assistant-1/order', { body: { after: 'assistant-2' } })
  })

  it('treats the default assistant database row as a normal draggable assistant group', async () => {
    const patchSpy = vi.spyOn(dataApiService, 'patch').mockResolvedValue(undefined as never)
    MockUsePreferenceUtils.setPreferenceValue('topic.tab.display_mode' as never, 'assistant')
    mockUseQuery.mockImplementation((path) => {
      if (path === '/pins') {
        return {
          data: [],
          isLoading: false,
          isRefreshing: false,
          error: undefined,
          refetch: vi.fn().mockResolvedValue(undefined),
          mutate: vi.fn().mockResolvedValue(undefined)
        }
      }
      if (path === '/assistants') {
        return {
          data: {
            items: [
              {
                id: 'assistant-default',
                name: 'Default Assistant',
                emoji: '😀',
                orderKey: 'a',
                createdAt: '2026-01-01T00:00:00.000Z',
                updatedAt: '2026-01-01T00:00:00.000Z'
              },
              {
                id: 'assistant-2',
                name: 'Beta Assistant',
                emoji: '✍️',
                orderKey: 'b',
                createdAt: '2026-01-01T00:00:00.000Z',
                updatedAt: '2026-01-01T00:00:00.000Z'
              }
            ],
            total: 2
          },
          isLoading: false,
          isRefreshing: false,
          error: undefined,
          refetch: vi.fn().mockResolvedValue(undefined),
          mutate: vi.fn().mockResolvedValue(undefined)
        }
      }
      return {
        data: undefined,
        isLoading: false,
        isRefreshing: false,
        error: undefined,
        refetch: vi.fn().mockResolvedValue(undefined),
        mutate: vi.fn().mockResolvedValue(undefined)
      }
    })
    mockUseInfiniteQuery.mockReturnValue({
      pages: [
        {
          items: [
            createApiTopic({
              id: 'topic-default',
              name: 'Default row topic',
              assistantId: 'assistant-default',
              orderKey: 'a'
            }),
            createApiTopic({ id: 'topic-beta', name: 'Beta row topic', assistantId: 'assistant-2', orderKey: 'b' })
          ]
        }
      ],
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      hasNext: false,
      loadNext: vi.fn(),
      refresh: vi.fn(),
      reset: vi.fn(),
      mutate: vi.fn()
    })

    renderTopicList()

    dndMocks.onDragEnd?.({
      active: {
        data: sortableData('group:topic:assistant:assistant-default'),
        id: 'group:topic:assistant:assistant-default'
      },
      over: {
        data: sortableData('group:topic:assistant:assistant-2'),
        id: 'group:topic:assistant:assistant-2'
      }
    })

    await vi.waitFor(() =>
      expect(patchSpy).toHaveBeenCalledWith('/assistants/assistant-default/order', {
        body: { after: 'assistant-2' }
      })
    )
    expect(patchSpy).toHaveBeenCalledTimes(1)
  })

  it('does not allow pinned or unknown groups to participate in assistant group reorder', () => {
    const patchSpy = vi.spyOn(dataApiService, 'patch').mockResolvedValue(undefined as never)
    MockUsePreferenceUtils.setPreferenceValue('topic.tab.display_mode' as never, 'assistant')
    mockUseInfiniteQuery.mockReturnValue({
      pages: [
        {
          items: [
            createApiTopic({ id: 'topic-a', name: 'Known alpha', assistantId: 'assistant-1', orderKey: 'a' }),
            createApiTopic({ id: 'topic-b', name: 'Pinned topic', assistantId: 'assistant-1', orderKey: 'b' }),
            createApiTopic({
              id: 'topic-e',
              name: 'Unknown topic',
              assistantId: 'missing-assistant',
              orderKey: 'e'
            })
          ]
        }
      ],
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      hasNext: false,
      loadNext: vi.fn(),
      refresh: vi.fn(),
      reset: vi.fn(),
      mutate: vi.fn()
    })

    renderTopicList()

    expect(screen.getByRole('button', { name: 'Pinned' })).toBeInTheDocument()
    expect(
      screen
        .getAllByRole('button', { name: 'Assistant' })
        .some((button) => button.getAttribute('aria-expanded') === 'true')
    ).toBe(true)
    expect(dndMocks.sortableData.has('group:topic:pinned')).toBe(false)
    expect(dndMocks.sortableData.has('group:topic:section:pinned')).toBe(false)
    expect(dndMocks.sortableData.has('group:topic:assistant:unknown')).toBe(false)

    dndMocks.onDragEnd?.({
      active: {
        data: sortableData('group:topic:assistant:assistant-1'),
        id: 'group:topic:assistant:assistant-1'
      },
      over: { data: droppableData('group:topic:section:pinned'), id: 'group:topic:section:pinned' }
    })
    dndMocks.onDragEnd?.({
      active: {
        data: sortableData('group:topic:assistant:assistant-1'),
        id: 'group:topic:assistant:assistant-1'
      },
      over: {
        data: droppableData('group:topic:assistant:unknown'),
        id: 'group:topic:assistant:unknown'
      }
    })

    expect(patchSpy).not.toHaveBeenCalled()
  })

  it('moves only the active topic in the optimistic display overlay without rewriting order keys', () => {
    const topics = [
      createRendererTopic({ id: 'topic-a', name: 'Known alpha', assistantId: 'assistant-1', orderKey: 'a' }),
      createRendererTopic({ id: 'topic-c', name: 'Known beta', assistantId: 'assistant-2', orderKey: 'c' }),
      createRendererTopic({ id: 'topic-d', name: 'Beta tail', assistantId: 'assistant-2', orderKey: 'd' })
    ]
    const groupBy = (topic: Topic) => ({
      id: topic.assistantId ? `topic:assistant:${topic.assistantId}` : 'topic:assistant:unknown',
      label: topic.assistantId ?? 'unlinked'
    })

    const next = applyOptimisticTopicDisplayMove(
      topics,
      {
        type: 'item',
        activeId: 'topic-a',
        overId: 'topic-c',
        overType: 'item',
        position: 'after',
        sourceGroupId: 'topic:assistant:assistant-1',
        targetGroupId: 'topic:assistant:assistant-2',
        sourceIndex: 0,
        targetIndex: 0
      },
      'assistant-2',
      groupBy
    )

    expect(next.map((topic) => topic.id)).toEqual(['topic-c', 'topic-a', 'topic-d'])
    expect(next.find((topic) => topic.id === 'topic-a')).toMatchObject({
      assistantId: 'assistant-2',
      orderKey: 'a'
    })
    expect(next.find((topic) => topic.id === 'topic-c')).toBe(topics[1])
    expect(next.find((topic) => topic.id === 'topic-d')).toBe(topics[2])
    expect(next.map((topic) => topic.orderKey)).toEqual(['c', 'a', 'd'])
  })

  it('uses the drag rect fallback when dropping without a prior insertion line', async () => {
    const patchSpy = vi.spyOn(dataApiService, 'patch').mockResolvedValue(undefined as never)
    MockUsePreferenceUtils.setPreferenceValue('topic.tab.display_mode' as never, 'assistant')

    renderTopicList()

    expect(screen.getByTestId('dnd-context')).toBeInTheDocument()
    dndMocks.onDragEnd?.({
      active: {
        data: sortableData('item:topic-d'),
        id: 'item:topic-d',
        rect: { current: { initial: null, translated: { top: 10, height: 20 } } }
      },
      over: { data: sortableData('item:topic-c'), id: 'item:topic-c', rect: { top: 80, height: 20 } }
    })

    await vi.waitFor(() => {
      const rowTexts = screen.getAllByTestId('topic-list-row').map((row) => row.textContent ?? '')
      expect(rowTexts.findIndex((text) => text.includes('Delta archive'))).toBeLessThan(
        rowTexts.findIndex((text) => text.includes('Gamma topic'))
      )
    })
    await vi.waitFor(() =>
      expect(patchSpy).toHaveBeenCalledWith('/topics/topic-d/order', { body: { before: 'topic-c' } })
    )
    expect(patchSpy).toHaveBeenCalledTimes(1)
    expect(patchSpy).not.toHaveBeenCalledWith('/topics/topic-d', expect.anything())
  })

  it('keeps multi-topic same-group drops at the fallback insertion index', async () => {
    const patchSpy = vi.spyOn(dataApiService, 'patch').mockResolvedValue(undefined as never)
    MockUsePreferenceUtils.setPreferenceValue('topic.tab.display_mode' as never, 'assistant')
    mockUseInfiniteQuery.mockReturnValue({
      pages: [
        {
          items: [
            createApiTopic({ id: 'topic-a', name: 'Alpha topic', assistantId: 'assistant-2', orderKey: 'a' }),
            createApiTopic({ id: 'topic-c', name: 'Gamma topic', assistantId: 'assistant-2', orderKey: 'c' }),
            createApiTopic({ id: 'topic-d', name: 'Delta archive', assistantId: 'assistant-2', orderKey: 'd' })
          ]
        }
      ],
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      hasNext: false,
      loadNext: vi.fn(),
      refresh: vi.fn(),
      reset: vi.fn(),
      mutate: vi.fn()
    })

    renderTopicList()

    dndMocks.onDragEnd?.({
      active: {
        data: sortableData('item:topic-c'),
        id: 'item:topic-c',
        rect: { current: { initial: null, translated: { top: 10, height: 20 } } }
      },
      over: { data: sortableData('item:topic-a'), id: 'item:topic-a', rect: { top: 80, height: 20 } }
    })

    await vi.waitFor(() => {
      const rowTexts = screen.getAllByTestId('topic-list-row').map((row) => row.textContent ?? '')
      expect(rowTexts.findIndex((text) => text.includes('Gamma topic'))).toBeLessThan(
        rowTexts.findIndex((text) => text.includes('Alpha topic'))
      )
      expect(rowTexts.findIndex((text) => text.includes('Alpha topic'))).toBeGreaterThan(
        rowTexts.findIndex((text) => text.includes('Gamma topic'))
      )
    })
    await vi.waitFor(() =>
      expect(patchSpy).toHaveBeenCalledWith('/topics/topic-c/order', { body: { before: 'topic-a' } })
    )
    expect(patchSpy).toHaveBeenCalledTimes(1)
  })

  it('keeps assistant grouped topics stable during cross-group drag hover', () => {
    const patchSpy = vi.spyOn(dataApiService, 'patch').mockResolvedValue(undefined as never)
    MockUsePreferenceUtils.setPreferenceValue('topic.tab.display_mode' as never, 'assistant')

    renderTopicList()

    const beforeHoverRows = screen.getAllByTestId('topic-list-row').map((row) => row.textContent ?? '')

    act(() => {
      dndMocks.onDragOver?.({
        active: {
          data: sortableData('item:topic-a'),
          id: 'item:topic-a',
          rect: { current: { initial: null, translated: { top: 100, height: 20 } } }
        },
        over: { data: sortableData('item:topic-d'), id: 'item:topic-d', rect: { top: 10, height: 20 } }
      })
    })

    expect(patchSpy).not.toHaveBeenCalled()
    expect(screen.getAllByTestId('topic-list-row').map((row) => row.textContent ?? '')).toEqual(beforeHoverRows)
    expect(document.querySelector('[data-drop-indicator="after"]')).toBeInTheDocument()
  })

  it('keeps assistant grouped topics stable during same-group drag hover', () => {
    const patchSpy = vi.spyOn(dataApiService, 'patch').mockResolvedValue(undefined as never)
    MockUsePreferenceUtils.setPreferenceValue('topic.tab.display_mode' as never, 'assistant')

    renderTopicList()

    const beforeHoverRows = screen.getAllByTestId('topic-list-row').map((row) => row.textContent ?? '')

    act(() => {
      dndMocks.onDragOver?.({
        active: {
          data: sortableData('item:topic-d'),
          id: 'item:topic-d',
          rect: { current: { initial: null, translated: { top: 10, height: 20 } } }
        },
        over: { data: sortableData('item:topic-c'), id: 'item:topic-c', rect: { top: 80, height: 20 } }
      })
    })

    expect(patchSpy).not.toHaveBeenCalled()
    expect(screen.getAllByTestId('topic-list-row').map((row) => row.textContent ?? '')).toEqual(beforeHoverRows)
    expect(document.querySelector('[data-drop-indicator="before"]')).toBeInTheDocument()
  })

  it('persists same-group drops using the last insertion line position', async () => {
    const patchSpy = vi.spyOn(dataApiService, 'patch').mockResolvedValue(undefined as never)
    MockUsePreferenceUtils.setPreferenceValue('topic.tab.display_mode' as never, 'assistant')

    renderTopicList()

    act(() => {
      dndMocks.onDragOver?.({
        active: {
          data: sortableData('item:topic-d'),
          id: 'item:topic-d',
          rect: { current: { initial: null, translated: { top: 10, height: 20 } } }
        },
        over: { data: sortableData('item:topic-c'), id: 'item:topic-c', rect: { top: 80, height: 20 } }
      })
    })

    dndMocks.onDragEnd?.({
      active: {
        data: sortableData('item:topic-d'),
        id: 'item:topic-d',
        rect: { current: { initial: null, translated: { top: 100, height: 20 } } }
      },
      over: { data: sortableData('item:topic-c'), id: 'item:topic-c', rect: { top: 10, height: 20 } }
    })

    await vi.waitFor(() => {
      const rowTexts = screen.getAllByTestId('topic-list-row').map((row) => row.textContent ?? '')
      expect(rowTexts.findIndex((text) => text.includes('Delta archive'))).toBeLessThan(
        rowTexts.findIndex((text) => text.includes('Gamma topic'))
      )
    })
    await vi.waitFor(() =>
      expect(patchSpy).toHaveBeenCalledWith('/topics/topic-d/order', { body: { before: 'topic-c' } })
    )
    expect(patchSpy).toHaveBeenCalledTimes(1)
  })

  it('moves topics across assistant groups before ordering them at the target position', async () => {
    const patchSpy = vi.spyOn(dataApiService, 'patch').mockResolvedValue(undefined as never)
    MockUsePreferenceUtils.setPreferenceValue('topic.tab.display_mode' as never, 'assistant')

    renderTopicList()

    dndMocks.onDragEnd?.({
      active: {
        data: sortableData('item:topic-a'),
        id: 'item:topic-a',
        rect: { current: { initial: null, translated: { top: 100, height: 20 } } }
      },
      over: { data: sortableData('item:topic-d'), id: 'item:topic-d', rect: { top: 10, height: 20 } }
    })

    await vi.waitFor(() => {
      const rowTexts = screen.getAllByTestId('topic-list-row').map((row) => row.textContent ?? '')
      expect(rowTexts.findIndex((text) => text.includes('Gamma topic'))).toBeLessThan(
        rowTexts.findIndex((text) => text.includes('Delta archive'))
      )
      expect(rowTexts.findIndex((text) => text.includes('Delta archive'))).toBeLessThan(
        rowTexts.findIndex((text) => text.includes('Alpha topic'))
      )
    })
    await vi.waitFor(() =>
      expect(patchSpy).toHaveBeenNthCalledWith(1, '/topics/topic-a', { body: { assistantId: 'assistant-2' } })
    )
    expect(patchSpy).toHaveBeenNthCalledWith(2, '/topics/topic-a/order', { body: { after: 'topic-d' } })
    expect(patchSpy).toHaveBeenCalledTimes(2)
  })

  it('refreshes topics after a cross-assistant move partially succeeds before ordering fails', async () => {
    const patchSpy = vi
      .spyOn(dataApiService, 'patch')
      .mockResolvedValueOnce(undefined as never)
      .mockRejectedValueOnce(new Error('order failed'))
    MockUsePreferenceUtils.setPreferenceValue('topic.tab.display_mode' as never, 'assistant')

    renderTopicList()

    dndMocks.onDragEnd?.({
      active: {
        data: sortableData('item:topic-a'),
        id: 'item:topic-a',
        rect: { current: { initial: null, translated: { top: 100, height: 20 } } }
      },
      over: { data: sortableData('item:topic-d'), id: 'item:topic-d', rect: { top: 10, height: 20 } }
    })

    await vi.waitFor(() => expect(patchSpy).toHaveBeenCalledTimes(2))
    expect(patchSpy).toHaveBeenNthCalledWith(1, '/topics/topic-a', { body: { assistantId: 'assistant-2' } })
    expect(patchSpy).toHaveBeenNthCalledWith(2, '/topics/topic-a/order', { body: { after: 'topic-d' } })
    await vi.waitFor(() => expect(topicDataMocks.refreshTopics).toHaveBeenCalledTimes(1))
  })

  it('does not drop topics into the unlinked assistant group for empty assistant ids', () => {
    const patchSpy = vi.spyOn(dataApiService, 'patch').mockResolvedValue(undefined as never)
    MockUsePreferenceUtils.setPreferenceValue('topic.tab.display_mode' as never, 'assistant')
    mockUseQuery.mockImplementation((path) => {
      if (path === '/pins') {
        return {
          data: [],
          isLoading: false,
          isRefreshing: false,
          error: undefined,
          refetch: vi.fn().mockResolvedValue(undefined),
          mutate: vi.fn().mockResolvedValue(undefined)
        }
      }
      if (path === '/assistants') {
        return {
          data: {
            items: [
              {
                id: 'assistant-1',
                name: 'Alpha Assistant',
                emoji: '🧪',
                createdAt: '2026-01-01T00:00:00.000Z',
                updatedAt: '2026-01-01T00:00:00.000Z'
              }
            ],
            total: 1
          },
          isLoading: false,
          isRefreshing: false,
          error: undefined,
          refetch: vi.fn().mockResolvedValue(undefined),
          mutate: vi.fn().mockResolvedValue(undefined)
        }
      }
      return {
        data: undefined,
        isLoading: false,
        isRefreshing: false,
        error: undefined,
        refetch: vi.fn().mockResolvedValue(undefined),
        mutate: vi.fn().mockResolvedValue(undefined)
      }
    })
    mockUseInfiniteQuery.mockReturnValue({
      pages: [
        {
          items: [
            createApiTopic({ id: 'topic-a', name: 'Known alpha', assistantId: 'assistant-1', orderKey: 'a' }),
            createApiTopic({ id: 'topic-c', name: 'Default topic', assistantId: undefined, orderKey: 'c' })
          ]
        }
      ],
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      hasNext: false,
      loadNext: vi.fn(),
      refresh: vi.fn(),
      reset: vi.fn(),
      mutate: vi.fn()
    })

    renderTopicList()

    dndMocks.onDragEnd?.({
      active: { data: sortableData('item:topic-a'), id: 'item:topic-a' },
      over: { data: sortableData('item:topic-c'), id: 'item:topic-c' }
    })

    expect(patchSpy).not.toHaveBeenCalled()
  })

  it('allows unlinked assistant topics to move into known assistant groups', async () => {
    const patchSpy = vi.spyOn(dataApiService, 'patch').mockResolvedValue(undefined as never)
    MockUsePreferenceUtils.setPreferenceValue('topic.tab.display_mode' as never, 'assistant')
    mockUseInfiniteQuery.mockReturnValue({
      pages: [
        {
          items: [
            createApiTopic({ id: 'topic-a', name: 'Known alpha', assistantId: 'assistant-1', orderKey: 'a' }),
            createApiTopic({
              id: 'topic-e',
              name: 'Unknown topic',
              assistantId: 'missing-assistant',
              orderKey: 'e'
            })
          ]
        }
      ],
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      hasNext: false,
      loadNext: vi.fn(),
      refresh: vi.fn(),
      reset: vi.fn(),
      mutate: vi.fn()
    })

    renderTopicList()

    dndMocks.onDragEnd?.({
      active: { data: sortableData('item:topic-e'), id: 'item:topic-e' },
      over: { data: sortableData('item:topic-a'), id: 'item:topic-a' }
    })

    await vi.waitFor(() =>
      expect(patchSpy).toHaveBeenNthCalledWith(1, '/topics/topic-e', { body: { assistantId: 'assistant-1' } })
    )
    expect(patchSpy).toHaveBeenNthCalledWith(2, '/topics/topic-e/order', { body: { after: 'topic-a' } })
  })

  it('does not drop topics into pinned or unlinked assistant groups', () => {
    const patchSpy = vi.spyOn(dataApiService, 'patch').mockResolvedValue(undefined as never)
    MockUsePreferenceUtils.setPreferenceValue('topic.tab.display_mode' as never, 'assistant')
    mockUseInfiniteQuery.mockReturnValue({
      pages: [
        {
          items: [
            createApiTopic({ id: 'topic-a', name: 'Known alpha', assistantId: 'assistant-1', orderKey: 'a' }),
            createApiTopic({ id: 'topic-b', name: 'Pinned topic', assistantId: 'assistant-1', orderKey: 'b' }),
            createApiTopic({
              id: 'topic-e',
              name: 'Unknown topic',
              assistantId: 'missing-assistant',
              orderKey: 'e'
            })
          ]
        }
      ],
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      hasNext: false,
      loadNext: vi.fn(),
      refresh: vi.fn(),
      reset: vi.fn(),
      mutate: vi.fn()
    })

    renderTopicList()

    dndMocks.onDragEnd?.({
      active: { data: sortableData('item:topic-a'), id: 'item:topic-a' },
      over: { data: sortableData('item:topic-b'), id: 'item:topic-b' }
    })
    dndMocks.onDragEnd?.({
      active: { data: sortableData('item:topic-a'), id: 'item:topic-a' },
      over: { data: sortableData('item:topic-e'), id: 'item:topic-e' }
    })

    expect(patchSpy).not.toHaveBeenCalled()
  })
})
