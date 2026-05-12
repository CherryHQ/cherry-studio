import { fireEvent, render, screen, within } from '@testing-library/react'
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
    scrollElement: null
  }))
}))

const dndMocks = vi.hoisted(() => ({
  onDragEnd: undefined as undefined | ((event: any) => void)
}))

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: virtualMocks.useVirtualizer
}))

vi.mock('@dnd-kit/core', () => {
  const React = require('react')
  return {
    DndContext: ({ children, onDragEnd }: { children: ReactNode; onDragEnd?: any }) => {
      dndMocks.onDragEnd = onDragEnd
      return React.createElement('div', { 'data-testid': 'dnd-context' }, children)
    },
    KeyboardSensor: vi.fn(),
    PointerSensor: vi.fn(),
    useSensor: vi.fn((sensor, options) => ({ sensor, options })),
    useSensors: vi.fn((...sensors) => sensors)
  }
})

vi.mock('@dnd-kit/sortable', () => {
  const React = require('react')
  return {
    SortableContext: ({ children }: { children: ReactNode }) =>
      React.createElement('div', { 'data-testid': 'sortable-context' }, children),
    useSortable: ({ id }: { id: string }) => ({
      attributes: { 'data-sortable-id': id },
      listeners: {},
      setNodeRef: vi.fn(),
      transform: null,
      transition: undefined,
      isDragging: false
    }),
    verticalListSortingStrategy: {}
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
  useTopicStreamStatus: () => ({ isPending: false, isFulfilled: false })
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
      if (key === 'chat.topics.display.tag') return 'Tag'
      if (key === 'chat.topics.group.today') return 'Today'
      if (key === 'chat.topics.group.yesterday') return 'Yesterday'
      if (key === 'chat.topics.group.this_week') return 'This week'
      if (key === 'chat.topics.group.earlier') return 'Earlier'
      if (key === 'chat.topics.group.show_more') return 'Show more topics'
      if (key === 'chat.topics.group.collapse') return 'Collapse topics'
      if (key === 'chat.topics.search.placeholder') return 'Search topics'
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
      if (key === 'chat.add.topic.title') return 'New Topic'
      if (key === 'common.prompt') return 'Prompt'
      if (key === 'settings.topic.position.label') return 'Topic position'
      if (key === 'chat.topics.delete.shortcut') return `Hold ${options?.key ?? 'Ctrl'} to delete directly`
      return key
    }
  })
}))

import { dataApiService } from '@data/DataApiService'
import type * as TopicDataApiModule from '@renderer/hooks/useTopicDataApi'
import type { Topic } from '@renderer/types'
import type { Topic as ApiTopic } from '@shared/data/types/topic'

import { mockUseInfiniteQuery, mockUseQuery } from '../../../../../../../../tests/__mocks__/renderer/useDataApi'
import { MockUsePreferenceUtils } from '../../../../../../../../tests/__mocks__/renderer/usePreference'
import { TopicListV2 } from '../TopicListV2'

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

function renderTopicList() {
  const setActiveTopic = vi.fn()
  const view = render(
    <TopicListV2 activeTopic={createRendererTopic()} setActiveTopic={setActiveTopic} position="left" />
  )
  return { ...view, setActiveTopic }
}

