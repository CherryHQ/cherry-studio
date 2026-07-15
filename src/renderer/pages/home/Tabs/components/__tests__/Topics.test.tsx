import type * as UseCacheModule from '@renderer/data/hooks/useCache'
import type * as TopicMenuActionsHook from '@renderer/hooks/chat/useTopicMenuActions'
import type { AssistantTopicsSource } from '@renderer/hooks/resourceViewSources'
import type * as ImageCaptureTargetsHook from '@renderer/hooks/useImageCaptureTargets'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { popup } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import type { ComponentProps, ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

const virtualMocks = vi.hoisted(() => ({
  // Cap the rendered virtual window so tests can assert virtualization behaviour (e.g. only
  // visible rows subscribe). `undefined` renders every row, matching a tall viewport.
  maxVisibleItems: undefined as number | undefined,
  useVirtualizer: vi.fn((options: { count: number; estimateSize: (index: number) => number }) => ({
    getVirtualItems: () =>
      Array.from({ length: Math.min(options.count, virtualMocks.maxVisibleItems ?? options.count) }, (_, index) => ({
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

const cursorGroupWindowMocks = vi.hoisted(() => ({
  options: undefined as
    | undefined
    | {
        continuityKey: string
        fetchPage: (groupId: string, cursor?: string) => Promise<{ items: unknown[] }>
        groupIds: readonly string[]
        queryKey: string
      }
}))

vi.mock('@renderer/hooks/useCursorGroupWindows', () => ({
  useCursorGroupWindows: (options: NonNullable<typeof cursorGroupWindowMocks.options>) => {
    cursorGroupWindowMocks.options = options
    return {
      items: [],
      loadGroup: vi.fn().mockResolvedValue(null),
      loadMoreGroup: vi.fn().mockResolvedValue(undefined),
      reset: vi.fn(),
      windows: {}
    }
  }
}))

const notesSettingsMocks = vi.hoisted(() => ({
  useNotesSettings: vi.fn(() => ({ notesPath: '/notes' }))
}))

vi.mock('@renderer/hooks/useNotesSettings', () => notesSettingsMocks)

const imageCaptureTargetsMock = vi.hoisted(() => ({
  targets: undefined as Array<{ requestId: number; target: unknown }> | undefined
}))

vi.mock('@renderer/hooks/useImageCaptureTargets', async () => {
  const actual = await vi.importActual<typeof ImageCaptureTargetsHook>('@renderer/hooks/useImageCaptureTargets')

  return {
    ...actual,
    useImageCaptureTargets: (options: Parameters<typeof actual.useImageCaptureTargets>[0]) => {
      const actualResult = actual.useImageCaptureTargets(options)

      return imageCaptureTargetsMock.targets
        ? { ...actualResult, targets: imageCaptureTargetsMock.targets as typeof actualResult.targets }
        : actualResult
    }
  }
})

const tabsContextMocks = vi.hoisted(() => ({
  closeConversationTabs: vi.fn(),
  openTab: vi.fn(),
  setActiveTab: vi.fn(),
  tabs: [] as Array<{ id: string; type: string; url: string }>
}))
const windowFrameMocks = vi.hoisted(() => ({ mode: 'embedded' as 'embedded' | 'window' }))
const resourceEditDialogMocks = vi.hoisted(() => ({ renderHost: vi.fn() }))

vi.mock('@renderer/hooks/tab', () => ({
  useCloseConversationTabs: () => tabsContextMocks.closeConversationTabs,
  useOptionalTabsContext: () => tabsContextMocks
}))

vi.mock('@renderer/hooks/useWindowFrame', () => ({
  useWindowFrame: () => ({ mode: windowFrameMocks.mode })
}))

vi.mock('@renderer/components/resourceCatalog/dialogs/edit', () => ({
  ResourceEditDialogHost: ({ target }: { target: { kind: string; id: string } | null }) => {
    resourceEditDialogMocks.renderHost(target)
    return target ? <div data-testid="resource-edit-dialog-host" data-kind={target.kind} data-id={target.id} /> : null
  }
}))

vi.mock('@renderer/pages/home/messages/TopicImageCaptureHost', () => ({
  __esModule: true,
  default: ({ topic }: { topic: { id: string } }) => (
    <div data-testid="topic-image-capture-host" data-topic-id={topic.id} />
  )
}))

vi.mock('@renderer/components/Avatar/ModelAvatar', () => ({
  default: ({ model, size }: { model: { id: string; providerId: string }; size: number }) => (
    <span data-model-id={model.id} data-provider-id={model.providerId} data-size={size} data-testid="model-avatar" />
  )
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

const assistantMutationMocks = vi.hoisted(() => ({
  deleteAssistant: vi.fn()
}))

const topicStreamStatusMocks = vi.hoisted(() => ({
  markSeen: vi.fn(),
  statuses: new Map<string, { isFulfilled?: boolean; isPending?: boolean }>()
}))

const topicRowRenderMocks = vi.hoisted(() => ({
  counts: new Map<string, number>()
}))

vi.mock('@renderer/hooks/chat/useTopicMenuActions', async () => {
  const actual = await vi.importActual<typeof TopicMenuActionsHook>('@renderer/hooks/chat/useTopicMenuActions')

  return {
    ...actual,
    useTopicMenuActions: (...args: Parameters<typeof actual.useTopicMenuActions>) => {
      const topicId = args[0].topic.id
      topicRowRenderMocks.counts.set(topicId, (topicRowRenderMocks.counts.get(topicId) ?? 0) + 1)
      return actual.useTopicMenuActions(...args)
    }
  }
})

const cacheHookMocks = vi.hoisted(() => ({
  setCache: vi.fn(),
  setters: new Map<string, (value: unknown) => void>(),
  values: new Map<string, unknown>()
}))

vi.mock('@data/hooks/useCache', async (importOriginal) => ({
  // Real hook over the globally mocked cacheService: the stream-status tests
  // seed that store via setShared and spy on its subscribe.
  useSharedCacheSelector: (await importOriginal<typeof UseCacheModule>()).useSharedCacheSelector,
  useCache: (key: string) => {
    if (!cacheHookMocks.setters.has(key)) {
      cacheHookMocks.setters.set(key, (value: unknown) => {
        cacheHookMocks.values.set(key, value)
        cacheHookMocks.setCache(key, value)
      })
    }
    return [cacheHookMocks.values.get(key) ?? [], cacheHookMocks.setters.get(key)]
  },
  usePersistCache: (key: string) => {
    if (!cacheHookMocks.setters.has(key)) {
      cacheHookMocks.setters.set(key, (value: unknown) => {
        cacheHookMocks.values.set(key, value)
        cacheHookMocks.setCache(key, value)
      })
    }
    return [cacheHookMocks.values.get(key), cacheHookMocks.setters.get(key)]
  }
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

vi.mock('@renderer/utils/aiGeneration', () => ({
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

// The confirm-and-run dialog itself is covered by its own unit test; here we just let it run
// the gated action (as if the user confirmed).
const { confirmActionShow } = vi.hoisted(() => ({
  confirmActionShow: vi.fn(async (options?: { action?: () => unknown }) => {
    await options?.action?.()
    return true
  })
}))
vi.mock('@renderer/components/popups/ConfirmActionPopup', () => ({ default: { show: confirmActionShow } }))

vi.mock('@renderer/components/ObsidianExportPopup', () => ({
  default: { show: vi.fn() }
}))

vi.mock('@renderer/components/popups/PromptPopup', () => ({
  default: { show: vi.fn() }
}))

vi.mock('@renderer/components/SaveToKnowledgePopup', () => ({
  default: { showForTopic: vi.fn() }
}))

vi.mock('@renderer/services/ExportService', () => ({
  exportMarkdownToJoplin: vi.fn(),
  exportMarkdownToSiyuan: vi.fn(),
  exportMarkdownToYuque: vi.fn(),
  exportTopicAsMarkdown: vi.fn(),
  exportTopicToNotes: vi.fn(),
  exportTopicToNotion: vi.fn(),
  topicToMarkdown: vi.fn().mockResolvedValue('# topic')
}))

vi.mock('@renderer/services/copy', () => ({
  copyTopicAsMarkdown: vi.fn(),
  copyTopicAsPlainText: vi.fn()
}))

vi.mock('react-i18next', () => ({
  initReactI18next: {
    init: vi.fn(),
    type: '3rdParty'
  },
  useTranslation: (() => {
    const value = {
      t: (key: string, options?: Record<string, unknown>) => {
        if (key === 'selector.common.pinned_title') return 'Pinned'
        if (key === 'chat.topics.title') return 'Conversations'
        if (key === 'chat.topics.list') return 'Conversation List'
        if (key === 'chat.topics.display.title') return 'Display mode'
        if (key === 'chat.topics.display.time') return 'Time'
        if (key === 'chat.topics.display.assistant') return 'Assistant'
        if (key === 'common.list_options') return 'List options'
        if (key === 'common.sort.title') return 'Sort order'
        if (key === 'common.sort.created_at') return 'Creation time'
        if (key === 'common.sort.manual_order') return 'Manual order'
        if (key === 'common.sort.updated_at') return 'Updated time'
        if (key === 'chat.topics.group.today') return 'Today'
        if (key === 'chat.topics.group.yesterday') return 'Yesterday'
        if (key === 'chat.topics.group.this_week') return 'This week'
        if (key === 'chat.topics.group.earlier') return 'Earlier'
        if (key === 'chat.topics.group.unknown_assistant') return 'Unlinked Assistant'
        if (key === 'chat.topics.group.show_more') return 'Show more conversations'
        if (key === 'chat.topics.group.collapse') return 'Collapse conversations'
        if (key === 'chat.topics.group.collapse_all') return 'Collapse all'
        if (key === 'chat.topics.group.expand_all') return 'Expand all'
        if (key === 'chat.topics.move_to') return 'Move to'
        if (key === 'chat.topics.search.placeholder') return 'Search conversations'
        if (key === 'chat.topics.search.title') return 'Search conversations'
        if (key === 'history.records.shortTitle') return 'History'
        if (key === 'chat.topics.pin') return 'Pin Conversation'
        if (key === 'chat.topics.unpin') return 'Unpin Conversation'
        if (key === 'chat.topics.auto_rename') return 'Generate conversation name'
        if (key === 'chat.topics.edit.title') return 'Edit conversation name'
        if (key === 'settings.topic.position.label') return 'Conversation position'
        if (key === 'settings.topic.position.left') return 'Left'
        if (key === 'settings.topic.position.right') return 'Right'
        if (key === 'chat.topics.empty.description')
          return 'Create a chat and it will stay here so you can continue with its context later.'
        if (key === 'chat.topics.empty.title') return 'No conversations'
        if (key === 'assistants.edit.title') return 'Edit Assistant'
        if (key === 'assistants.pin.title') return 'Pin Assistant'
        if (key === 'assistants.unpin.title') return 'Unpin Assistant'
        if (key === 'assistants.clear.menu_title') return 'Delete all assistant conversations'
        if (key === 'assistants.delete.title') return 'Delete Assistant'
        if (key === 'assistants.delete.content') return 'Delete this assistant and its conversations?'
        if (key === 'assistants.icon.type') return 'Assistant icon'
        if (key === 'chat.add.assistant.title') return 'Add Assistant'
        if (key === 'assistants.tags.group_by') return 'Group by tag'
        if (key === 'assistants.tags.ungroup') return 'Ungroup tags'
        if (key === 'assistants.tags.untagged') return 'Untagged'
        if (key === 'settings.assistant.icon.type.emoji') return 'Emoji'
        if (key === 'settings.assistant.icon.type.model') return 'Model'
        if (key === 'settings.assistant.icon.type.none') return 'None'
        if (key === 'assistants.presets.manage.title') return 'Manage Assistants'
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
        if (key === 'common.delete_success') return 'Deleted'
        if (key === 'common.delete_failed') return 'Delete failed'
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
        if (key === 'chat.topics.manage.move.success') return `Moved ${options?.count ?? 0} conversation(s)`
        if (key === 'chat.add.topic.title') return 'New Conversation'
        if (key === 'chat.default.name') return 'Default Assistant'
        if (key === 'common.prompt') return 'Prompt'
        if (key === 'assistants.reorder.error.failed') return 'Failed to reorder assistants'
        if (key === 'chat.topics.delete.shortcut') return `Hold ${options?.key ?? 'Ctrl'} to delete directly`
        return key
      }
    }
    return () => value
  })()
}))

import { cacheService } from '@data/CacheService'
import { dataApiService } from '@data/DataApiService'
import type { ResourceListRevealRequest } from '@renderer/components/chat/resourceList/base'
import type * as TopicDataApiModule from '@renderer/hooks/useTopic'
import type { Topic } from '@renderer/types/topic'
import {
  applyOptimisticTopicDisplayMove,
  TOPIC_ASSISTANT_SECTION_ID,
  TOPIC_PINNED_SECTION_ID,
  TOPIC_UNLINKED_ASSISTANT_GROUP_ID
} from '@renderer/utils/chat/topicsHelpers'
import type { Pin } from '@shared/data/types/pin'
import type { Topic as ApiTopic } from '@shared/data/types/topic'
import { mockUseInfiniteQuery, mockUseMutation, mockUseQuery } from '@test-mocks/renderer/useDataApi'
import { MockUsePreference, MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'

import {
  clearPendingTopicImageActionsForTest,
  consumePendingTopicImageActions,
  requestTopicImageAction,
  settleTopicImageActionRequest
} from '../../../messages/topicImageActionBus'
import { Topics } from '../Topics'

const TOPIC_EXPANSION_ASSISTANT_KEY = 'ui.topic.expansion.assistant'

type TopicGroupCollapseFixture = {
  assistant: string[] | null
}

// Default fixture: nothing collapsed (everything expanded).
function createExpandedTopicGroupExpansionFixture(): TopicGroupCollapseFixture {
  return {
    assistant: []
  }
}

function setTopicGroupExpansionCache(value: TopicGroupCollapseFixture) {
  cacheHookMocks.values.set(TOPIC_EXPANSION_ASSISTANT_KEY, value.assistant)
}

function getTopicGroupExpansionCache() {
  return {
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

function createDefaultTopicFixture(): ApiTopic[] {
  return [
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
    tags: [{ id: 'tag-work', name: 'Work' }],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

type OnNewTopicMock = Mock<(payload?: { assistantId?: string | null }) => void>

function createAssistantTopicsSource(topics?: readonly ApiTopic[]): AssistantTopicsSource {
  const source =
    topics !== undefined
      ? {
          pages: [{ items: topics }],
          isLoading: false,
          isRefreshing: false,
          error: undefined,
          hasNext: false,
          loadNext: vi.fn(),
          refresh: vi.fn(),
          reset: vi.fn(),
          mutate: vi.fn()
        }
      : mockUseInfiniteQuery('/topics', { limit: 200 })
  const items = source.pages.flatMap((page) => page.items)
  const byAssistant = Array.from(new Set(items.map((topic) => topic.assistantId ?? null))).map((assistantId) => ({
    assistantId,
    count: items.filter((topic) => (topic.assistantId ?? null) === assistantId).length,
    pinnedCount: 0
  }))

  return {
    error: source.error,
    hasNext: source.hasNext,
    isLoading: source.isLoading,
    isRefreshing: source.isRefreshing,
    loadNext: source.loadNext,
    loadLatestTopic: vi.fn().mockResolvedValue(null),
    loadTopicReuseCandidates: vi.fn().mockResolvedValue([]),
    mutate: source.mutate,
    pages: source.pages,
    refetch: source.refresh,
    topics: items,
    stats: { total: items.length, pinnedCount: 0, byAssistant }
  } as unknown as AssistantTopicsSource
}

function renderTopicList({
  activeTopic = createRendererTopic(),
  assistantTopicsSource,
  assistantIdFilter,
  onActiveAssistantDeleted,
  onAddAssistant = vi.fn(),
  onClearActiveTopic = vi.fn(),
  historyRecordsActive,
  onNewTopic = vi.fn(),
  onOpenHistoryRecords = vi.fn(),
  onSetPanePosition,
  panePosition,
  presentation,
  revealRequest,
  resourceMenuItems
}: {
  activeTopic?: Topic
  assistantTopicsSource?: AssistantTopicsSource
  assistantIdFilter?: string | null
  onActiveAssistantDeleted?: ComponentProps<typeof Topics>['onActiveAssistantDeleted']
  onAddAssistant?: ComponentProps<typeof Topics>['onAddAssistant']
  onClearActiveTopic?: ComponentProps<typeof Topics>['onClearActiveTopic']
  historyRecordsActive?: ComponentProps<typeof Topics>['historyRecordsActive']
  onNewTopic?: OnNewTopicMock
  onOpenHistoryRecords?: Mock<() => void>
  onSetPanePosition?: ComponentProps<typeof Topics>['onSetPanePosition']
  panePosition?: ComponentProps<typeof Topics>['panePosition']
  presentation?: 'sidebar' | 'right-panel'
  revealRequest?: ResourceListRevealRequest
  resourceMenuItems?: ComponentProps<typeof Topics>['resourceMenuItems']
} = {}) {
  const setActiveTopic = vi.fn()
  const renderNode = (nextRevealRequest = revealRequest, nextActiveTopic = activeTopic) => (
    <Topics
      activeTopic={nextActiveTopic}
      assistantTopicsSource={assistantTopicsSource ?? createAssistantTopicsSource()}
      assistantIdFilter={assistantIdFilter}
      historyRecordsActive={historyRecordsActive}
      onActiveAssistantDeleted={onActiveAssistantDeleted}
      onAddAssistant={onAddAssistant}
      setActiveTopic={setActiveTopic}
      onClearActiveTopic={onClearActiveTopic}
      onNewTopic={onNewTopic}
      onOpenHistoryRecords={onOpenHistoryRecords}
      onSetPanePosition={onSetPanePosition}
      panePosition={panePosition}
      presentation={presentation}
      revealRequest={nextRevealRequest}
      resourceMenuItems={resourceMenuItems}
    />
  )
  const view = render(renderNode())
  return {
    ...view,
    onAddAssistant,
    onClearActiveTopic,
    onNewTopic,
    onOpenHistoryRecords,
    rerenderTopicList: (nextRevealRequest = revealRequest, nextActiveTopic = activeTopic) =>
      view.rerender(renderNode(nextRevealRequest, nextActiveTopic)),
    setActiveTopic
  }
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

// The options menu renders through the mocked DropdownMenu (tests/renderer.setup.ts),
// whose content is always mounted as plain buttons under the trigger's wrapper. Clicking
// the trigger flips the open state; the wrapper is the scope that holds the menu items.
function openTopicListOptions() {
  const trigger = screen.getByLabelText('List options')
  fireEvent.click(trigger)
  return trigger.closest('div') as HTMLElement
}

// Derive `/topics/stats` from a fixture so the assistant group headers, pinned band, and
// grouped cursor windows have the aggregate facts the component reads. Wraps the current
// `mockUseQuery` implementation so `/pins` and `/assistants` handling is preserved.
function applyTopicStats(topics: readonly ApiTopic[], pinnedIds: readonly string[] = []) {
  const pinnedIdSet = new Set(pinnedIds)
  const inScope = (topic: ApiTopic, ownerScope?: string) => {
    if (!ownerScope) return true
    if (ownerScope === 'unlinked') return topic.assistantId == null
    return topic.assistantId === ownerScope
  }
  const previousQuery = mockUseQuery.getMockImplementation()
  mockUseQuery.mockImplementation((path, options) => {
    if (path === '/topics/stats') {
      const ownerScope = (options as { query?: { assistantId?: string } } | undefined)?.query?.assistantId
      const scoped = topics.filter((topic) => inScope(topic, ownerScope))
      const byAssistant = new Map<string | null, { count: number; pinnedCount: number }>()
      for (const topic of scoped) {
        const key = topic.assistantId ?? null
        const entry = byAssistant.get(key) ?? { count: 0, pinnedCount: 0 }
        entry.count += 1
        if (pinnedIdSet.has(topic.id)) entry.pinnedCount += 1
        byAssistant.set(key, entry)
      }
      return {
        data: {
          total: scoped.length,
          pinnedCount: scoped.filter((topic) => pinnedIdSet.has(topic.id)).length,
          byAssistant: [...byAssistant.entries()].map(([assistantId, entry]) => ({
            assistantId,
            count: entry.count,
            pinnedCount: entry.pinnedCount
          }))
        },
        isLoading: false,
        isRefreshing: false,
        error: undefined,
        refetch: vi.fn().mockResolvedValue(undefined),
        mutate: vi.fn().mockResolvedValue(undefined)
      } as never
    }
    return (
      previousQuery?.(path, options) ?? {
        data: undefined,
        isLoading: false,
        isRefreshing: false,
        error: undefined,
        refetch: vi.fn().mockResolvedValue(undefined),
        mutate: vi.fn().mockResolvedValue(undefined)
      }
    )
  })
}

/** A paged topic list item as the component sees it: the entity plus the pin projection. */
type PagedTopic = ApiTopic & { pinned?: boolean; pinId?: string | null }

// Mark the given topics as pinned (carrying a pinId) on a fixture list, mirroring the
// `pinned: true` stream the component reads pinned state and pin ids from.
function withPinnedTopics(topics: readonly PagedTopic[], pinnedIds: readonly string[]): PagedTopic[] {
  const pinnedIdSet = new Set(pinnedIds)
  return topics.map((topic) =>
    pinnedIdSet.has(topic.id) ? ({ ...topic, pinned: true, pinId: `pin-${topic.id}` } as PagedTopic) : topic
  )
}

function setTopicInfiniteQueryPages(topics: readonly PagedTopic[]) {
  mockUseInfiniteQuery.mockReturnValue({
    pages: [{ items: [...topics] }],
    isLoading: false,
    isRefreshing: false,
    error: undefined,
    hasNext: false,
    loadNext: vi.fn(),
    refresh: vi.fn(),
    reset: vi.fn(),
    mutate: vi.fn()
  })
}

// Server-side filtering the flat streams perform: `pinned` picks the pin-owned vs ordinary
// stream, and `assistantId` (`uuid | 'unlinked'`) scopes the right panel to one owner.
function setScopedTopicInfiniteQuery(topics: readonly PagedTopic[]) {
  mockUseInfiniteQuery.mockImplementation((_path, options) => {
    const query = (options as { query?: { pinned?: boolean; assistantId?: string } } | undefined)?.query ?? {}
    const items = topics.filter((topic) => {
      if (query.pinned === true && !topic.pinned) return false
      if (query.pinned === false && topic.pinned) return false
      if (query.assistantId === 'unlinked') return topic.assistantId == null
      if (query.assistantId) return topic.assistantId === query.assistantId
      return true
    })
    return {
      pages: [{ items }],
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      hasNext: false,
      loadNext: vi.fn(),
      refresh: vi.fn(),
      reset: vi.fn(),
      mutate: vi.fn()
    }
  })
}

describe('Topics', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    virtualMocks.maxVisibleItems = undefined
    clearPendingTopicImageActionsForTest()
    topicStreamStatusMocks.statuses.clear()
    topicRowRenderMocks.counts.clear()
    clearTopicStreamCache('topic-a', 'topic-b', 'topic-c', 'topic-d', 'topic-e')
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date(2026, 0, 3, 12))
    MockUsePreferenceUtils.resetMocks()
    cacheHookMocks.values.clear()
    imageCaptureTargetsMock.targets = undefined
    setTopicGroupExpansionCache(createExpandedTopicGroupExpansionFixture())
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'assistant.icon_type': 'emoji',
      'assistant.tab.sort_type': 'list',
      'topic.sort_type': 'createdAt',
      'topic.tab.display_mode': 'assistant',
      'topic.tab.position': 'left',
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
    assistantMutationMocks.deleteAssistant.mockResolvedValue({ deleted: true, deletedTopicIds: [] })
    topicDataMocks.deleteTopicsByAssistantId.mockResolvedValue({ deletedIds: [], deletedCount: 0 })
    tabsContextMocks.openTab.mockClear()
    tabsContextMocks.setActiveTab.mockClear()
    tabsContextMocks.tabs = []
    windowFrameMocks.mode = 'embedded'
    mockUseMutation.mockImplementation((method, path) => {
      if (method === 'POST' && path === '/pins') {
        return { trigger: pinMutationMocks.createPin, isLoading: false, error: undefined }
      }
      if (method === 'DELETE' && path === '/pins/:id') {
        return { trigger: pinMutationMocks.deletePin, isLoading: false, error: undefined }
      }
      if (method === 'DELETE' && path === '/assistants/:id') {
        return { trigger: assistantMutationMocks.deleteAssistant, isLoading: false, error: undefined }
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
                orderKey: 'b',
                tags: [{ id: 'tag-home', name: 'Home' }]
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
    setTopicInfiniteQueryPages(createDefaultTopicFixture())
    dndMocks.onDragEnd = undefined
    dndMocks.onDragOver = undefined
    dndMocks.droppableData.clear()
    dndMocks.sortableData.clear()
    cursorGroupWindowMocks.options = undefined
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders pinned and creation-ordered rows without date buckets and protects pinned rows from inline delete', () => {
    MockUsePreferenceUtils.setPreferenceValue('topic.tab.display_mode' as never, 'time')
    const fixture = withPinnedTopics(createDefaultTopicFixture(), ['topic-b'])
    setTopicInfiniteQueryPages(fixture)
    applyTopicStats(fixture, ['topic-b'])
    const { getByText, setActiveTopic } = renderTopicList()

    expect(screen.getByText('Pinned')).toBeInTheDocument()
    expect(screen.queryByText('Today')).not.toBeInTheDocument()
    expect(screen.queryByText('Yesterday')).not.toBeInTheDocument()
    expect(screen.queryByText('This week')).not.toBeInTheDocument()
    expect(screen.queryByText('Earlier')).not.toBeInTheDocument()
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

  it('requests separate pin-order and immutable creation-order streams in time mode', () => {
    MockUsePreferenceUtils.setPreferenceValue('topic.tab.display_mode' as never, 'time')

    renderTopicList()

    expect(mockUseInfiniteQuery).toHaveBeenCalledWith(
      '/topics',
      expect.objectContaining({ query: { pinned: true }, limit: 50, enabled: true })
    )
    expect(mockUseInfiniteQuery).toHaveBeenCalledWith(
      '/topics',
      expect.objectContaining({ query: { pinned: false, sortBy: 'createdAt' }, limit: 50, enabled: true })
    )
  })

  it('keeps the pin-order stream independent when the topic sort changes', () => {
    MockUsePreferenceUtils.setPreferenceValue('topic.tab.display_mode' as never, 'time')
    MockUsePreferenceUtils.setPreferenceValue('topic.sort_type' as never, 'updatedAt')

    renderTopicList()

    expect(mockUseInfiniteQuery).toHaveBeenCalledWith(
      '/topics',
      expect.objectContaining({ query: { pinned: true }, limit: 50, enabled: true })
    )
    expect(mockUseInfiniteQuery).toHaveBeenCalledWith(
      '/topics',
      expect.objectContaining({ query: { pinned: false, sortBy: 'updatedAt' }, limit: 50, enabled: true })
    )
  })

  it('includes topic sorting in grouped cursor requests and cache identity', async () => {
    MockUsePreferenceUtils.setPreferenceValue('topic.sort_type' as never, 'updatedAt')
    applyTopicStats(createDefaultTopicFixture())
    const getSpy = vi.spyOn(dataApiService, 'get').mockResolvedValue({ items: [] } as never)

    try {
      renderTopicList()

      expect(JSON.parse(cursorGroupWindowMocks.options?.queryKey ?? '{}')).toEqual(
        expect.objectContaining({ sortBy: 'updatedAt' })
      )
      expect(JSON.parse(cursorGroupWindowMocks.options?.continuityKey ?? '{}')).toEqual({
        mode: 'assistant',
        q: ''
      })
      expect(cursorGroupWindowMocks.options?.groupIds).toContain('topic:assistant:assistant-1')
      await cursorGroupWindowMocks.options?.fetchPage('topic:assistant:assistant-1')
      expect(getSpy).toHaveBeenCalledWith(
        '/topics',
        expect.objectContaining({
          query: expect.objectContaining({ assistantId: 'assistant-1', pinned: false, sortBy: 'updatedAt' })
        })
      )
    } finally {
      getSpy.mockRestore()
    }
  })

  it('keeps a creation-stream retry available before any rows have loaded', async () => {
    MockUsePreferenceUtils.setPreferenceValue('topic.tab.display_mode' as never, 'time')
    const retryCreatedTopics = vi.fn().mockResolvedValue(undefined)
    mockUseInfiniteQuery.mockImplementation((_path, options) => {
      const pinned = (options as { query?: { pinned?: boolean } }).query?.pinned
      return {
        pages: [{ items: [] }],
        isLoading: false,
        isRefreshing: false,
        error: pinned === false ? new Error('creation stream failed') : undefined,
        hasNext: false,
        loadNext: vi.fn(),
        refresh: pinned === false ? retryCreatedTopics : vi.fn(),
        reset: vi.fn(),
        mutate: vi.fn()
      }
    })

    renderTopicList({ assistantTopicsSource: createAssistantTopicsSource([]) })

    const retryButton = screen.getByRole('button', { name: 'Show more conversations' })
    expect(retryButton).toHaveAttribute('data-error', 'true')

    fireEvent.click(retryButton)
    await vi.waitFor(() => expect(retryCreatedTopics).toHaveBeenCalledTimes(1))
  })

  it('retries the pinned stream before any rows have loaded instead of requesting a nonexistent next page', async () => {
    MockUsePreferenceUtils.setPreferenceValue('topic.tab.display_mode' as never, 'time')
    const retryPinnedTopics = vi.fn().mockResolvedValue(undefined)
    mockUseInfiniteQuery.mockImplementation((_path, options) => {
      const pinned = (options as { query?: { pinned?: boolean } }).query?.pinned
      return {
        pages: [{ items: [] }],
        isLoading: false,
        isRefreshing: false,
        error: pinned === true ? new Error('pinned stream failed') : undefined,
        hasNext: false,
        loadNext: vi.fn(),
        refresh: pinned === true ? retryPinnedTopics : vi.fn(),
        reset: vi.fn(),
        mutate: vi.fn()
      }
    })

    renderTopicList({ assistantTopicsSource: createAssistantTopicsSource([]) })

    const retryButton = screen.getByRole('button', { name: 'Show more conversations' })
    expect(retryButton).toHaveAttribute('data-error', 'true')

    fireEvent.click(retryButton)
    await vi.waitFor(() => expect(retryPinnedTopics).toHaveBeenCalledTimes(1))
  })

  it('shows a new conversation placeholder for empty topic names', () => {
    MockUsePreferenceUtils.setPreferenceValue('topic.tab.display_mode' as never, 'time')
    mockUseInfiniteQuery.mockReturnValue({
      pages: [
        {
          items: [
            createApiTopic({
              id: 'topic-empty',
              name: '',
              assistantId: 'assistant-1',
              orderKey: 'a',
              createdAt: '2026-01-03T01:00:00.000Z',
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
    const { setActiveTopic } = renderTopicList()

    fireEvent.click(screen.getByTitle('chat.conversation.new'))

    expect(setActiveTopic).toHaveBeenCalledWith(expect.objectContaining({ id: 'topic-empty', name: '' }))
  })

  it('clears the active selection without creating when deleting the last remaining topic', async () => {
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

    const { onClearActiveTopic, onNewTopic } = renderTopicList({
      activeTopic: createRendererTopic({ id: 'topic-a', assistantId: 'assistant-1', name: 'Alpha topic' })
    })

    const topicRow = getTopicRow('Alpha topic')
    const deleteButton = within(topicRow).getByLabelText('Delete')
    act(() => {
      fireEvent.click(deleteButton)
    })
    act(() => {
      fireEvent.click(deleteButton)
    })

    await vi.waitFor(() => expect(topicDataMocks.deleteTopic).toHaveBeenCalledWith('topic-a'))
    await vi.waitFor(() => expect(onClearActiveTopic).toHaveBeenCalledTimes(1))
    expect(onNewTopic).not.toHaveBeenCalled()
  })

  it('requests bounded topic windows without auto-paginating to the end', () => {
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

    expect(mockUseInfiniteQuery).toHaveBeenCalledWith('/topics', expect.objectContaining({ limit: 50 }))
    expect(loadNext).not.toHaveBeenCalled()
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

    const emptyStateText = screen.getByText('No conversations')

    expect(emptyStateText).toHaveClass(
      'h-full',
      'w-full',
      'max-w-sm',
      'px-5',
      'py-10',
      'text-center',
      'text-xs',
      'text-muted-foreground',
      'break-words'
    )
    expect(screen.queryByRole('heading', { name: 'No conversations' })).not.toBeInTheDocument()
    expect(emptyStateText.querySelector('svg')).not.toBeInTheDocument()
    expect(
      screen.queryByText('Create a chat and it will stay here so you can continue with its context later.')
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add Assistant' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'chat.conversation.new' })).not.toBeInTheDocument()
    expect(onNewTopic).not.toHaveBeenCalled()
  })

  it('uses the top header action to add an assistant in assistant display mode', () => {
    const onAddAssistant = vi.fn()
    const { onNewTopic } = renderTopicList({ onAddAssistant })

    fireEvent.click(screen.getByRole('button', { name: 'Add Assistant' }))

    expect(onAddAssistant).toHaveBeenCalledTimes(1)
    expect(onNewTopic).not.toHaveBeenCalled()
  })

  it('hides the add assistant header action when topics are on the right', () => {
    renderTopicList({ panePosition: 'right' })

    expect(screen.queryByRole('button', { name: 'Add Assistant' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('List options')).toBeInTheDocument()
  })

  it('uses only the redesigned search control in right panel mode', () => {
    renderTopicList({ assistantIdFilter: 'assistant-1', presentation: 'right-panel' })

    expect(screen.queryByRole('button', { name: 'chat.conversation.new' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('List options')).not.toBeInTheDocument()

    // Behavior: the right panel exposes the search control and drops the sidebar's new/display-mode
    // affordances. (Styling specifics intentionally not pinned here.)
    expect(screen.getByRole('textbox', { name: 'Search conversations' })).toBeInTheDocument()
  })

  it('shows default assistant topics in right panel mode', () => {
    setScopedTopicInfiniteQuery([
      createApiTopic({
        id: 'topic-default',
        name: 'Default topic',
        assistantId: undefined,
        orderKey: 'a'
      }),
      createApiTopic({
        id: 'topic-alpha',
        name: 'Alpha topic',
        assistantId: 'assistant-1',
        orderKey: 'b'
      })
    ])

    renderTopicList({
      activeTopic: createRendererTopic({ id: 'topic-default', name: 'Default topic', assistantId: undefined }),
      assistantIdFilter: null,
      presentation: 'right-panel'
    })

    expect(screen.getByText('Default topic')).toBeInTheDocument()
    expect(screen.queryByText('Alpha topic')).not.toBeInTheDocument()
  })

  it('keeps the right panel flat without date or collapse controls', () => {
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

    renderTopicList({ assistantIdFilter: 'assistant-1', presentation: 'right-panel' })

    expect(screen.queryByText('Today')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { expanded: true })).not.toBeInTheDocument()
    expect(screen.queryByText('Show more conversations')).not.toBeInTheDocument()
    expect(screen.queryByText('Collapse conversations')).not.toBeInTheDocument()
    expect(screen.getByText('Topic 1')).toBeInTheDocument()
    expect(screen.getByText('Topic 6')).toBeInTheDocument()
  })

  it('forces the flat time mode in the right panel even when assistant mode is stored', () => {
    // beforeEach stores topic.tab.display_mode: 'assistant'. The classic right panel is the parent
    // switch and must ignore the stored display mode, using the flat creation stream. Assistants are
    // still fetched as move targets, so the rendered list must prove that assistant grouping is off.
    renderTopicList({ assistantIdFilter: 'assistant-1', presentation: 'right-panel' })

    expect(screen.queryByText('Today')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Alpha Assistant' })).not.toBeInTheDocument()
    expect(screen.getByText('Alpha topic')).toBeInTheDocument()
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
    const fixture = withPinnedTopics(createDefaultTopicFixture(), ['topic-b'])
    setTopicInfiniteQueryPages(fixture)
    applyTopicStats(fixture, ['topic-b'])
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
    const fixture = withPinnedTopics(createDefaultTopicFixture(), ['topic-b'])
    setTopicInfiniteQueryPages(fixture)
    applyTopicStats(fixture, ['topic-b'])

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

  it('keeps pin actions in the topic context menu and changes topic position from the menu', async () => {
    const { getByText } = renderTopicList()

    fireEvent.contextMenu(getByText('Alpha topic'))
    const alphaMenu = getByText('Alpha topic').closest('[data-testid="context-menu"]')
    const menuContent = alphaMenu?.querySelector('[data-testid="context-menu-content"]')

    expect(menuContent ?? null).toBeInTheDocument()
    expect(menuContent).toHaveTextContent('Pin Conversation')
    expect(menuContent).not.toHaveTextContent('Unpin Conversation')
    expect(menuContent).toHaveTextContent('Conversation position')
    expect(menuContent).toHaveTextContent('Move to')

    fireEvent.click(within(menuContent as HTMLElement).getByText('Right'))

    await vi.waitFor(() => {
      expect(MockUsePreferenceUtils.getPreferenceValue('topic.tab.position' as never)).toBe('right')
    })
  })

  it('hides topic position actions when pane position is controlled without a setter', () => {
    const { getByText } = renderTopicList({ panePosition: 'left' })
    const panePositionHookIndex = MockUsePreference.usePreference.mock.calls.findIndex(
      ([key]) => key === 'topic.tab.position'
    )
    const setStoredPanePosition = MockUsePreference.usePreference.mock.results[panePositionHookIndex]?.value[1] as Mock

    fireEvent.contextMenu(getByText('Alpha topic'))
    const alphaMenu = getByText('Alpha topic').closest('[data-testid="context-menu"]')
    const menuContent = alphaMenu?.querySelector('[data-testid="context-menu-content"]')

    expect(menuContent ?? null).toBeInTheDocument()
    expect(menuContent).not.toHaveTextContent('Conversation position')
    expect(setStoredPanePosition).not.toHaveBeenCalled()
  })

  it('hides topic position actions from the time-mode topic context menu', () => {
    MockUsePreferenceUtils.setPreferenceValue('topic.tab.display_mode' as never, 'time')
    const { getByText } = renderTopicList()

    fireEvent.contextMenu(getByText('Alpha topic'))
    const alphaMenu = getByText('Alpha topic').closest('[data-testid="context-menu"]')
    const menuContent = alphaMenu?.querySelector('[data-testid="context-menu-content"]')

    expect(menuContent ?? null).toBeInTheDocument()
    expect(menuContent).not.toHaveTextContent('Conversation position')
    expect(menuContent).toHaveTextContent('Move to')
  })

  it('moves a topic to another assistant from the context menu', async () => {
    const activeTopic = createRendererTopic({ messages: [{ id: 'message-a' } as Topic['messages'][number]] })
    const { getByText, setActiveTopic } = renderTopicList({ activeTopic })

    fireEvent.contextMenu(getByText('Alpha topic'))
    const alphaMenu = getByText('Alpha topic').closest('[data-testid="context-menu"]')
    const menuContent = alphaMenu?.querySelector('[data-testid="context-menu-content"]')

    expect(menuContent ?? null).toBeInTheDocument()
    expect(
      within(menuContent as HTMLElement).queryByRole('button', { name: 'Alpha Assistant' })
    ).not.toBeInTheDocument()

    expect(within(menuContent as HTMLElement).getByRole('button', { name: 'Move to' })).toBeInTheDocument()
    fireEvent.click(within(menuContent as HTMLElement).getByRole('button', { name: /Beta Assistant/ }))

    await vi.waitFor(() =>
      expect(topicDataMocks.updateTopic).toHaveBeenCalledWith('topic-a', { assistantId: 'assistant-2' })
    )
    expect(setActiveTopic).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'topic-a', assistantId: 'assistant-2', messages: activeTopic.messages })
    )
    expect(toast.success).toHaveBeenCalledWith('Moved 1 conversation(s)')
  })

  it('orders move-to-assistant targets with pinned assistants first', () => {
    mockUseQuery.mockImplementation((path, options) => {
      if (path === '/pins') {
        const entityType = (options as { query?: { entityType?: string } } | undefined)?.query?.entityType
        return {
          data:
            entityType === 'assistant'
              ? [{ id: 'pin-assistant-3', entityId: 'assistant-3', entityType: 'assistant', orderKey: 'a' }]
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
              createAssistant({ id: 'assistant-2', name: 'Beta Assistant', emoji: '✍️', orderKey: 'b' }),
              createAssistant({ id: 'assistant-3', name: 'Gamma Assistant', emoji: '🚀', orderKey: 'c' })
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
    const { getByText } = renderTopicList()

    fireEvent.contextMenu(getByText('Alpha topic'))
    const alphaMenu = getByText('Alpha topic').closest('[data-testid="context-menu"]')
    const menuContent = alphaMenu?.querySelector('[data-testid="context-menu-content"]')
    const targetButtons = within(menuContent as HTMLElement)
      .getAllByRole('button')
      .map((button) => button.textContent)
      .filter((text): text is string => text?.includes('Assistant') ?? false)

    expect(targetButtons[0]).toContain('Gamma Assistant')
    expect(targetButtons[1]).toContain('Beta Assistant')
  })

  it('changes the right-panel topic list to the left side from the context menu', async () => {
    const onSetPanePosition = vi.fn()
    const { getByText } = renderTopicList({
      assistantIdFilter: 'assistant-1',
      onSetPanePosition,
      panePosition: 'right',
      presentation: 'right-panel'
    })

    fireEvent.contextMenu(getByText('Alpha topic'))
    const alphaMenu = getByText('Alpha topic').closest('[data-testid="context-menu"]')
    const menuContent = alphaMenu?.querySelector('[data-testid="context-menu-content"]')

    expect(menuContent ?? null).toBeInTheDocument()
    const leftAction = within(menuContent as HTMLElement).getByRole('button', { name: 'Left' })
    expect(leftAction).not.toBeDisabled()
    fireEvent.click(leftAction)

    await vi.waitFor(() => {
      expect(onSetPanePosition).toHaveBeenCalledWith('left')
    })
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
      expect.stringMatching(/^Move to/),
      'Open in New Window',
      'Conversation positionLeftRight',
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

  it('hides open-in-new-tab but keeps open-in-new-window for inactive topics in a detached window', () => {
    windowFrameMocks.mode = 'window'
    const { getByText } = renderTopicList()

    fireEvent.contextMenu(getByText('Gamma topic'))
    const gammaMenu = getByText('Gamma topic').closest('[data-testid="context-menu"]')
    const menuContent = gammaMenu?.querySelector('[data-testid="context-menu-content"]')

    expect(menuContent).not.toHaveTextContent('Open in new tab')
    expect(menuContent).toHaveTextContent('Open in New Window')
  })

  it('shows loading while exporting a right-clicked topic as an image without switching topics', async () => {
    const { getByText, setActiveTopic } = renderTopicList()
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
    expect(toast.loading).not.toHaveBeenCalled()

    await vi.waitFor(() => expect(animationFrameCallbacks.length).toBeGreaterThan(0))
    act(() => {
      for (const callback of animationFrameCallbacks.splice(0)) {
        callback(0)
      }
    })

    expect(toast.loading).toHaveBeenCalledWith(
      expect.objectContaining({
        key: expect.stringMatching(/^topic-image-export:/),
        promise: expect.any(Promise),
        title: 'Exporting image. Please stay on this page.'
      })
    )
    expect(setActiveTopic).not.toHaveBeenCalled()
    expect(EventEmitter.emit).not.toHaveBeenCalledWith(
      EVENT_NAMES.EXPORT_TOPIC_IMAGE,
      expect.objectContaining({ id: 'topic-c' })
    )

    const [request] = consumePendingTopicImageActions('topic-c', 'export')
    settleTopicImageActionRequest(request, Promise.resolve())
    await vi.waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('Image saved successfully')
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

    expect(setActiveTopic).not.toHaveBeenCalled()
    expect(toast.loading).not.toHaveBeenCalled()
    expect(EventEmitter.emit).not.toHaveBeenCalledWith(
      EVENT_NAMES.COPY_TOPIC_IMAGE,
      expect.objectContaining({ id: 'topic-c' })
    )

    const [request] = consumePendingTopicImageActions('topic-c', 'copy')
    request.promise.catch(() => undefined)
    settleTopicImageActionRequest(request, Promise.reject(new Error('copy failed')))

    await vi.waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Copy failed')
    })
    requestAnimationFrameSpy.mockRestore()
  })

  it('keeps separate capture hosts for repeated image requests on the same topic', async () => {
    imageCaptureTargetsMock.targets = [
      {
        requestId: 1,
        target: createRendererTopic({ assistantId: 'assistant-2', id: 'topic-c', name: 'Gamma topic' })
      },
      {
        requestId: 2,
        target: createRendererTopic({ assistantId: 'assistant-2', id: 'topic-c', name: 'Gamma topic' })
      }
    ]

    renderTopicList()

    const hosts = screen.getAllByTestId('topic-image-capture-host')
    expect(hosts).toHaveLength(2)
    expect(hosts.map((host) => host.getAttribute('data-topic-id'))).toEqual(['topic-c', 'topic-c'])
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

    // Deletion is delegated to ConfirmActionPopup, which gates the action behind its own confirm
    // dialog (that "don't run until confirmed" gate is covered by ConfirmActionPopup's unit test).
    // The default mock confirms and runs the gated action, so the topic is deleted.
    await vi.waitFor(() =>
      expect(confirmActionShow).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Delete Conversations', action: expect.any(Function) })
      )
    )
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

  it('selects the same assistant neighbouring topic after deleting the active topic in the right panel', async () => {
    mockUseInfiniteQuery.mockReturnValue({
      pages: [
        {
          items: [
            createApiTopic({
              id: 'topic-a1-first',
              name: 'A1 First',
              assistantId: 'assistant-1',
              orderKey: 'a',
              createdAt: '2026-01-03T01:00:00.000Z',
              updatedAt: '2026-01-03T01:00:00.000Z'
            }),
            createApiTopic({
              id: 'topic-a1-second',
              name: 'A1 Second',
              assistantId: 'assistant-1',
              orderKey: 'b',
              createdAt: '2026-01-02T01:00:00.000Z',
              updatedAt: '2026-01-02T01:00:00.000Z'
            }),
            createApiTopic({
              id: 'topic-a2-first',
              name: 'A2 First',
              assistantId: 'assistant-2',
              orderKey: 'c',
              createdAt: '2026-01-01T01:00:00.000Z',
              updatedAt: '2026-01-01T01:00:00.000Z'
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

    const { setActiveTopic } = renderTopicList({
      assistantIdFilter: 'assistant-1',
      presentation: 'right-panel',
      activeTopic: createRendererTopic({ id: 'topic-a1-second', assistantId: 'assistant-1', name: 'A1 Second' })
    })

    const topicRow = screen.getByText('A1 Second').closest('[role="option"]')
    const deleteButton = within(topicRow as HTMLElement).getByLabelText('Delete')
    act(() => {
      fireEvent.click(deleteButton)
    })
    act(() => {
      fireEvent.click(deleteButton)
    })

    await vi.waitFor(() => expect(topicDataMocks.deleteTopic).toHaveBeenCalledWith('topic-a1-second'))
    await vi.waitFor(() =>
      expect(setActiveTopic).toHaveBeenCalledWith(expect.objectContaining({ id: 'topic-a1-first' }))
    )
    expect(setActiveTopic).not.toHaveBeenCalledWith(expect.objectContaining({ id: 'topic-a2-first' }))
  })

  it('selects the same-assistant neighbour, not a global one, after deleting the active topic in the modern sidebar', async () => {
    mockUseInfiniteQuery.mockReturnValue({
      pages: [
        {
          items: [
            createApiTopic({
              id: 'topic-a1-first',
              name: 'A1 First',
              assistantId: 'assistant-1',
              orderKey: 'a',
              createdAt: '2026-01-03T01:00:00.000Z',
              updatedAt: '2026-01-03T01:00:00.000Z'
            }),
            createApiTopic({
              id: 'topic-a1-second',
              name: 'A1 Second',
              assistantId: 'assistant-1',
              orderKey: 'b',
              createdAt: '2026-01-02T01:00:00.000Z',
              updatedAt: '2026-01-02T01:00:00.000Z'
            }),
            createApiTopic({
              id: 'topic-a2-first',
              name: 'A2 First',
              assistantId: 'assistant-2',
              orderKey: 'c',
              createdAt: '2026-01-01T01:00:00.000Z',
              updatedAt: '2026-01-01T01:00:00.000Z'
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

    const { setActiveTopic } = renderTopicList({
      activeTopic: createRendererTopic({ id: 'topic-a1-second', assistantId: 'assistant-1', name: 'A1 Second' })
    })

    const topicRow = screen.getByText('A1 Second').closest('[role="option"]')
    const deleteButton = within(topicRow as HTMLElement).getByLabelText('Delete')
    act(() => {
      fireEvent.click(deleteButton)
    })
    act(() => {
      fireEvent.click(deleteButton)
    })

    await vi.waitFor(() => expect(topicDataMocks.deleteTopic).toHaveBeenCalledWith('topic-a1-second'))
    await vi.waitFor(() =>
      expect(setActiveTopic).toHaveBeenCalledWith(expect.objectContaining({ id: 'topic-a1-first' }))
    )
    expect(setActiveTopic).not.toHaveBeenCalledWith(expect.objectContaining({ id: 'topic-a2-first' }))
  })

  it('uses the pre-delete topic snapshot when refresh completes before deletion resolves', async () => {
    const topics = [
      createApiTopic({
        id: 'topic-a1-first',
        name: 'A1 First',
        assistantId: 'assistant-1',
        orderKey: 'a'
      }),
      createApiTopic({
        id: 'topic-a1-second',
        name: 'A1 Second',
        assistantId: 'assistant-1',
        orderKey: 'b'
      })
    ]
    const assistantTopicsSource = createAssistantTopicsSource(topics)
    let resolveDelete: (() => void) | undefined
    topicDataMocks.deleteTopic.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveDelete = resolve
        })
    )
    const { onNewTopic, rerenderTopicList, setActiveTopic } = renderTopicList({
      activeTopic: createRendererTopic({ id: 'topic-a1-second', assistantId: 'assistant-1', name: 'A1 Second' }),
      assistantTopicsSource
    })

    const topicRow = screen.getByText('A1 Second').closest('[role="option"]')
    const deleteButton = within(topicRow as HTMLElement).getByLabelText('Delete')
    act(() => {
      fireEvent.click(deleteButton)
    })
    act(() => {
      fireEvent.click(deleteButton)
    })
    await vi.waitFor(() => expect(topicDataMocks.deleteTopic).toHaveBeenCalledWith('topic-a1-second'))

    const refreshedTopics = topics.filter((topic) => topic.id !== 'topic-a1-second')
    Object.assign(assistantTopicsSource, {
      pages: [{ items: refreshedTopics }],
      topics: refreshedTopics
    })
    rerenderTopicList()
    await act(async () => {
      resolveDelete?.()
    })

    await vi.waitFor(() =>
      expect(setActiveTopic).toHaveBeenCalledWith(expect.objectContaining({ id: 'topic-a1-first' }))
    )
    expect(onNewTopic).not.toHaveBeenCalled()
  })

  it("clears the active topic without jumping owners when deleting its owner's last topic", async () => {
    mockUseInfiniteQuery.mockReturnValue({
      pages: [
        {
          items: [
            createApiTopic({
              id: 'topic-a1',
              name: 'A1 Only',
              assistantId: 'assistant-1',
              orderKey: 'a',
              createdAt: '2026-01-02T01:00:00.000Z',
              updatedAt: '2026-01-02T01:00:00.000Z'
            }),
            createApiTopic({
              id: 'topic-b1',
              name: 'B1 Only',
              assistantId: 'assistant-2',
              orderKey: 'b',
              createdAt: '2026-01-01T01:00:00.000Z',
              updatedAt: '2026-01-01T01:00:00.000Z'
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

    const { onClearActiveTopic, onNewTopic, setActiveTopic } = renderTopicList({
      activeTopic: createRendererTopic({ id: 'topic-a1', assistantId: 'assistant-1', name: 'A1 Only' })
    })

    const topicRow = screen.getByText('A1 Only').closest('[role="option"]')
    const deleteButton = within(topicRow as HTMLElement).getByLabelText('Delete')
    act(() => {
      fireEvent.click(deleteButton)
    })
    act(() => {
      fireEvent.click(deleteButton)
    })

    await vi.waitFor(() => expect(topicDataMocks.deleteTopic).toHaveBeenCalledWith('topic-a1'))
    await vi.waitFor(() => expect(onClearActiveTopic).toHaveBeenCalledTimes(1))
    expect(onNewTopic).not.toHaveBeenCalled()
    expect(setActiveTopic).not.toHaveBeenCalledWith(expect.objectContaining({ id: 'topic-b1' }))
  })

  it("shows the scoped empty state after deleting the active owner's last topic in the right panel", async () => {
    setScopedTopicInfiniteQuery([
      createApiTopic({
        id: 'topic-a1-only',
        name: 'A1 Only',
        assistantId: 'assistant-1',
        orderKey: 'a',
        createdAt: '2026-01-03T01:00:00.000Z',
        updatedAt: '2026-01-03T01:00:00.000Z'
      }),
      createApiTopic({
        id: 'topic-a2-first',
        name: 'A2 First',
        assistantId: 'assistant-2',
        orderKey: 'b',
        createdAt: '2026-01-02T01:00:00.000Z',
        updatedAt: '2026-01-02T01:00:00.000Z'
      })
    ])

    const { onClearActiveTopic, onNewTopic, setActiveTopic } = renderTopicList({
      assistantIdFilter: 'assistant-1',
      presentation: 'right-panel',
      activeTopic: createRendererTopic({ id: 'topic-a1-only', assistantId: 'assistant-1', name: 'A1 Only' })
    })

    const topicRow = screen.getByText('A1 Only').closest('[role="option"]')
    const deleteButton = within(topicRow as HTMLElement).getByLabelText('Delete')
    act(() => {
      fireEvent.click(deleteButton)
    })
    act(() => {
      fireEvent.click(deleteButton)
    })

    await vi.waitFor(() => expect(topicDataMocks.deleteTopic).toHaveBeenCalledWith('topic-a1-only'))
    await vi.waitFor(() => expect(onClearActiveTopic).toHaveBeenCalledTimes(1))
    expect(onNewTopic).not.toHaveBeenCalled()
    expect(setActiveTopic).not.toHaveBeenCalled()
  })

  it('does not let a delayed scoped-latest fallback overwrite a newer topic selection', async () => {
    const deletedTopic = createApiTopic({
      id: 'topic-a-only',
      name: 'A Only',
      assistantId: 'assistant-1',
      orderKey: 'a'
    })
    setTopicInfiniteQueryPages([deletedTopic])
    let resolveLatestTopic!: (topic: ApiTopic | null) => void
    const loadLatestTopic = vi.fn(() => new Promise<ApiTopic | null>((resolve) => (resolveLatestTopic = resolve)))
    const assistantTopicsSource = {
      ...createAssistantTopicsSource([deletedTopic]),
      loadLatestTopic
    } as AssistantTopicsSource
    const onClearActiveTopic = vi.fn()
    const { rerenderTopicList, setActiveTopic } = renderTopicList({
      activeTopic: createRendererTopic({ id: 'topic-a-only', assistantId: 'assistant-1', name: 'A Only' }),
      assistantTopicsSource,
      onClearActiveTopic
    })

    const deleteButton = within(getTopicRow('A Only')).getByLabelText('Delete')
    act(() => fireEvent.click(deleteButton))
    act(() => fireEvent.click(deleteButton))
    await vi.waitFor(() => expect(loadLatestTopic).toHaveBeenCalledWith('assistant-1'))

    rerenderTopicList(
      undefined,
      createRendererTopic({ id: 'topic-b-new', assistantId: 'assistant-2', name: 'New selection' })
    )
    await act(async () => {
      resolveLatestTopic(
        createApiTopic({ id: 'topic-a-fallback', assistantId: 'assistant-1', name: 'A fallback', orderKey: 'b' })
      )
      await Promise.resolve()
    })

    expect(setActiveTopic).not.toHaveBeenCalled()
    expect(onClearActiveTopic).not.toHaveBeenCalled()
  })

  it('keeps topic rows compact and only renders the title field in the sidebar list', () => {
    renderTopicList()

    expect(screen.getByText('Alpha topic')).toBeInTheDocument()
    expect(screen.queryByText('2026/01/03 01:00')).not.toBeInTheDocument()
    expect(screen.queryByText('2026/01/02 01:00')).not.toBeInTheDocument()
    expect(screen.queryByText('2025/12/31 01:00')).not.toBeInTheDocument()
    expect(screen.queryByText(/^Prompt:/)).not.toBeInTheDocument()
  })

  it('rerenders only the previous and next active topic rows when selection changes', () => {
    const setPanePosition = vi.fn()
    const exportMenuOptions = {
      docx: true,
      image: true,
      joplin: true,
      markdown: true,
      markdown_reason: true,
      notes: true,
      notion: true,
      obsidian: true,
      plain_text: true,
      siyuan: true,
      yuque: true
    }
    let previousPreferenceKeys: unknown
    let stableExportMenuOptions = exportMenuOptions
    MockUsePreference.useMultiplePreferences.mockImplementation((keys) => {
      if (keys !== previousPreferenceKeys) {
        previousPreferenceKeys = keys
        stableExportMenuOptions = { ...exportMenuOptions }
      }
      return [stableExportMenuOptions, vi.fn()] as never
    })
    cacheHookMocks.values.set('topic.renaming', [])
    cacheHookMocks.values.set('topic.newly_renamed', [])
    const topicPinsQuery = {
      data: [],
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      refetch: vi.fn(),
      mutate: vi.fn()
    }
    const assistantPinsQuery = { ...topicPinsQuery }
    const assistantsQuery = {
      ...topicPinsQuery,
      data: { items: [createAssistant()], total: 1 }
    }
    const emptyQuery = { ...topicPinsQuery, data: undefined }
    mockUseQuery.mockImplementation((path, options) => {
      if (path === '/assistants') return assistantsQuery
      if (path !== '/pins') return emptyQuery

      const entityType = (options as { query?: { entityType?: string } } | undefined)?.query?.entityType
      return entityType === 'assistant' ? assistantPinsQuery : topicPinsQuery
    })
    const assistantTopicsSource = createAssistantTopicsSource(createTopicPageItems(3))
    const { rerenderTopicList } = renderTopicList({
      activeTopic: createRendererTopic({ id: 'topic-1', name: 'Topic 1' }),
      assistantTopicsSource,
      onSetPanePosition: setPanePosition,
      panePosition: 'left'
    })
    const initialRenderCounts = new Map(topicRowRenderMocks.counts)

    rerenderTopicList(undefined, createRendererTopic({ id: 'topic-2', name: 'Topic 2' }))

    expect(MockUsePreference.useMultiplePreferences.mock.calls.at(-1)?.[0]).toBe(
      MockUsePreference.useMultiplePreferences.mock.calls[0][0]
    )
    expect(topicRowRenderMocks.counts.get('topic-1')).toBeGreaterThan(initialRenderCounts.get('topic-1') ?? 0)
    expect(topicRowRenderMocks.counts.get('topic-2')).toBeGreaterThan(initialRenderCounts.get('topic-2') ?? 0)
    expect(topicRowRenderMocks.counts.get('topic-3')).toBe(initialRenderCounts.get('topic-3'))
  })

  it('keeps inactive topic stream indicator visible and opens fulfilled topics', () => {
    setTopicStreamCacheStatus('topic-c', 'pending')
    let view = renderTopicList()
    let setActiveTopic = view.setActiveTopic

    let topicRow = getTopicRow('Gamma topic')
    let indicatorRoot = topicRow.querySelector('[data-testid="topic-stream-indicator"]')
    let indicator = indicatorRoot?.querySelector('.animation-pulse')
    expect(indicatorRoot).not.toHaveClass('absolute')
    expect(indicator).toHaveClass('bg-(--color-warning)')
    expect(topicRow.querySelector('[data-deleting]')).not.toBeInTheDocument()
    expect(topicStreamStatusMocks.markSeen).not.toHaveBeenCalled()

    setTopicStreamCacheStatus('topic-c', 'done')
    view.unmount()
    view = renderTopicList()
    setActiveTopic = view.setActiveTopic

    topicRow = getTopicRow('Gamma topic')
    indicatorRoot = topicRow.querySelector('[data-testid="topic-stream-indicator"]')
    indicator = indicatorRoot?.querySelector('span')
    expect(indicatorRoot).not.toHaveClass('absolute')
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

  it('positions inactive topic stream indicators at the far right in the classic layout and hides them on hover', () => {
    setTopicStreamCacheStatus('topic-c', 'pending')
    renderTopicList({
      activeTopic: createRendererTopic({ id: 'topic-a', assistantId: 'assistant-1', name: 'Alpha topic' }),
      assistantIdFilter: 'assistant-2',
      presentation: 'right-panel'
    })

    const topicRow = getTopicRow('Gamma topic')
    const indicator = topicRow.querySelector('[data-testid="topic-stream-indicator"]')

    expect(indicator).toBeInTheDocument()
    expect(indicator).toHaveClass('absolute', 'right-1.5', 'group-hover:opacity-0')
    expect(indicator?.querySelector('span')).toHaveClass('animation-pulse', 'bg-(--color-warning)')
    expect(within(topicRow).getByLabelText('Delete')).toBeInTheDocument()
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

  it('shows every loaded topic in the flat creation stream without per-group show-more controls', () => {
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
      pages: [{ items: createTopicPageItems(51) }],
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

    expect(screen.getByText('Topic 50')).toBeInTheDocument()
    expect(screen.getByText('Topic 51')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Show more conversations' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Collapse conversations' })).not.toBeInTheDocument()
  })

  it('keeps a selected topic visible in the flat creation stream', () => {
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
      pages: [{ items: createTopicPageItems(51) }],
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

    fireEvent.click(getTopicRow('Topic 51'))

    expect(setActiveTopic).toHaveBeenCalledWith(expect.objectContaining({ id: 'topic-51' }))

    rerenderTopicList(undefined, createRendererTopic({ id: 'topic-51', name: 'Topic 51' }))

    expect(screen.getByText('Topic 51')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Collapse conversations' })).not.toBeInTheDocument()
  })

  it('shows assistant group bulk actions in the topic options menu', async () => {
    MockUsePreferenceUtils.setPreferenceValue('topic.tab.display_mode' as never, 'assistant')
    const fixture = [
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
    setTopicInfiniteQueryPages(fixture)
    applyTopicStats(fixture)

    renderTopicList({
      activeTopic: createRendererTopic({
        id: 'assistant-1-topic-1',
        assistantId: 'assistant-1',
        name: 'Alpha topic 1'
      })
    })

    expect(screen.getByText('Alpha topic 1')).toBeInTheDocument()
    expect(screen.getByText('Beta topic 1')).toBeInTheDocument()
    expect(getTopicGroupExpansionCache().assistant).not.toContain(TOPIC_ASSISTANT_SECTION_ID)

    // The assistant header exposes history and bulk expand/collapse actions from the options menu.
    const optionsMenu = openTopicListOptions()
    expect(within(optionsMenu).getByRole('button', { name: 'History' })).toBeInTheDocument()
    fireEvent.click(within(optionsMenu).getByRole('button', { name: 'Collapse all' }))

    expect(getTopicGroupExpansionCache().assistant).toEqual([
      'topic:assistant:assistant-1',
      'topic:assistant:assistant-2'
    ])
  })

  it('expands the active assistant group without changing selection while history records are active', () => {
    MockUsePreferenceUtils.setPreferenceValue('topic.tab.display_mode' as never, 'assistant')
    setTopicGroupExpansionCache({
      ...createExpandedTopicGroupExpansionFixture(),
      assistant: ['topic:assistant:assistant-1']
    })
    const { setActiveTopic } = renderTopicList({
      activeTopic: createRendererTopic({ id: 'topic-a', assistantId: 'assistant-1', name: 'Alpha topic' }),
      historyRecordsActive: true
    })

    fireEvent.click(screen.getByRole('button', { name: 'Alpha Assistant' }))

    expect(setActiveTopic).not.toHaveBeenCalled()
    expect(getTopicGroupExpansionCache().assistant).not.toContain('topic:assistant:assistant-1')
  })

  it('does not show the assistant section toggle action in time display mode', () => {
    MockUsePreferenceUtils.setPreferenceValue('topic.tab.display_mode' as never, 'time')
    setTopicInfiniteQueryPages(createTopicPageItems(51))

    renderTopicList()

    // The flat time view has no assistant grouping, so no group header exposes an expand toggle
    // and the options menu drops the assistant section collapse/expand action.
    expect(
      screen.queryAllByRole('button', { name: 'Assistant' }).some((button) => button.hasAttribute('aria-expanded'))
    ).toBe(false)
    const optionsMenu = openTopicListOptions()
    expect(within(optionsMenu).queryByRole('button', { name: 'Collapse all' })).not.toBeInTheDocument()
    expect(within(optionsMenu).queryByRole('button', { name: 'Expand all' })).not.toBeInTheDocument()
  })

  it('subscribes topic stream status only for rows visible in the ResourceList view', () => {
    MockUsePreferenceUtils.setPreferenceValue('topic.tab.display_mode' as never, 'time')
    // Only the first 50 rows fall inside the virtual window; row 51 stays unmounted.
    virtualMocks.maxVisibleItems = 50
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
    // Descending creation timestamps so the flat createdAt stream renders topic-1 first and topic-51
    // last; only the last row falls outside the 50-row virtual window.
    setTopicInfiniteQueryPages(
      Array.from({ length: 51 }, (_, index) =>
        createApiTopic({
          id: `topic-${index + 1}`,
          name: `Topic ${index + 1}`,
          assistantId: 'assistant-1',
          orderKey: String(index + 1).padStart(3, '0'),
          createdAt: new Date(2026, 0, 3, 1, 0, 51 - index).toISOString(),
          updatedAt: new Date(2026, 0, 3, 1, 0, 51 - index).toISOString()
        })
      )
    )
    const subscribeSpy = vi.spyOn(cacheService, 'subscribe')

    try {
      renderTopicList()

      const subscribedKeys = subscribeSpy.mock.calls.map(([key]) => key)
      expect(subscribedKeys).toContain(topicStreamStatusCacheKey('topic-50'))
      expect(subscribedKeys).toContain(topicStreamLastSeenCompletionCacheKey('topic-50'))
      expect(subscribedKeys).not.toContain(topicStreamStatusCacheKey('topic-51'))
      expect(subscribedKeys).not.toContain(topicStreamLastSeenCompletionCacheKey('topic-51'))
    } finally {
      subscribeSpy.mockRestore()
    }
  })

  it('renders display and sort submenus before the existing topic list actions', async () => {
    const { onOpenHistoryRecords } = renderTopicList()

    expect(screen.getByTestId('resource-list-topic')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Search conversations')).not.toBeInTheDocument()

    expect(screen.queryByLabelText('Manage topics')).not.toBeInTheDocument()
    let optionsMenu = openTopicListOptions()
    // Display and sort submenus lead the options menu, ahead of the History action.
    const displayLabel = within(optionsMenu).getByText('Display mode')
    const sortLabel = within(optionsMenu).getByText('Sort order')
    const historyItem = within(optionsMenu).getByRole('button', { name: 'History' })
    expect(displayLabel.compareDocumentPosition(sortLabel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(sortLabel.compareDocumentPosition(historyItem) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    // The display submenu offers the time and assistant modes; assistant is the stored mode.
    expect(within(optionsMenu).getByRole('button', { name: 'Assistant' })).toBeInTheDocument()

    fireEvent.click(within(optionsMenu).getByRole('button', { name: 'Time' }))
    await vi.waitFor(() => {
      expect(MockUsePreferenceUtils.getPreferenceValue('topic.tab.display_mode' as never)).toBe('time')
    })

    optionsMenu = openTopicListOptions()
    fireEvent.click(within(optionsMenu).getByRole('button', { name: 'History' }))
    await vi.waitFor(() => expect(onOpenHistoryRecords).toHaveBeenCalledTimes(1))
  })

  it('persists the selected topic sort independently from display mode', async () => {
    renderTopicList()

    const optionsMenu = openTopicListOptions()
    // The sort submenu exposes the creation-time (stored) and updated-time options.
    expect(within(optionsMenu).getByRole('button', { name: 'Creation time' })).toBeInTheDocument()

    fireEvent.click(within(optionsMenu).getByRole('button', { name: 'Updated time' }))

    await vi.waitFor(() => {
      expect(MockUsePreferenceUtils.getPreferenceValue('topic.sort_type' as never)).toBe('updatedAt')
      expect(MockUsePreferenceUtils.getPreferenceValue('topic.tab.display_mode' as never)).toBe('assistant')
    })
  })

  it('preserves saved assistant expansion while revealing the active topic after a mode switch', async () => {
    MockUsePreferenceUtils.setPreferenceValue('topic.tab.display_mode' as never, 'time')
    setTopicGroupExpansionCache({
      assistant: ['topic:assistant:assistant-1', 'topic:assistant:assistant-2']
    })
    const fixture = [
      createApiTopic({ id: 'topic-a', name: 'Alpha topic', assistantId: 'assistant-1', orderKey: 'a' }),
      createApiTopic({ id: 'topic-beta', name: 'Beta topic', assistantId: 'assistant-2', orderKey: 'b' }),
      createApiTopic({ id: 'topic-default', name: 'Default topic', assistantId: undefined, orderKey: 'c' })
    ]
    setTopicInfiniteQueryPages(fixture)
    applyTopicStats(fixture)

    const staleRevealRequest = {
      clearFilters: true,
      clearQuery: true,
      itemId: 'topic-beta',
      requestId: 7
    }
    const { rerenderTopicList } = renderTopicList({
      // Simulate an older explicit locate followed by a normal click on the active Alpha topic.
      revealRequest: staleRevealRequest
    })

    const optionsMenu = openTopicListOptions()
    fireEvent.click(within(optionsMenu).getByRole('button', { name: 'Assistant' }))

    await vi.waitFor(() => {
      expect(MockUsePreferenceUtils.getPreferenceValue('topic.tab.display_mode' as never)).toBe('assistant')
    })
    rerenderTopicList(staleRevealRequest)

    await vi.waitFor(() => {
      expect(getTopicGroupExpansionCache().assistant).toEqual(['topic:assistant:assistant-2'])
    })
    expect(screen.getByRole('button', { name: 'Alpha Assistant' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: 'Beta Assistant' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText('Alpha topic')).toBeInTheDocument()
    expect(virtualMocks.scrollToIndex).toHaveBeenCalledWith(expect.any(Number), { align: 'center' })
  })

  it('keeps assistant grouped topics in the generic loading state until the first page arrives', () => {
    MockUsePreferenceUtils.setPreferenceValue('topic.tab.display_mode' as never, 'assistant')
    // No rows have arrived yet and the pin-owned stream is still loading, so the whole list stays
    // in the generic loading skeleton rather than revealing partial assistant groups.
    mockUseInfiniteQuery.mockReturnValue({
      pages: [{ items: [] }],
      isLoading: true,
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
    expect(screen.queryAllByTestId('topic-list-row')).toHaveLength(0)
    expect(document.querySelectorAll('[data-resource-list-loading-group]')).toHaveLength(2)
    expect(document.querySelectorAll('[data-resource-list-loading-item]')).toHaveLength(5)
    expect(document.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0)
  })

  it('focuses a history-selected topic in the flat creation stream', async () => {
    MockUsePreferenceUtils.setPreferenceValue('topic.tab.display_mode' as never, 'time')
    mockUseInfiniteQuery.mockReturnValue({
      pages: [
        {
          items: createTopicPageItems(51)
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

    expect(screen.getByText('Topic 51')).toBeInTheDocument()

    rerenderTopicList({ itemId: 'topic-51', requestId: 1, clearFilters: true, clearQuery: true })

    expect(await screen.findByText('Topic 51')).toBeInTheDocument()
    const revealedRow = screen.getByText('Topic 51').closest('[role="option"]')
    expect(revealedRow).not.toBeNull()
    expect(revealedRow!).toHaveAttribute('data-reveal-focus', 'true')
    expect(revealedRow!).toHaveClass('animation-resource-list-reveal-focus')
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
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
    const fixture = withPinnedTopics(createDefaultTopicFixture(), ['topic-b'])
    setTopicInfiniteQueryPages(fixture)
    applyTopicStats(fixture, ['topic-b'])
    renderTopicList()

    const header = screen.getByRole('button', { name: 'Pinned' }).closest('div')
    expect(header).toBeInTheDocument()
    expect(
      within(header as HTMLElement).queryByRole('button', { name: 'chat.conversation.new' })
    ).not.toBeInTheDocument()
  })

  it('uses a generic header create action in time display mode', () => {
    MockUsePreferenceUtils.setPreferenceValue('topic.tab.display_mode' as never, 'time')
    const { onNewTopic } = renderTopicList()

    fireEvent.click(screen.getByRole('button', { name: 'chat.conversation.new' }))

    expect(onNewTopic).toHaveBeenCalledWith(undefined)
  })

  it('does not enable drag reorder in time mode', () => {
    const patchSpy = vi.spyOn(dataApiService, 'patch').mockResolvedValue(undefined as never)
    MockUsePreferenceUtils.setPreferenceValue('topic.tab.display_mode' as never, 'time')

    renderTopicList()

    expect(screen.queryByTestId('dnd-context')).not.toBeInTheDocument()
    dndMocks.onDragEnd?.({ active: { id: 'topic-a' }, over: { id: 'topic-c' } })

    expect(patchSpy).not.toHaveBeenCalled()
  })

  it('defaults only the active assistant group to expanded before the user changes expansion', () => {
    MockUsePreferenceUtils.setPreferenceValue('topic.tab.display_mode' as never, 'assistant')
    setTopicGroupExpansionCache({
      ...createExpandedTopicGroupExpansionFixture(),
      assistant: null
    })
    applyTopicStats(createDefaultTopicFixture())

    renderTopicList()

    expect(screen.getByRole('button', { name: 'Alpha Assistant' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: 'Beta Assistant' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText('Alpha topic')).toBeInTheDocument()
    expect(screen.queryByText('Gamma topic')).not.toBeInTheDocument()
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
    const fixture = withPinnedTopics(
      [
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
      ],
      ['topic-b']
    )
    setTopicInfiniteQueryPages(fixture)
    applyTopicStats(fixture, ['topic-b'])

    const { onNewTopic } = renderTopicList()

    expect(screen.getByRole('button', { name: 'Pinned' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Default Assistant' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Alpha Assistant' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Beta Assistant' })).toBeInTheDocument()
    expect(
      screen
        .getByRole('button', { name: 'Alpha Assistant' })
        .compareDocumentPosition(screen.getByRole('button', { name: 'Default Assistant' })) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(
      screen
        .getByRole('button', { name: 'Beta Assistant' })
        .compareDocumentPosition(screen.getByRole('button', { name: 'Default Assistant' })) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'Alpha Assistant' }).querySelector('[data-resource-list-leading-slot="true"]')
        ?.firstElementChild
    ).toHaveClass('rounded-full')
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

  it('keeps assistant tag sections when assistant topics move back to the left panel', () => {
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'assistant.tab.sort_type': 'tags',
      'topic.tab.display_mode': 'assistant',
      'topic.tab.position': 'left'
    })

    renderTopicList()

    const workSection = screen.getByRole('button', { name: 'Work' }).closest('div')
    const homeSection = screen.getByRole('button', { name: 'Home' }).closest('div')
    const alphaAssistant = screen.getByRole('button', { name: 'Alpha Assistant' })
    const betaAssistant = screen.getByRole('button', { name: 'Beta Assistant' })

    expect(workSection).toBeInTheDocument()
    expect(homeSection).toBeInTheDocument()
    expect(alphaAssistant).toBeInTheDocument()
    expect(betaAssistant).toBeInTheDocument()
    expect(workSection!.compareDocumentPosition(alphaAssistant) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(homeSection!.compareDocumentPosition(betaAssistant) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('uses the configured model icon for assistant topic groups', () => {
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'assistant.icon_type': 'model',
      'chat.default_model_id': 'provider-default::default-model',
      'topic.tab.display_mode': 'assistant'
    })
    mockUseQuery.mockImplementation((path) => {
      if (path === '/assistants') {
        return {
          data: {
            items: [
              createAssistant({
                id: 'assistant-1',
                modelId: 'provider-a::model-a',
                modelName: 'Model A'
              })
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

    renderTopicList()

    const assistantHeader = screen.getByRole('button', { name: 'Alpha Assistant' }).closest('div')
    expect(assistantHeader).toBeInTheDocument()
    expect(within(assistantHeader as HTMLElement).getByTestId('model-avatar')).toHaveAttribute(
      'data-model-id',
      'model-a'
    )
  })

  it('moves assistant group actions into the more menu', async () => {
    MockUsePreferenceUtils.setPreferenceValue('topic.tab.display_mode' as never, 'assistant')
    const { onClearActiveTopic, onNewTopic, setActiveTopic } = renderTopicList()
    expect(resourceEditDialogMocks.renderHost).not.toHaveBeenCalled()

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
    await act(async () => {
      for (const callback of animationFrameCallbacks.splice(0)) {
        callback(0)
      }
    })
    const editDialogHost = await screen.findByTestId('resource-edit-dialog-host')
    expect(editDialogHost).toHaveAttribute('data-kind', 'assistant')
    expect(editDialogHost).toHaveAttribute('data-id', 'assistant-1')
    expect(resourceEditDialogMocks.renderHost).toHaveBeenCalledOnce()
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
    expect(deleteAssistantChatsButton.querySelector('svg')).not.toHaveClass('text-destructive')
    topicDataMocks.deleteTopicsByAssistantId.mockResolvedValueOnce({
      deletedIds: ['topic-a', 'topic-b'],
      deletedCount: 2
    })
    fireEvent.click(deleteAssistantChatsButton)

    await vi.waitFor(() =>
      expect(popup.confirm).toHaveBeenCalledWith(
        expect.objectContaining({
          content: 'Delete all assistant conversations?',
          title: 'Clear conversations'
        })
      )
    )
    await vi.waitFor(() => expect(topicDataMocks.deleteTopicsByAssistantId).toHaveBeenCalledWith('assistant-1'))
    expect(topicDataMocks.deleteTopic).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(topicDataMocks.refreshTopics).toHaveBeenCalled())
    expect(onClearActiveTopic).toHaveBeenCalledTimes(1)
    expect(setActiveTopic).not.toHaveBeenCalled()
    expect(onNewTopic).not.toHaveBeenCalled()

    fireEvent.click(within(assistantHeader as HTMLElement).getByRole('button', { name: 'chat.conversation.new' }))
    expect(onNewTopic).toHaveBeenCalledWith({ assistantId: 'assistant-1' })

    fireEvent.click(moreButton)
    fireEvent.click(within(assistantHeader as HTMLElement).getByRole('button', { name: 'Model' }))
    await vi.waitFor(() =>
      expect(MockUsePreferenceUtils.getPreferenceValue('assistant.icon_type' as never)).toBe('model')
    )

    fireEvent.click(moreButton)
    fireEvent.click(within(assistantHeader as HTMLElement).getByRole('button', { name: 'Group by tag' }))
    await vi.waitFor(() =>
      expect(MockUsePreferenceUtils.getPreferenceValue('assistant.tab.sort_type' as never)).toBe('tags')
    )
  })

  it('deletes an assistant from the left assistant group menu', async () => {
    const onActiveAssistantDeleted = vi.fn()
    MockUsePreferenceUtils.setPreferenceValue('topic.tab.display_mode' as never, 'assistant')

    renderTopicList({ onActiveAssistantDeleted })

    const assistantHeader = screen.getByRole('button', { name: 'Alpha Assistant' }).closest('div')
    expect(assistantHeader).toBeInTheDocument()

    const moreButton = within(assistantHeader as HTMLElement).getByRole('button', { name: 'More' })
    fireEvent.click(moreButton)
    const deleteAssistantButton = within(assistantHeader as HTMLElement).getByRole('button', {
      name: 'Delete Assistant'
    })
    expect(deleteAssistantButton.querySelector('svg')).toHaveClass('lucide-custom', 'text-destructive')

    fireEvent.click(deleteAssistantButton)

    await vi.waitFor(() =>
      expect(popup.confirm).toHaveBeenCalledWith(
        expect.objectContaining({
          content: 'Delete this assistant and its conversations?',
          title: 'Delete Assistant'
        })
      )
    )
    await vi.waitFor(() =>
      expect(assistantMutationMocks.deleteAssistant).toHaveBeenCalledWith({
        params: { id: 'assistant-1' },
        query: { deleteTopics: true }
      })
    )
    await vi.waitFor(() => expect(onActiveAssistantDeleted).toHaveBeenCalledWith('assistant-1'))
    await vi.waitFor(() => expect(topicDataMocks.refreshTopics).toHaveBeenCalled())
    expect(toast.success).toHaveBeenCalledWith('Deleted')
  })

  it('blocks concurrent assistant group delete confirmations', async () => {
    let resolveConfirm!: (value: boolean) => void
    const confirmPromise = new Promise<boolean>((resolve) => {
      resolveConfirm = resolve
    })
    vi.mocked(popup.confirm).mockReturnValue(confirmPromise)
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

    await vi.waitFor(() => expect(popup.confirm).toHaveBeenCalledTimes(1))
    fireEvent.click(within(betaHeader as HTMLElement).getByRole('button', { name: 'More' }))
    const betaDeleteButton = within(betaHeader as HTMLElement).getByRole('button', {
      name: 'Delete all assistant conversations'
    })
    await vi.waitFor(() => expect(betaDeleteButton).toBeDisabled())
    fireEvent.click(betaDeleteButton)

    expect(popup.confirm).toHaveBeenCalledTimes(1)
    expect(topicDataMocks.deleteTopicsByAssistantId).not.toHaveBeenCalled()

    await act(async () => {
      resolveConfirm(true)
      await confirmPromise
    })

    await vi.waitFor(() => expect(topicDataMocks.deleteTopicsByAssistantId).toHaveBeenCalledTimes(1))
    expect(topicDataMocks.deleteTopicsByAssistantId).toHaveBeenCalledWith('assistant-1')
  })

  it('toggles an assistant group from the group row without changing the active topic', () => {
    MockUsePreferenceUtils.setPreferenceValue('topic.tab.display_mode' as never, 'assistant')
    const { setActiveTopic } = renderTopicList()

    const betaGroupButton = screen.getByRole('button', { name: 'Beta Assistant' })
    expect(betaGroupButton).toHaveAttribute('aria-expanded', 'true')

    fireEvent.click(betaGroupButton)

    expect(setActiveTopic).not.toHaveBeenCalled()
    expect(betaGroupButton).toHaveAttribute('aria-expanded', 'false')
    expect(getTopicGroupExpansionCache().assistant).toContain('topic:assistant:assistant-2')
    expect(screen.queryByRole('button', { name: 'common.collapse: Beta Assistant' })).not.toBeInTheDocument()

    fireEvent.click(betaGroupButton)

    expect(getTopicGroupExpansionCache().assistant).not.toContain('topic:assistant:assistant-2')
    expect(betaGroupButton).toHaveAttribute('aria-expanded', 'true')
  })

  it('moves the assistant resource entry into the topic options menu', async () => {
    const onSelect = vi.fn()
    renderTopicList({
      activeTopic: createRendererTopic({ id: 'topic-a', name: 'Alpha topic' }),
      resourceMenuItems: [
        {
          active: true,
          id: 'assistant-library',
          label: 'Assistant library',
          onSelect: vi.fn()
        },
        {
          id: 'assistant-resource-view',
          label: 'Assistants',
          onSelect
        }
      ]
    })

    expect(screen.queryByRole('button', { name: 'Assistants' })).not.toBeInTheDocument()
    expect(getTopicRow('Alpha topic')).not.toHaveAttribute('data-selected')

    const optionsMenu = openTopicListOptions()
    fireEvent.click(within(optionsMenu).getByRole('button', { name: 'Manage Assistants' }))

    await vi.waitFor(() => expect(onSelect).toHaveBeenCalledTimes(1))
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

  it('clears the active topic after clearing its assistant group', async () => {
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

    const { onClearActiveTopic } = renderTopicList()
    topicDataMocks.deleteTopicsByAssistantId.mockResolvedValueOnce({
      deletedIds: ['topic-a', 'topic-b'],
      deletedCount: 2
    })

    const assistantHeader = screen.getByRole('button', { name: 'Alpha Assistant' }).closest('div')
    expect(assistantHeader).toBeInTheDocument()

    const moreButton = within(assistantHeader as HTMLElement).getByRole('button', { name: 'More' })
    fireEvent.click(moreButton)
    fireEvent.click(
      within(assistantHeader as HTMLElement).getByRole('button', { name: 'Delete all assistant conversations' })
    )

    await vi.waitFor(() => expect(popup.confirm).toHaveBeenCalled())
    expect(topicDataMocks.deleteTopic).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(topicDataMocks.deleteTopicsByAssistantId).toHaveBeenCalledWith('assistant-1'))
    await vi.waitFor(() => expect(topicDataMocks.refreshTopics).toHaveBeenCalled())
    expect(onClearActiveTopic).toHaveBeenCalledTimes(1)
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('keeps assistant pin reads enabled outside assistant display mode for move targets', () => {
    MockUsePreferenceUtils.setPreferenceValue('topic.tab.display_mode' as never, 'time')

    renderTopicList()

    expect(mockUseQuery).toHaveBeenCalledWith('/pins', {
      enabled: true,
      query: { entityType: 'assistant' }
    })
  })

  it('persists assistant group collapse independently', () => {
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
    // Expanding Alpha clears only that assistant from the collapse list.
    expect(getTopicGroupExpansionCache().assistant).not.toContain('topic:assistant:assistant-1')
    expect(getTopicGroupExpansionCache().assistant).not.toContain('topic:assistant:assistant-2')
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

  it('keeps assistant group drag but disables topic item drag for timestamp sorting', () => {
    const patchSpy = vi.spyOn(dataApiService, 'patch').mockResolvedValue(undefined as never)
    const postSpy = vi.spyOn(dataApiService, 'post').mockResolvedValue(undefined as never)
    MockUsePreferenceUtils.setPreferenceValue('topic.tab.display_mode' as never, 'assistant')
    MockUsePreferenceUtils.setPreferenceValue('topic.sort_type' as never, 'updatedAt')

    renderTopicList()

    // Assistant groups stay draggable. Item rows remain mounted as sortable nodes, but their drag is
    // gated off while the manual order is inactive, so an item drop is rejected without any write.
    expect(dndMocks.sortableData.has('group:topic:assistant:assistant-1')).toBe(true)
    dndMocks.onDragEnd?.({
      active: { data: sortableData('item:topic-a'), id: 'item:topic-a' },
      over: { data: sortableData('item:topic-c'), id: 'item:topic-c' }
    })
    expect(patchSpy).not.toHaveBeenCalled()
    expect(postSpy).not.toHaveBeenCalled()
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

    await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to reorder assistants: order failed'))
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
    const fixture = withPinnedTopics(
      [
        createApiTopic({ id: 'topic-a', name: 'Known alpha', assistantId: 'assistant-1', orderKey: 'a' }),
        createApiTopic({ id: 'topic-b', name: 'Pinned topic', assistantId: 'assistant-1', orderKey: 'b' }),
        createApiTopic({
          id: 'topic-e',
          name: 'Unknown topic',
          assistantId: 'missing-assistant',
          orderKey: 'e'
        })
      ],
      ['topic-b']
    )
    setTopicInfiniteQueryPages(fixture)
    applyTopicStats(fixture, ['topic-b'])

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
    const postSpy = vi.spyOn(dataApiService, 'post').mockResolvedValue(undefined as never)
    MockUsePreferenceUtils.setPreferenceValue('topic.tab.display_mode' as never, 'assistant')
    MockUsePreferenceUtils.setPreferenceValue('topic.sort_type' as never, 'orderKey')

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
    // Cross/same-group reorder is one atomic move that carries the ordering anchor.
    await vi.waitFor(() =>
      expect(postSpy).toHaveBeenCalledWith('/topics/topic-d/move', {
        body: { assistantId: 'assistant-2', order: { before: 'topic-c' } }
      })
    )
    expect(postSpy).toHaveBeenCalledTimes(1)
    expect(patchSpy).not.toHaveBeenCalled()
  })

  it('keeps multi-topic same-group drops at the fallback insertion index', async () => {
    const patchSpy = vi.spyOn(dataApiService, 'patch').mockResolvedValue(undefined as never)
    const postSpy = vi.spyOn(dataApiService, 'post').mockResolvedValue(undefined as never)
    MockUsePreferenceUtils.setPreferenceValue('topic.tab.display_mode' as never, 'assistant')
    MockUsePreferenceUtils.setPreferenceValue('topic.sort_type' as never, 'orderKey')
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
      expect(postSpy).toHaveBeenCalledWith('/topics/topic-c/move', {
        body: { assistantId: 'assistant-2', order: { before: 'topic-a' } }
      })
    )
    expect(postSpy).toHaveBeenCalledTimes(1)
    expect(patchSpy).not.toHaveBeenCalled()
  })

  it('keeps assistant grouped topics stable during cross-group drag hover', () => {
    const patchSpy = vi.spyOn(dataApiService, 'patch').mockResolvedValue(undefined as never)
    MockUsePreferenceUtils.setPreferenceValue('topic.tab.display_mode' as never, 'assistant')
    MockUsePreferenceUtils.setPreferenceValue('topic.sort_type' as never, 'orderKey')

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
    MockUsePreferenceUtils.setPreferenceValue('topic.sort_type' as never, 'orderKey')

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
    const postSpy = vi.spyOn(dataApiService, 'post').mockResolvedValue(undefined as never)
    MockUsePreferenceUtils.setPreferenceValue('topic.tab.display_mode' as never, 'assistant')
    MockUsePreferenceUtils.setPreferenceValue('topic.sort_type' as never, 'orderKey')

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
      expect(postSpy).toHaveBeenCalledWith('/topics/topic-d/move', {
        body: { assistantId: 'assistant-2', order: { before: 'topic-c' } }
      })
    )
    expect(postSpy).toHaveBeenCalledTimes(1)
    expect(patchSpy).not.toHaveBeenCalled()
  })

  it('moves topics across assistant groups and orders them at the target position in one call', async () => {
    const patchSpy = vi.spyOn(dataApiService, 'patch').mockResolvedValue(undefined as never)
    const postSpy = vi.spyOn(dataApiService, 'post').mockResolvedValue(undefined as never)
    MockUsePreferenceUtils.setPreferenceValue('topic.tab.display_mode' as never, 'assistant')
    MockUsePreferenceUtils.setPreferenceValue('topic.sort_type' as never, 'orderKey')

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
    // The new owner and the target ordering anchor travel together in a single atomic move.
    await vi.waitFor(() =>
      expect(postSpy).toHaveBeenCalledWith('/topics/topic-a/move', {
        body: { assistantId: 'assistant-2', order: { after: 'topic-d' } }
      })
    )
    expect(postSpy).toHaveBeenCalledTimes(1)
    expect(patchSpy).not.toHaveBeenCalled()
  })

  it('reverts the optimistic cross-assistant move and does not refresh when the move fails', async () => {
    const postSpy = vi.spyOn(dataApiService, 'post').mockRejectedValue(new Error('order failed'))
    MockUsePreferenceUtils.setPreferenceValue('topic.tab.display_mode' as never, 'assistant')
    MockUsePreferenceUtils.setPreferenceValue('topic.sort_type' as never, 'orderKey')

    renderTopicList()

    dndMocks.onDragEnd?.({
      active: {
        data: sortableData('item:topic-a'),
        id: 'item:topic-a',
        rect: { current: { initial: null, translated: { top: 100, height: 20 } } }
      },
      over: { data: sortableData('item:topic-d'), id: 'item:topic-d', rect: { top: 10, height: 20 } }
    })

    await vi.waitFor(() =>
      expect(postSpy).toHaveBeenCalledWith('/topics/topic-a/move', {
        body: { assistantId: 'assistant-2', order: { after: 'topic-d' } }
      })
    )
    // A failed atomic move reverts the optimistic overlay and surfaces an error instead of refreshing.
    await vi.waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(topicDataMocks.refreshTopics).not.toHaveBeenCalled()
  })

  it('does not drop topics into the unlinked assistant group for empty assistant ids', () => {
    const patchSpy = vi.spyOn(dataApiService, 'patch').mockResolvedValue(undefined as never)
    MockUsePreferenceUtils.setPreferenceValue('topic.tab.display_mode' as never, 'assistant')
    MockUsePreferenceUtils.setPreferenceValue('topic.sort_type' as never, 'orderKey')
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
    const postSpy = vi.spyOn(dataApiService, 'post').mockResolvedValue(undefined as never)
    MockUsePreferenceUtils.setPreferenceValue('topic.tab.display_mode' as never, 'assistant')
    MockUsePreferenceUtils.setPreferenceValue('topic.sort_type' as never, 'orderKey')
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
      expect(postSpy).toHaveBeenCalledWith('/topics/topic-e/move', {
        body: { assistantId: 'assistant-1', order: { after: 'topic-a' } }
      })
    )
    expect(postSpy).toHaveBeenCalledTimes(1)
    expect(patchSpy).not.toHaveBeenCalled()
  })

  it('does not drop topics into pinned or unlinked assistant groups', () => {
    const patchSpy = vi.spyOn(dataApiService, 'patch').mockResolvedValue(undefined as never)
    MockUsePreferenceUtils.setPreferenceValue('topic.tab.display_mode' as never, 'assistant')
    MockUsePreferenceUtils.setPreferenceValue('topic.sort_type' as never, 'orderKey')
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
