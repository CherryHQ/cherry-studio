import { act, fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

const topicDataMocks = vi.hoisted(() => ({
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

vi.mock('@renderer/hooks/useTopicDataApi', async () => {
  const actual = await vi.importActual<typeof TopicDataApiModule>('@renderer/hooks/useTopicDataApi')
  return {
    ...actual,
    useTopicMutations: () => ({
      updateTopic: topicDataMocks.updateTopic,
      deleteTopic: topicDataMocks.deleteTopic,
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

vi.mock('@renderer/hooks/useTopic', () => ({
  finishTopicRenaming: vi.fn(),
  getTopicMessages: vi.fn().mockResolvedValue([]),
  startTopicRenaming: vi.fn()
}))

vi.mock('@renderer/services/ApiService', () => ({
  fetchMessagesSummary: vi.fn().mockResolvedValue({ text: 'Auto title' })
}))

vi.mock('@renderer/services/EventService', () => ({
  EVENT_NAMES: {
    ADD_NEW_TOPIC: 'ADD_NEW_TOPIC',
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
      if (key === 'chat.topics.title') return 'Topics'
      if (key === 'chat.topics.list') return 'Topic List'
      if (key === 'chat.topics.display.title') return 'Display mode'
      if (key === 'chat.topics.display.time') return 'Time'
      if (key === 'chat.topics.display.assistant') return 'Assistant'
      if (key === 'chat.topics.group.today') return 'Today'
      if (key === 'chat.topics.group.yesterday') return 'Yesterday'
      if (key === 'chat.topics.group.this_week') return 'This week'
      if (key === 'chat.topics.group.earlier') return 'Earlier'
      if (key === 'chat.topics.group.unknown_assistant') return 'Unknown Assistant'
      if (key === 'chat.topics.group.show_more') return 'Show more topics'
      if (key === 'chat.topics.group.collapse') return 'Collapse topics'
      if (key === 'chat.topics.search.placeholder') return 'Search topics'
      if (key === 'chat.topics.search.title') return 'Search topics'
      if (key === 'chat.topics.manage.title') return 'Manage topics'
      if (key === 'chat.topics.pin') return 'Pin Topic'
      if (key === 'chat.topics.unpin') return 'Unpin Topic'
      if (key === 'chat.topics.auto_rename') return 'Generate topic name'
      if (key === 'chat.topics.edit.title') return 'Edit topic name'
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
      if (key === 'chat.topics.export.md.label') return 'Export as Markdown'
      if (key === 'chat.topics.export.md.reason') return 'Export as Markdown with Reasoning'
      if (key === 'chat.topics.export.word') return 'Export as Word'
      if (key === 'chat.topics.export.notion') return 'Export to Notion'
      if (key === 'chat.topics.export.yuque') return 'Export to Yuque'
      if (key === 'chat.topics.export.obsidian') return 'Export to Obsidian'
      if (key === 'chat.topics.export.joplin') return 'Export to Joplin'
      if (key === 'chat.topics.export.siyuan') return 'Export to Siyuan'
      if (key === 'common.delete') return 'Delete'
      if (key === 'common.cancel') return 'Cancel'
      if (key === 'common.name') return 'Name'
      if (key === 'common.required_field') return 'Required field'
      if (key === 'common.save') return 'Save'
      if (key === 'chat.topics.manage.delete.confirm.title') return 'Delete Topics'
      if (key === 'chat.topics.manage.delete.confirm.content') return `Delete ${options?.count ?? 0} topic(s)?`
      if (key === 'chat.add.topic.title') return 'New Topic'
      if (key === 'chat.default.name') return 'Default Assistant'
      if (key === 'common.prompt') return 'Prompt'
      if (key === 'history.records.title') return 'Topic History'
      if (key === 'settings.topic.position.label') return 'Topic position'
      if (key === 'chat.topics.delete.shortcut') return `Hold ${options?.key ?? 'Ctrl'} to delete directly`
      return key
    }
  })
}))

import { cacheService } from '@data/CacheService'
import { dataApiService } from '@data/DataApiService'
import type { ResourceListRevealRequest } from '@renderer/components/chat/resources'
import type * as TopicDataApiModule from '@renderer/hooks/useTopicDataApi'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import type { Topic } from '@renderer/types'
import type { Pin } from '@shared/data/types/pin'
import type { Topic as ApiTopic } from '@shared/data/types/topic'

import {
  mockUseInfiniteQuery,
  mockUseMutation,
  mockUseQuery
} from '../../../../../../../../tests/__mocks__/renderer/useDataApi'
import { MockUsePreferenceUtils } from '../../../../../../../../tests/__mocks__/renderer/usePreference'
import { Topics } from '../Topics'
import { applyOptimisticTopicDisplayMove } from '../Topics.helpers'

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

function renderTopicList({
  onOpenHistory,
  revealRequest
}: {
  onOpenHistory?: () => void
  revealRequest?: ResourceListRevealRequest
} = {}) {
  const setActiveTopic = vi.fn()
  const renderNode = (nextRevealRequest = revealRequest) => (
    <Topics
      activeTopic={createRendererTopic()}
      setActiveTopic={setActiveTopic}
      position="left"
      onOpenHistory={onOpenHistory}
      revealRequest={nextRevealRequest}
    />
  )
  const view = render(renderNode())
  return {
    ...view,
    rerenderTopicList: (nextRevealRequest = revealRequest) => view.rerender(renderNode(nextRevealRequest)),
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

const topicStreamStatusCacheKey = (topicId: string) => `topic.stream.statuses.${topicId}` as never
const topicStreamSeenCacheKey = (topicId: string) => `topic.stream.seen.${topicId}` as never

function setTopicStreamCacheStatus(topicId: string, status: 'done' | 'pending' | 'streaming') {
  cacheService.setShared(topicStreamStatusCacheKey(topicId), { status } as never)
  cacheService.set(topicStreamSeenCacheKey(topicId), false as never)
}

function clearTopicStreamCache(...topicIds: string[]) {
  for (const topicId of topicIds) {
    cacheService.deleteShared(topicStreamStatusCacheKey(topicId))
    cacheService.delete(topicStreamSeenCacheKey(topicId))
  }
}

describe('Topics', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.assign(window, {
      toast: {
        error: vi.fn(),
        success: vi.fn(),
        warning: vi.fn()
      }
    })
    topicStreamStatusMocks.statuses.clear()
    clearTopicStreamCache('topic-a', 'topic-b', 'topic-c', 'topic-d', 'topic-e')
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date(2026, 0, 3, 12))
    MockUsePreferenceUtils.resetMocks()
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'topic.tab.pin_to_top': true,
      'topic.tab.display_mode': 'time',
      'topic.tab.collapsed_group_ids': [],
      'topic.tab.show_time': false,
      'topic.position': 'left',
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
    mockUseMutation.mockImplementation((method, path) => {
      if (method === 'POST' && path === '/pins') {
        return { trigger: pinMutationMocks.createPin, isLoading: false, error: undefined }
      }
      if (method === 'DELETE' && path === '/pins/:id') {
        return { trigger: pinMutationMocks.deletePin, isLoading: false, error: undefined }
      }
      return { trigger: vi.fn(), isLoading: false, error: undefined }
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

  it('renders pinned and time groups, searches topics, and protects pinned rows from inline delete', () => {
    const { getByText, setActiveTopic } = renderTopicList()

    expect(screen.getByText('Pinned')).toBeInTheDocument()
    expect(screen.getByText('Today')).toBeInTheDocument()
    expect(screen.getByText('Yesterday')).toBeInTheDocument()
    expect(screen.getByText('This week')).toBeInTheDocument()
    expect(screen.getByText('Earlier')).toBeInTheDocument()
    expect(screen.getByText('Beta pinned')).toBeInTheDocument()
    const pinnedRow = getByText('Beta pinned').closest('[data-testid="topic-list-row"]')
    const unpinButton = pinnedRow?.querySelector('[aria-label="Unpin Topic"]')
    expect(unpinButton ?? null).toBeInTheDocument()
    expect(unpinButton).not.toHaveAttribute('data-active')
    expect(pinnedRow?.querySelector('[aria-label="Delete"]') ?? null).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Gamma topic'))
    expect(setActiveTopic).toHaveBeenCalledWith(expect.objectContaining({ id: 'topic-c' }))

    fireEvent.change(screen.getByPlaceholderText('Search topics'), { target: { value: 'gamma' } })

    expect(screen.queryByText('Alpha topic')).not.toBeInTheDocument()
    expect(screen.getByText('Gamma topic')).toBeInTheDocument()
  })

  it('pins from the leading row button without selecting the topic', async () => {
    const { getByText, setActiveTopic } = renderTopicList()

    const alphaRow = getByText('Alpha topic').closest('[data-testid="topic-list-row"]')
    const pinButton = alphaRow?.querySelector('[aria-label="Pin Topic"]')
    expect(pinButton ?? null).toBeInTheDocument()

    fireEvent.click(pinButton as Element)

    await vi.waitFor(() =>
      expect(pinMutationMocks.createPin).toHaveBeenCalledWith({
        body: { entityType: 'topic', entityId: 'topic-a' }
      })
    )
    expect(setActiveTopic).not.toHaveBeenCalled()
  })

  it('unpins from the leading row button', async () => {
    const { getByText } = renderTopicList()

    const betaRow = getByText('Beta pinned').closest('[data-testid="topic-list-row"]')
    const unpinButton = betaRow?.querySelector('[aria-label="Unpin Topic"]')
    expect(unpinButton ?? null).toBeInTheDocument()

    fireEvent.click(unpinButton as Element)

    await vi.waitFor(() => expect(pinMutationMocks.deletePin).toHaveBeenCalledWith({ params: { id: 'pin-topic-b' } }))
  })

  it('moves a topic into the pinned group immediately after pinning without refreshing topics', async () => {
    pinMutationMocks.createPin.mockResolvedValue(createTopicPin())

    const { getByText, rerenderTopicList } = renderTopicList()
    fireEvent.click(screen.getByRole('button', { name: 'Pinned' }))
    expect(screen.queryByText('Alpha topic')).toBeInTheDocument()

    const alphaRow = getByText('Alpha topic').closest('[data-testid="topic-list-row"]')
    fireEvent.click(alphaRow?.querySelector('[aria-label="Pin Topic"]') as Element)
    await vi.waitFor(() => expect(pinMutationMocks.createPin).toHaveBeenCalled())

    expect(topicDataMocks.refreshTopics).not.toHaveBeenCalled()
    expect(screen.queryByText('Alpha topic')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Pinned' }))
    rerenderTopicList()
    expect(screen.getByText('Alpha topic')).toBeInTheDocument()
  })

  it('keeps pin actions in the topic context menu and removes topic position actions', () => {
    const { getByText } = renderTopicList()

    const alphaMenu = getByText('Alpha topic').closest('[data-testid="context-menu"]')
    const menuContent = alphaMenu?.querySelector('[data-testid="context-menu-content"]')

    expect(menuContent ?? null).toBeInTheDocument()
    expect(menuContent).toHaveTextContent('Pin Topic')
    expect(menuContent).not.toHaveTextContent('Unpin Topic')
    expect(menuContent).not.toHaveTextContent('Topic position')
  })

  it('groups topic context menu actions and marks delete as destructive', () => {
    const { getByText } = renderTopicList()

    const alphaMenu = getByText('Alpha topic').closest('[data-testid="context-menu"]')
    const menuContent = alphaMenu?.querySelector('[data-testid="context-menu-content"]')
    expect(menuContent ?? null).toBeInTheDocument()

    expect(Array.from(menuContent?.querySelectorAll('[data-testid="context-menu-separator"]') ?? [])).toHaveLength(2)
    expect(Array.from(menuContent?.children ?? []).map((child) => child.textContent)).toEqual([
      'Generate topic name',
      'Edit topic name',
      'Pin Topic',
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

  it('renames a topic from the shared context menu dialog', async () => {
    const { getByText } = renderTopicList()

    const alphaMenu = getByText('Alpha topic').closest('[data-testid="context-menu"]')
    const menuContent = alphaMenu?.querySelector('[data-testid="context-menu-content"]')
    fireEvent.click(within(menuContent as HTMLElement).getByRole('button', { name: 'Edit topic name' }))

    expect(topicDataMocks.updateTopic).not.toHaveBeenCalled()

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('Edit topic name')
    const input = within(dialog).getByLabelText('Name')
    expect(topicDataMocks.updateTopic).not.toHaveBeenCalled()

    fireEvent.change(input, { target: { value: 'Renamed topic' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await vi.waitFor(() =>
      expect(topicDataMocks.updateTopic).toHaveBeenCalledWith('topic-a', {
        name: 'Renamed topic',
        isNameManuallyEdited: true
      })
    )
  })

  it('autofocuses inline rename when double-clicking a topic title', () => {
    const { getByText } = renderTopicList()

    fireEvent.doubleClick(getByText('Alpha topic'))

    const input = screen.getByLabelText('Edit topic name')
    expect(input).toHaveFocus()
    expect(topicDataMocks.updateTopic).not.toHaveBeenCalled()
  })

  it('confirms topic deletion from the shared context menu before deleting', async () => {
    const { getByText } = renderTopicList()

    const alphaMenu = getByText('Alpha topic').closest('[data-testid="context-menu"]')
    const menuContent = alphaMenu?.querySelector('[data-testid="context-menu-content"]')
    fireEvent.click(within(menuContent as HTMLElement).getByRole('button', { name: 'Delete' }))

    expect(screen.getByRole('dialog')).toHaveTextContent('Delete Topics')
    expect(topicDataMocks.deleteTopic).not.toHaveBeenCalled()

    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }))

    await vi.waitFor(() => expect(topicDataMocks.deleteTopic).toHaveBeenCalledWith('topic-a'))
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
    expect(indicator).toHaveClass('bg-(--color-status-warning)')
    expect(topicRow.querySelector('[data-deleting]')).not.toBeInTheDocument()
    expect(topicStreamStatusMocks.markSeen).not.toHaveBeenCalled()

    setTopicStreamCacheStatus('topic-c', 'done')
    view.unmount()
    view = renderTopicList()
    setActiveTopic = view.setActiveTopic

    topicRow = getTopicRow('Gamma topic')
    indicator = topicRow.querySelector('[data-testid="topic-stream-indicator"] .animation-pulse')
    expect(indicator).toHaveClass('bg-(--color-status-success)')
    expect(topicRow.querySelector('[data-deleting]')).not.toBeInTheDocument()

    fireEvent.click(topicRow)
    expect(setActiveTopic).toHaveBeenCalledWith(expect.objectContaining({ id: 'topic-c' }))
    expect(topicStreamStatusMocks.markSeen).not.toHaveBeenCalled()

    clearTopicStreamCache('topic-c')
    view.unmount()
    view = renderTopicList()

    topicRow = getTopicRow('Gamma topic')
    expect(topicRow.querySelector('[data-testid="topic-stream-indicator"]')).not.toBeInTheDocument()
    expect(topicRow.querySelector('[data-deleting]')).toBeInTheDocument()
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

    fireEvent.click(screen.getByRole('button', { name: 'Show more topics' }))

    expect(screen.getByText('Topic 10')).toBeInTheDocument()
    expect(screen.queryByText('Topic 11')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Show more topics' }))

    expect(screen.getByText('Topic 11')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Collapse topics' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Collapse topics' }))

    expect(screen.getByText('Topic 5')).toBeInTheDocument()
    expect(screen.queryByText('Topic 6')).not.toBeInTheDocument()
  })

  it('keeps the pinned group first and lets each group collapse independently', () => {
    const { rerenderTopicList } = renderTopicList()

    const groupButtons = screen.getAllByRole('button', { expanded: true })
    expect(groupButtons.map((button) => button.textContent)).toEqual([
      'Pinned',
      'Today',
      'Yesterday',
      'This week',
      'Earlier'
    ])
    expect(screen.getByRole('button', { name: 'Pinned' }).querySelector('.lucide-chevron-down')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pinned' }).querySelector('.lucide-chevron-down')).not.toHaveClass(
      '-rotate-90'
    )
    expect(screen.getByRole('button', { name: 'Today' }).querySelector('.lucide-chevron-down')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Pinned' }))
    rerenderTopicList()

    expect(screen.getByRole('button', { name: 'Pinned' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('button', { name: 'Pinned' }).querySelector('.lucide-chevron-down')).toHaveClass(
      '-rotate-90'
    )
    expect(screen.queryByText('Beta pinned')).not.toBeInTheDocument()
    expect(screen.getByText('Alpha topic')).toBeInTheDocument()
  })

  it('restores and persists collapsed topic groups from preference', () => {
    MockUsePreferenceUtils.setPreferenceValue('topic.tab.collapsed_group_ids' as never, ['topic:time:today'])

    const { rerenderTopicList } = renderTopicList()

    expect(screen.getByRole('button', { name: 'Today' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('button', { name: 'Today' }).querySelector('.lucide-chevron-down')).toHaveClass(
      '-rotate-90'
    )
    expect(screen.queryByText('Alpha topic')).not.toBeInTheDocument()
    expect(screen.getByText('Beta pinned')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Today' }))
    expect(MockUsePreferenceUtils.getPreferenceValue('topic.tab.collapsed_group_ids' as never)).toEqual([])
    rerenderTopicList()
    expect(screen.getByRole('button', { name: 'Today' }).querySelector('.lucide-chevron-down')).not.toHaveClass(
      '-rotate-90'
    )

    fireEvent.click(screen.getByRole('button', { name: 'Pinned' }))
    expect(MockUsePreferenceUtils.getPreferenceValue('topic.tab.collapsed_group_ids' as never)).toEqual([
      'topic:pinned'
    ])
  })

  it('renders the topic header controls and persists display mode selection', () => {
    renderTopicList()

    expect(screen.getByText('Topics')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Search topics')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Display mode'))

    expect(screen.getByTestId('popover-content')).toHaveClass('w-28', 'p-1')
    expect(screen.getByText('Display mode')).toHaveClass('text-[10px]')
    expect(screen.getByRole('button', { name: 'Time' })).toHaveClass('h-6', 'text-[11px]', 'font-normal')
    expect(screen.getByRole('button', { name: 'Time' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Assistant' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Assistant' }))
    expect(MockUsePreferenceUtils.getPreferenceValue('topic.tab.display_mode' as never)).toBe('assistant')

    fireEvent.click(screen.getByLabelText('Display mode'))
    fireEvent.click(screen.getByRole('button', { name: 'Time' }))
    expect(MockUsePreferenceUtils.getPreferenceValue('topic.tab.display_mode' as never)).toBe('time')
  })

  it('opens topic history from the trailing header action when provided', () => {
    const onOpenHistory = vi.fn()

    renderTopicList({ onOpenHistory })

    const historyButton = screen.getByLabelText('Topic History')
    vi.spyOn(historyButton, 'getBoundingClientRect').mockReturnValue({
      x: 10,
      y: 20,
      width: 30,
      height: 40
    } as DOMRect)

    fireEvent.click(historyButton)

    expect(onOpenHistory).toHaveBeenCalledTimes(1)
    expect(onOpenHistory).toHaveBeenCalledWith({ x: 10, y: 20, width: 30, height: 40 })
  })

  it('reveals a history-selected topic hidden by manage search, a collapsed group, and show-more', async () => {
    MockUsePreferenceUtils.setPreferenceValue('topic.tab.collapsed_group_ids' as never, ['topic:time:today'])
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

    expect(screen.getByRole('button', { name: 'Today' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Topic 6')).not.toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Manage topics'))
    const manageSearchButton = document.querySelector('[data-title="Search topics"] button')
    expect(manageSearchButton).toBeInTheDocument()
    fireEvent.click(manageSearchButton as HTMLElement)
    const manageSearch = screen.getAllByPlaceholderText('Search topics').at(-1)
    expect(manageSearch).toBeInTheDocument()
    fireEvent.change(manageSearch as HTMLElement, { target: { value: 'missing' } })
    expect(screen.queryByText('Topic 6')).not.toBeInTheDocument()

    rerenderTopicList({ itemId: 'topic-6', requestId: 1, clearFilters: true, clearQuery: true })

    expect(await screen.findByText('Topic 6')).toBeInTheDocument()
    const revealedRow = screen.getByText('Topic 6').closest('[role="option"]')
    expect(revealedRow).not.toBeNull()
    expect(revealedRow!).toHaveAttribute('data-reveal-focus', 'true')
    expect(revealedRow!).toHaveClass('animation-resource-list-reveal-focus')
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Today' })).toHaveAttribute('aria-expanded', 'true')
    expect(MockUsePreferenceUtils.getPreferenceValue('topic.tab.collapsed_group_ids' as never)).toEqual([])
    expect(virtualMocks.scrollToIndex).toHaveBeenCalledWith(expect.any(Number), { align: 'center' })
  })

  it('adds a new topic from the search-area create bar', () => {
    renderTopicList()

    const createButton = screen.getAllByRole('button', { name: 'New Topic' })[0]
    expect(createButton).toHaveClass('h-7', 'w-full', 'justify-start', 'rounded-md', 'text-[12px]')
    expect(createButton).not.toHaveClass('border')
    expect(screen.getByRole('listbox')).toHaveClass('pt-0')

    fireEvent.click(createButton)

    expect(EventEmitter.emit).toHaveBeenCalledWith(EVENT_NAMES.ADD_NEW_TOPIC)
  })

  it('renders group create action only on the today group when grouped by time', () => {
    renderTopicList()

    const todayHeader = screen.getByRole('button', { name: 'Today' }).closest('div')
    expect(todayHeader).toBeInTheDocument()

    const todayCreateButton = within(todayHeader as HTMLElement).getByRole('button', { name: 'New Topic' })
    const todayCreateActionWrapper = Array.from((todayHeader as HTMLElement).querySelectorAll('div')).find((element) =>
      element.className.includes('group-hover/resource-list-group:opacity-100')
    )
    expect(todayCreateActionWrapper).toHaveClass(
      'opacity-0',
      'group-hover/resource-list-group:opacity-100',
      'focus-within:opacity-100'
    )
    fireEvent.click(todayCreateButton)

    expect(EventEmitter.emit).toHaveBeenCalledWith(EVENT_NAMES.ADD_NEW_TOPIC)

    const otherGroups = ['Pinned', 'Yesterday', 'This week', 'Earlier'] as const
    for (const groupName of otherGroups) {
      const header = screen.getByRole('button', { name: groupName }).closest('div')
      expect(header).toBeInTheDocument()
      expect(within(header as HTMLElement).queryByRole('button', { name: 'New Topic' })).not.toBeInTheDocument()
    }

    expect(EventEmitter.emit).toHaveBeenCalledTimes(1)
  })

  it('does not enable drag reorder in time mode', () => {
    const patchSpy = vi.spyOn(dataApiService, 'patch').mockResolvedValue(undefined as never)

    renderTopicList()

    expect(screen.queryByTestId('dnd-context')).not.toBeInTheDocument()
    dndMocks.onDragEnd?.({ active: { id: 'topic-a' }, over: { id: 'topic-c' } })

    expect(patchSpy).not.toHaveBeenCalled()
  })

  it('deletes from a filtered manage view without persisting topic order', async () => {
    const patchSpy = vi.spyOn(dataApiService, 'patch').mockResolvedValue(undefined as never)
    const confirm = vi.fn().mockResolvedValue(true)
    const toast = {
      error: vi.fn(),
      success: vi.fn(),
      warning: vi.fn()
    }
    Object.assign(window, { modal: { confirm }, toast })

    renderTopicList()

    fireEvent.click(screen.getByLabelText('Manage topics'))
    fireEvent.change(screen.getByPlaceholderText('Search topics'), { target: { value: 'gamma' } })

    await vi.waitFor(() => {
      expect(screen.queryByText('Alpha topic')).not.toBeInTheDocument()
      expect(screen.getByText('Gamma topic')).toBeInTheDocument()
    })

    fireEvent.click(getTopicRow('Gamma topic'))

    const deleteTooltip = screen
      .getAllByTestId('tooltip')
      .filter((tooltip) => tooltip.getAttribute('data-title') === 'Delete')
      .at(-1)
    expect(deleteTooltip).toBeInTheDocument()

    fireEvent.click(within(deleteTooltip as HTMLElement).getByRole('button'))

    await vi.waitFor(() => expect(topicDataMocks.deleteTopic).toHaveBeenCalledWith('topic-c'))
    expect(confirm).toHaveBeenCalled()
    expect(patchSpy).not.toHaveBeenCalled()
  })

  it('renders assistant groups and creates topics with the selected assistant payload', () => {
    MockUsePreferenceUtils.setPreferenceValue('topic.tab.display_mode' as never, 'assistant')
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

    renderTopicList()

    expect(screen.getByRole('button', { name: 'Pinned' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Default Assistant' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Alpha Assistant' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Beta Assistant' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Unknown Assistant' })).toBeInTheDocument()

    const defaultHeader = screen.getByRole('button', { name: 'Default Assistant' }).closest('div')
    expect(defaultHeader).toBeInTheDocument()
    fireEvent.click(within(defaultHeader as HTMLElement).getByRole('button', { name: 'New Topic' }))
    expect(EventEmitter.emit).toHaveBeenCalledWith(EVENT_NAMES.ADD_NEW_TOPIC, { assistantId: null })

    const assistantHeader = screen.getByRole('button', { name: 'Alpha Assistant' }).closest('div')
    expect(assistantHeader).toBeInTheDocument()
    fireEvent.click(within(assistantHeader as HTMLElement).getByRole('button', { name: 'New Topic' }))
    expect(EventEmitter.emit).toHaveBeenCalledWith(EVENT_NAMES.ADD_NEW_TOPIC, { assistantId: 'assistant-1' })

    for (const groupName of ['Pinned', 'Unknown Assistant'] as const) {
      const header = screen.getByRole('button', { name: groupName }).closest('div')
      expect(header).toBeInTheDocument()
      expect(within(header as HTMLElement).queryByRole('button', { name: 'New Topic' })).not.toBeInTheDocument()
    }
  })

  it('persists assistant group collapse state without affecting time groups', () => {
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'topic.tab.display_mode': 'assistant',
      'topic.tab.collapsed_group_ids': ['topic:time:today', 'topic:assistant:assistant-1']
    })

    renderTopicList()

    expect(screen.getByRole('button', { name: 'Alpha Assistant' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Alpha topic')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Beta Assistant' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Gamma topic')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Alpha Assistant' }))
    expect(MockUsePreferenceUtils.getPreferenceValue('topic.tab.collapsed_group_ids' as never)).toEqual([
      'topic:time:today'
    ])
  })

  it('moves only the active topic in the optimistic display overlay without rewriting order keys', () => {
    const topics = [
      createRendererTopic({ id: 'topic-a', name: 'Known alpha', assistantId: 'assistant-1', orderKey: 'a' }),
      createRendererTopic({ id: 'topic-c', name: 'Known beta', assistantId: 'assistant-2', orderKey: 'c' }),
      createRendererTopic({ id: 'topic-d', name: 'Beta tail', assistantId: 'assistant-2', orderKey: 'd' })
    ]
    const groupBy = (topic: Topic) => ({
      id: topic.assistantId ? `topic:assistant:${topic.assistantId}` : 'topic:assistant:default',
      label: topic.assistantId ?? 'default'
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
      expect(patchSpy).toHaveBeenCalledWith('/topics/topic-d/order', { body: { after: 'topic-c' } })
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
      expect(patchSpy).toHaveBeenCalledWith('/topics/topic-c/order', { body: { after: 'topic-a' } })
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
      expect(patchSpy).toHaveBeenCalledWith('/topics/topic-d/order', { body: { after: 'topic-c' } })
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
      expect(rowTexts.findIndex((text) => text.includes('Alpha topic'))).toBeGreaterThan(
        rowTexts.findIndex((text) => text.includes('Delta archive'))
      )
      expect(rowTexts.findIndex((text) => text.includes('Alpha topic'))).toBeLessThan(
        rowTexts.findIndex((text) => text.includes('Gamma topic'))
      )
    })
    await vi.waitFor(() =>
      expect(patchSpy).toHaveBeenNthCalledWith(1, '/topics/topic-a', { body: { assistantId: 'assistant-2' } })
    )
    expect(patchSpy).toHaveBeenNthCalledWith(2, '/topics/topic-a/order', { body: { before: 'topic-d' } })
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
    expect(patchSpy).toHaveBeenNthCalledWith(2, '/topics/topic-a/order', { body: { before: 'topic-d' } })
    await vi.waitFor(() => expect(topicDataMocks.refreshTopics).toHaveBeenCalledTimes(1))
  })

  it('moves topics into the default assistant group with a null assistantId', async () => {
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

    await vi.waitFor(() =>
      expect(patchSpy).toHaveBeenNthCalledWith(1, '/topics/topic-a', { body: { assistantId: null } })
    )
    expect(patchSpy).toHaveBeenNthCalledWith(2, '/topics/topic-a/order', { body: { before: 'topic-c' } })
  })

  it('allows unknown assistant topics to move into known assistant groups', async () => {
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
    expect(patchSpy).toHaveBeenNthCalledWith(2, '/topics/topic-e/order', { body: { before: 'topic-a' } })
  })

  it('does not drop topics into pinned or unknown assistant groups', () => {
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