describe('TopicListV2', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date(2026, 0, 3, 12))
    MockUsePreferenceUtils.resetMocks()
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'topic.tab.pin_to_top': true,
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
    const pinnedRow = getByText('Beta pinned').closest('[data-testid="topic-list-v2-row"]')
    expect(pinnedRow?.querySelector('[aria-label="Unpin Topic"]') ?? null).toBeInTheDocument()
    expect(pinnedRow?.querySelector('[aria-label="common.delete"]') ?? null).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Gamma topic'))
    expect(setActiveTopic).toHaveBeenCalledWith(expect.objectContaining({ id: 'topic-c' }))

    fireEvent.change(screen.getByPlaceholderText('Search topics'), { target: { value: 'gamma' } })

    expect(screen.queryByText('Alpha topic')).not.toBeInTheDocument()
    expect(screen.getByText('Gamma topic')).toBeInTheDocument()
  })

  it('toggles pin from the leading row button without selecting the topic', () => {
    const postSpy = vi.spyOn(dataApiService, 'post').mockResolvedValue(undefined as never)
    const deleteSpy = vi.spyOn(dataApiService, 'delete').mockResolvedValue({ deleted: true } as never)
    const { getByText, setActiveTopic } = renderTopicList()

    const alphaRow = getByText('Alpha topic').closest('[data-testid="topic-list-v2-row"]')
    const pinButton = alphaRow?.querySelector('[aria-label="Pin Topic"]')
    expect(pinButton ?? null).toBeInTheDocument()

    fireEvent.click(pinButton as Element)

    expect(postSpy).toHaveBeenCalledWith('/pins', { body: { entityType: 'topic', entityId: 'topic-a' } })
    expect(setActiveTopic).not.toHaveBeenCalled()

    const betaRow = getByText('Beta pinned').closest('[data-testid="topic-list-v2-row"]')
    const unpinButton = betaRow?.querySelector('[aria-label="Unpin Topic"]')
    expect(unpinButton ?? null).toBeInTheDocument()

    fireEvent.click(unpinButton as Element)

    expect(deleteSpy).toHaveBeenCalledWith('/pins/pin-topic-b')
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

  it('keeps topic rows compact and only renders the title field in the sidebar list', () => {
    renderTopicList()

    expect(screen.getByText('Alpha topic')).toBeInTheDocument()
    expect(screen.queryByText('2026/01/03 01:00')).not.toBeInTheDocument()
    expect(screen.queryByText('2026/01/02 01:00')).not.toBeInTheDocument()
    expect(screen.queryByText('2025/12/31 01:00')).not.toBeInTheDocument()
    expect(screen.queryByText(/^Prompt:/)).not.toBeInTheDocument()
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
    renderTopicList()

    const groupButtons = screen.getAllByRole('button', { expanded: true })
    expect(groupButtons.map((button) => button.textContent)).toEqual([
      'Pinned',
      'Today',
      'Yesterday',
      'This week',
      'Earlier'
    ])

    fireEvent.click(screen.getByRole('button', { name: 'Pinned' }))

    expect(screen.getByRole('button', { name: 'Pinned' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Beta pinned')).not.toBeInTheDocument()
    expect(screen.getByText('Alpha topic')).toBeInTheDocument()
  })

  it('renders the topic header controls for the UI-only display mode phase', () => {
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
    expect(screen.getByRole('button', { name: 'Tag' })).toBeInTheDocument()
  })

  it('sends fractional order patch through ResourceList drag payload', () => {
    const patchSpy = vi.spyOn(dataApiService, 'patch').mockResolvedValue(undefined as never)

    renderTopicList()
    dndMocks.onDragEnd?.({ active: { id: 'topic-a' }, over: { id: 'topic-c' } })

    expect(patchSpy).toHaveBeenCalledWith('/topics/order:batch', {
      body: {
        moves: [
          { id: 'topic-e', anchor: { after: 'topic-b' } },
          { id: 'topic-c', anchor: { after: 'topic-e' } },
          { id: 'topic-a', anchor: { after: 'topic-c' } }
        ]
      }
    })
  })

  it('keeps display mode logic as a TODO and does not fetch assistant or tag data yet', () => {
    renderTopicList()

    fireEvent.click(screen.getByLabelText('Display mode'))
    fireEvent.click(screen.getByRole('button', { name: 'Assistant' }))

    expect(MockUsePreferenceUtils.getPreferenceValue('topic.tab.display_mode' as never)).toBeNull()
    expect(mockUseQuery).not.toHaveBeenCalledWith('/assistants', expect.anything())
    expect(mockUseQuery).not.toHaveBeenCalledWith('/tags')
    expect(dataApiService.get).not.toHaveBeenCalledWith(expect.stringContaining('/tags/entities/topic/'))
  })
})
