import type { Assistant } from '@shared/data/types/assistant'
import type { Topic } from '@shared/data/types/topic'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import enUS from '../../../i18n/locales/en-us.json'
import zhCN from '../../../i18n/locales/zh-cn.json'
import zhTW from '../../../i18n/locales/zh-tw.json'
import deDE from '../../../i18n/translate/de-de.json'
import elGR from '../../../i18n/translate/el-gr.json'
import esES from '../../../i18n/translate/es-es.json'
import frFR from '../../../i18n/translate/fr-fr.json'
import jaJP from '../../../i18n/translate/ja-jp.json'
import ptPT from '../../../i18n/translate/pt-pt.json'
import roRO from '../../../i18n/translate/ro-ro.json'
import ruRU from '../../../i18n/translate/ru-ru.json'
import viVN from '../../../i18n/translate/vi-vn.json'

const hookMocks = vi.hoisted(() => ({
  deleteTopic: vi.fn(),
  deleteTopics: vi.fn(),
  batchUpdateTopics: vi.fn(),
  finishTopicRenaming: vi.fn(),
  getTopicMessages: vi.fn(),
  promptShow: vi.fn(),
  saveToKnowledge: vi.fn(),
  startTopicRenaming: vi.fn(),
  togglePin: vi.fn(),
  updateTopic: vi.fn(),
  openConversationTab: vi.fn(),
  useAgents: vi.fn(),
  useTopics: vi.fn(),
  useAssistants: vi.fn(),
  useCache: vi.fn(),
  useMultiplePreferences: vi.fn(),
  usePins: vi.fn(),
  useSessions: vi.fn(),
  useUpdateSession: vi.fn()
}))

vi.mock('@cherrystudio/ui', async () => {
  const { MockCherrystudioUI } = await import('@test-mocks/renderer/CherrystudioUI')
  return MockCherrystudioUI
})

vi.mock('@renderer/components/VirtualList', () => ({
  DynamicVirtualList: <T,>({
    children,
    header,
    list,
    role
  }: {
    children: (item: T, index: number) => ReactNode
    header?: ReactNode
    list: T[]
    role?: string
  }) => (
    <div data-testid="history-virtual-list" role={role}>
      {header}
      {list.map((item, index) => (
        <div key={(item as { id?: string }).id ?? index}>{children(item, index)}</div>
      ))}
    </div>
  )
}))

vi.mock('@renderer/components/resource/dialogs', () => ({
  ResourceEditDialogHost: ({ target }: { target: { kind: string; id: string } | null }) =>
    target ? <div data-testid="resource-edit-dialog-host" data-kind={target.kind} data-id={target.id} /> : null
}))

vi.mock('@renderer/data/hooks/useCache', () => ({
  useCache: hookMocks.useCache
}))

vi.mock('@renderer/data/hooks/usePreference', () => ({
  usePreference: () => ['cherry', () => {}],
  useMultiplePreferences: hookMocks.useMultiplePreferences
}))

vi.mock('@renderer/hooks/agents/useAgent', () => ({
  useAgents: hookMocks.useAgents
}))

vi.mock('@renderer/hooks/agents/useAgentSessionStreamStatuses', () => ({
  useAgentSessionStreamStatuses: vi.fn(() => new Map())
}))

vi.mock('@renderer/hooks/agents/useSession', () => ({
  useSessions: hookMocks.useSessions,
  useUpdateSession: hookMocks.useUpdateSession
}))

vi.mock('@renderer/hooks/useAssistant', () => ({
  useAssistants: hookMocks.useAssistants
}))

vi.mock('@renderer/hooks/useConversationNavigation', () => ({
  useConversationNavigation: () => ({
    focusExistingTab: vi.fn(),
    openConversationTab: hookMocks.openConversationTab
  })
}))

vi.mock('@renderer/hooks/usePins', () => ({
  usePins: hookMocks.usePins
}))

vi.mock('@renderer/hooks/useTopic', () => ({
  finishTopicRenaming: hookMocks.finishTopicRenaming,
  getTopicMessages: hookMocks.getTopicMessages,
  mapApiTopicToRendererTopic: (topic: Topic) => ({
    id: topic.id,
    assistantId: topic.assistantId,
    name: topic.name ?? '',
    createdAt: topic.createdAt,
    updatedAt: topic.updatedAt,
    orderKey: topic.orderKey,
    messages: [],
    pinned: false,
    isNameManuallyEdited: topic.isNameManuallyEdited
  }),
  useTopics: hookMocks.useTopics,
  useTopicMutations: () => ({
    batchUpdateTopics: hookMocks.batchUpdateTopics,
    deleteTopic: hookMocks.deleteTopic,
    deleteTopics: hookMocks.deleteTopics,
    updateTopic: hookMocks.updateTopic
  }),
  startTopicRenaming: hookMocks.startTopicRenaming
}))

vi.mock('@renderer/hooks/useNotesSettings', () => ({
  useNotesSettings: () => ({ notesPath: '/notes' })
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
  default: { show: hookMocks.promptShow }
}))

vi.mock('@renderer/components/Popups/SaveToKnowledgePopup', () => ({
  default: { showForTopic: hookMocks.saveToKnowledge }
}))

vi.mock('@renderer/utils/copy', () => ({
  copyTopicAsMarkdown: vi.fn(),
  copyTopicAsPlainText: vi.fn()
}))

vi.mock('@renderer/utils/export', () => ({
  exportMarkdownToJoplin: vi.fn(),
  exportMarkdownToSiyuan: vi.fn(),
  exportMarkdownToYuque: vi.fn(),
  exportTopicAsMarkdown: vi.fn(),
  exportTopicToNotes: vi.fn(),
  exportTopicToNotion: vi.fn(),
  topicToMarkdown: vi.fn().mockResolvedValue('# topic')
}))

vi.mock('react-i18next', () => ({
  initReactI18next: {
    init: vi.fn(),
    type: '3rdParty'
  },
  useTranslation: () => ({
    t: (key: string, fallbackOrOptions?: string | Record<string, unknown>, maybeOptions?: Record<string, unknown>) => {
      const labels: Record<string, string> = {
        'chat.default.name': 'Default assistant',
        'chat.default.topic.name': 'New conversation',
        'chat.save.topic.knowledge.menu_title': 'Save to knowledge base',
        'chat.topics.auto_rename': 'Generate conversation name',
        'chat.topics.clear.title': 'Clear messages',
        'chat.topics.copy.image': 'Copy as Image',
        'chat.topics.copy.md': 'Copy as Markdown',
        'chat.topics.copy.plain_text': 'Copy as Plain Text',
        'chat.topics.copy.title': 'Copy',
        'chat.topics.edit.title': 'Edit conversation name',
        'chat.topics.export.image': 'Export as Image',
        'chat.topics.export.joplin': 'Export to Joplin',
        'chat.topics.export.md.label': 'Export as Markdown',
        'chat.topics.export.md.reason': 'Export as Markdown with Reasoning',
        'chat.topics.export.notion': 'Export to Notion',
        'chat.topics.export.obsidian': 'Export to Obsidian',
        'chat.topics.export.siyuan': 'Export to Siyuan',
        'chat.topics.export.title': 'Export',
        'chat.topics.export.word': 'Export as Word',
        'chat.topics.export.yuque': 'Export to Yuque',
        'chat.topics.manage.delete.confirm.content': 'Delete {{count}} conversation(s)?',
        'chat.topics.manage.delete.confirm.title': 'Delete Conversations',
        'chat.topics.pin': 'Pin Conversation',
        'chat.topics.unpin': 'Unpin Conversation',
        'common.all': 'All',
        'common.assistant': 'Assistant',
        'common.back': 'Back',
        'common.cancel': 'Cancel',
        'common.close': 'Close',
        'common.delete': 'Delete',
        'common.more': 'More',
        'common.name': 'Name',
        'common.required_field': 'Required field',
        'common.save': 'Save',
        'common.save_failed': 'Save failed',
        'common.saved': 'Saved',
        'common.select': 'Select',
        'common.select_all': 'Select all',
        'common.unnamed': 'Untitled',
        'history.records.bulkDelete': 'Batch Delete',
        'history.records.bulkDeleteTopics.description': 'Delete {{count}} selected conversation(s)?',
        'history.records.bulkDeleteTopics.title': 'Delete selected conversations',
        'history.records.bulkMove': 'Batch Move',
        'history.records.bulkMoveTopics.confirm': 'Move',
        'history.records.bulkMoveTopics.description':
          'Move {{count}} selected conversation(s) to the target assistant.',
        'history.records.bulkMoveTopics.empty': 'No assistants available',
        'history.records.bulkMoveTopics.error': 'Failed to move conversations',
        'history.records.bulkMoveTopics.partialSuccess':
          'Moved {{moved}} of {{total}} conversation(s); {{failed}} failed',
        'history.records.bulkMoveTopics.placeholder': 'Select assistant',
        'history.records.bulkMoveTopics.success': 'Moved {{count}} conversation(s)',
        'history.records.bulkMoveTopics.target': 'Target assistant',
        'history.records.bulkMoveTopics.title': 'Move selected conversations',
        'history.records.assistantSubtitle': '{{count}} conversations',
        'history.records.empty.description': 'No conversations for the current filters.',
        'history.records.empty.title': 'No conversations',
        'history.records.resultCount': '{{count}} results',
        'history.records.searchTopic': 'Search conversations...',
        'history.records.shortTitle': 'History',
        'history.records.sidebar.searchAssistant': 'Search assistants...',
        'history.records.sidebar.unknownAssistant': 'Unlinked assistant',
        'history.records.table.actions': 'Actions',
        'history.records.table.emptyValue': '-',
        'history.records.table.time': 'Time',
        'history.records.table.title': 'Title',
        'history.records.title': 'Conversation history',
        'notes.save': 'Save to notes',
        'selector.common.pinned_title': 'Pinned'
      }
      const options = typeof fallbackOrOptions === 'object' ? fallbackOrOptions : maybeOptions
      const defaultValue = typeof fallbackOrOptions === 'string' ? fallbackOrOptions : undefined
      const template = labels[key] ?? defaultValue ?? key
      return template
        .replace('{{count}}', String(options?.count ?? ''))
        .replace('{{failed}}', String(options?.failed ?? ''))
        .replace('{{moved}}', String(options?.moved ?? ''))
        .replace('{{total}}', String(options?.total ?? ''))
    }
  })
}))

import HistoryRecordsPage from '../HistoryRecordsPage'

function createTopic(overrides: Partial<Topic> = {}): Topic {
  return {
    id: 'topic-alpha',
    name: 'Alpha topic',
    assistantId: 'assistant-alpha',
    isNameManuallyEdited: false,
    orderKey: 'a',
    createdAt: '2026-05-13T08:00:00.000Z',
    updatedAt: '2026-05-14T08:00:00.000Z',
    ...overrides
  }
}

function createAssistant(overrides: Partial<Assistant> = {}): Assistant {
  return {
    id: 'assistant-alpha',
    name: 'Alpha assistant',
    prompt: '',
    emoji: 'A',
    description: '',
    settings: {
      temperature: 1,
      enableTemperature: false,
      topP: 1,
      enableTopP: false,
      maxTokens: 4096,
      enableMaxTokens: false,
      streamOutput: true,
      reasoning_effort: 'default',
      mcpMode: 'auto',
      maxToolCalls: 20,
      enableMaxToolCalls: true,
      enableWebSearch: false,
      customParameters: []
    },
    modelId: null,
    mcpServerIds: [],
    knowledgeBaseIds: [],
    createdAt: '2026-05-13T08:00:00.000Z',
    updatedAt: '2026-05-14T08:00:00.000Z',
    tags: [],
    modelName: null,
    ...overrides
  } as Assistant
}

const flushAnimationFrame = () => new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
const flushCommandMenuAction = () => new Promise<void>((resolve) => queueMicrotask(resolve))

describe('HistoryRecordsPage assistant mode', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="home-page"></div><div id="agent-page"></div>'
    Object.assign(window, {
      modal: {
        confirm: vi.fn()
      },
      toast: {
        error: vi.fn(),
        success: vi.fn(),
        warning: vi.fn()
      }
    })
    hookMocks.useAgents.mockReset()
    hookMocks.useTopics.mockReset()
    hookMocks.useAssistants.mockReset()
    hookMocks.openConversationTab.mockReset()
    hookMocks.openConversationTab.mockReturnValue('new-history-topic-tab')
    hookMocks.useCache.mockReset()
    hookMocks.useCache.mockReturnValue([[], vi.fn()])
    hookMocks.useMultiplePreferences.mockReset()
    hookMocks.useMultiplePreferences.mockReturnValue([
      {
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
    ])
    hookMocks.deleteTopic.mockReset()
    hookMocks.deleteTopic.mockResolvedValue(undefined)
    hookMocks.deleteTopics.mockReset()
    hookMocks.deleteTopics.mockResolvedValue({ deletedIds: ['topic-alpha'], deletedCount: 1 })
    hookMocks.batchUpdateTopics.mockReset()
    hookMocks.batchUpdateTopics.mockResolvedValue([])
    hookMocks.finishTopicRenaming.mockReset()
    hookMocks.getTopicMessages.mockReset()
    hookMocks.getTopicMessages.mockResolvedValue([])
    hookMocks.promptShow.mockReset()
    hookMocks.saveToKnowledge.mockReset()
    hookMocks.startTopicRenaming.mockReset()
    hookMocks.togglePin.mockReset()
    hookMocks.togglePin.mockResolvedValue(undefined)
    hookMocks.updateTopic.mockReset()
    hookMocks.updateTopic.mockResolvedValue(undefined)
    hookMocks.usePins.mockReset()
    hookMocks.usePins.mockReturnValue({ pinnedIds: [], togglePin: hookMocks.togglePin })
    hookMocks.useSessions.mockReset()
    hookMocks.useUpdateSession.mockReset()
  })

  it('selects a topic when the history title is clicked', () => {
    hookMocks.useTopics.mockReturnValue({ topics: [createTopic()], error: undefined, isLoading: false })
    hookMocks.useAssistants.mockReturnValue({ assistants: [createAssistant()] })
    hookMocks.usePins.mockReturnValue({ pinnedIds: ['topic-alpha'], togglePin: hookMocks.togglePin })

    const onClose = vi.fn()
    const onRecordSelect = vi.fn()

    render(<HistoryRecordsPage mode="assistant" open onClose={onClose} onRecordSelect={onRecordSelect} />)

    expect(screen.getByText('History')).toBeInTheDocument()
    expect(screen.getByText('1 conversations')).toBeInTheDocument()
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getByTestId('history-virtual-list')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()
    const pinButton = screen.getByTestId('history-pin-button')
    expect(pinButton).toHaveAccessibleName('Unpin Conversation')
    fireEvent.click(pinButton)
    expect(hookMocks.togglePin).toHaveBeenCalledWith('topic-alpha')
    expect(onRecordSelect).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.queryByText('Messages')).not.toBeInTheDocument()
    expect(screen.queryByText('消息')).not.toBeInTheDocument()

    const alphaRow = screen.getByText('Alpha topic').closest('[role="row"]') as HTMLElement
    const alphaCells = within(alphaRow).getAllByRole('cell')
    expect(within(alphaCells[1]).queryByText('A')).not.toBeInTheDocument()
    expect(within(alphaCells[2]).getByText('A')).toBeInTheDocument()
    expect(within(alphaCells[2]).getByText('Alpha assistant')).toBeInTheDocument()
    expect(screen.queryByTestId('history-open-button')).not.toBeInTheDocument()

    fireEvent.click(alphaRow)

    expect(onRecordSelect).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Alpha topic' }))

    expect(hookMocks.openConversationTab).toHaveBeenCalledWith('topic-alpha', 'Alpha topic', { forceNew: true })
    expect(onRecordSelect).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(hookMocks.useSessions).not.toHaveBeenCalled()
    expect(hookMocks.useAgents).not.toHaveBeenCalled()
  })

  it('falls back to record selection when no conversation tab context exists', () => {
    hookMocks.useTopics.mockReturnValue({ topics: [createTopic()], error: undefined, isLoading: false })
    hookMocks.useAssistants.mockReturnValue({ assistants: [createAssistant()] })
    hookMocks.openConversationTab.mockReturnValueOnce(undefined)
    const onClose = vi.fn()
    const onRecordSelect = vi.fn()

    render(<HistoryRecordsPage mode="assistant" open onClose={onClose} onRecordSelect={onRecordSelect} />)

    fireEvent.click(screen.getByRole('button', { name: 'Alpha topic' }))

    expect(hookMocks.openConversationTab).toHaveBeenCalledWith('topic-alpha', 'Alpha topic', { forceNew: true })
    expect(onRecordSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'topic-alpha' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not select a topic when the selection checkbox is clicked', () => {
    hookMocks.useTopics.mockReturnValue({ topics: [createTopic()], error: undefined, isLoading: false })
    hookMocks.useAssistants.mockReturnValue({ assistants: [createAssistant()] })
    const onClose = vi.fn()
    const onRecordSelect = vi.fn()

    render(<HistoryRecordsPage mode="assistant" open onClose={onClose} onRecordSelect={onRecordSelect} />)

    const alphaRow = screen.getByText('Alpha topic').closest('[role="row"]')
    expect(alphaRow).not.toBeNull()
    fireEvent.click(within(alphaRow as HTMLElement).getByRole('checkbox'))

    expect(onRecordSelect).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('bulk deletes selected topics from the query toolbar', async () => {
    hookMocks.useTopics.mockReturnValue({
      topics: [
        createTopic(),
        createTopic({ id: 'topic-beta', name: 'Beta topic', orderKey: 'b' }),
        createTopic({ id: 'topic-gamma', name: 'Gamma topic', orderKey: 'c' })
      ],
      error: undefined,
      isLoading: false
    })
    hookMocks.useAssistants.mockReturnValue({ assistants: [createAssistant()] })
    hookMocks.deleteTopics.mockResolvedValueOnce({
      deletedIds: ['topic-alpha', 'topic-beta'],
      deletedCount: 2
    })
    const onClose = vi.fn()
    const onRecordSelect = vi.fn()

    render(
      <HistoryRecordsPage
        mode="assistant"
        open
        activeRecordId="topic-alpha"
        onClose={onClose}
        onRecordSelect={onRecordSelect}
      />
    )

    const alphaRow = screen.getByText('Alpha topic').closest('[role="row"]') as HTMLElement
    const betaRow = screen.getByText('Beta topic').closest('[role="row"]') as HTMLElement
    fireEvent.click(within(alphaRow).getByRole('checkbox'))
    fireEvent.click(within(betaRow).getByRole('checkbox'))

    fireEvent.click(screen.getByRole('button', { name: /Batch Delete/ }))

    expect(screen.getByRole('dialog')).toHaveTextContent('Delete selected conversations')
    expect(screen.getByRole('dialog')).toHaveTextContent('Delete 2 selected conversation(s)?')
    expect(hookMocks.deleteTopics).not.toHaveBeenCalled()

    await act(async () => {
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }))
    })

    expect(hookMocks.deleteTopics).toHaveBeenCalledWith(['topic-alpha', 'topic-beta'])
    expect(onRecordSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'topic-gamma' }))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('shows an error and keeps the active topic when bulk delete rejects', async () => {
    hookMocks.useTopics.mockReturnValue({
      topics: [createTopic(), createTopic({ id: 'topic-beta', name: 'Beta topic', orderKey: 'b' })],
      error: undefined,
      isLoading: false
    })
    hookMocks.useAssistants.mockReturnValue({ assistants: [createAssistant()] })
    hookMocks.deleteTopics.mockRejectedValueOnce(new Error('Bulk delete failed'))
    const onRecordSelect = vi.fn()

    render(
      <HistoryRecordsPage
        mode="assistant"
        open
        activeRecordId="topic-alpha"
        onClose={vi.fn()}
        onRecordSelect={onRecordSelect}
      />
    )

    const alphaRow = screen.getByText('Alpha topic').closest('[role="row"]') as HTMLElement
    fireEvent.click(within(alphaRow).getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: /Batch Delete/ }))

    await act(async () => {
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }))
    })

    expect(hookMocks.deleteTopics).toHaveBeenCalledWith(['topic-alpha'])
    expect(window.toast.error).toHaveBeenCalledWith('Bulk delete failed')
    expect(onRecordSelect).not.toHaveBeenCalled()
  })

  it('switches to the previous survivor when bulk deleting the last active topics', async () => {
    hookMocks.useTopics.mockReturnValue({
      topics: [
        createTopic(),
        createTopic({ id: 'topic-beta', name: 'Beta topic', orderKey: 'b' }),
        createTopic({ id: 'topic-gamma', name: 'Gamma topic', orderKey: 'c' })
      ],
      error: undefined,
      isLoading: false
    })
    hookMocks.useAssistants.mockReturnValue({ assistants: [createAssistant()] })
    hookMocks.deleteTopics.mockResolvedValueOnce({
      deletedIds: ['topic-beta', 'topic-gamma'],
      deletedCount: 2
    })
    const onRecordSelect = vi.fn()

    render(
      <HistoryRecordsPage
        mode="assistant"
        open
        activeRecordId="topic-gamma"
        onClose={vi.fn()}
        onRecordSelect={onRecordSelect}
      />
    )

    const betaRow = screen.getByText('Beta topic').closest('[role="row"]') as HTMLElement
    const gammaRow = screen.getByText('Gamma topic').closest('[role="row"]') as HTMLElement
    fireEvent.click(within(betaRow).getByRole('checkbox'))
    fireEvent.click(within(gammaRow).getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: /Batch Delete/ }))

    await act(async () => {
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }))
    })

    expect(hookMocks.deleteTopics).toHaveBeenCalledWith(['topic-beta', 'topic-gamma'])
    expect(onRecordSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'topic-alpha' }))
  })

  it('skips pinned topics when bulk deleting from the query toolbar', async () => {
    hookMocks.useTopics.mockReturnValue({
      topics: [
        createTopic(),
        createTopic({ id: 'topic-beta', name: 'Beta topic', orderKey: 'b' }),
        createTopic({ id: 'topic-gamma', name: 'Gamma topic', orderKey: 'c' })
      ],
      error: undefined,
      isLoading: false
    })
    hookMocks.useAssistants.mockReturnValue({ assistants: [createAssistant()] })
    hookMocks.usePins.mockReturnValue({ pinnedIds: ['topic-beta'], togglePin: hookMocks.togglePin })
    hookMocks.deleteTopics.mockResolvedValueOnce({
      deletedIds: ['topic-alpha'],
      deletedCount: 1
    })
    const onClose = vi.fn()
    const onRecordSelect = vi.fn()

    render(<HistoryRecordsPage mode="assistant" open onClose={onClose} onRecordSelect={onRecordSelect} />)

    const alphaRow = screen.getByText('Alpha topic').closest('[role="row"]') as HTMLElement
    const betaRow = screen.getByText('Beta topic').closest('[role="row"]') as HTMLElement
    fireEvent.click(within(alphaRow).getByRole('checkbox'))
    fireEvent.click(within(betaRow).getByRole('checkbox'))

    fireEvent.click(screen.getByRole('button', { name: /Batch Delete/ }))

    expect(screen.getByRole('dialog')).toHaveTextContent('Delete 1 selected conversation(s)?')

    await act(async () => {
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }))
    })

    expect(hookMocks.deleteTopics).toHaveBeenCalledWith(['topic-alpha'])
    expect(onRecordSelect).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('disables bulk delete when only pinned topics are selected', () => {
    hookMocks.useTopics.mockReturnValue({
      topics: [createTopic(), createTopic({ id: 'topic-beta', name: 'Beta topic', orderKey: 'b' })],
      error: undefined,
      isLoading: false
    })
    hookMocks.useAssistants.mockReturnValue({ assistants: [createAssistant()] })
    hookMocks.usePins.mockReturnValue({ pinnedIds: ['topic-alpha'], togglePin: hookMocks.togglePin })

    render(<HistoryRecordsPage mode="assistant" open onClose={vi.fn()} onRecordSelect={vi.fn()} />)

    const alphaRow = screen.getByText('Alpha topic').closest('[role="row"]') as HTMLElement
    fireEvent.click(within(alphaRow).getByRole('checkbox'))

    expect(screen.getByRole('button', { name: 'Batch Delete' })).toBeDisabled()
    expect(hookMocks.deleteTopics).not.toHaveBeenCalled()
  })

  it('excludes pinned topics from row selection and select all', () => {
    hookMocks.useTopics.mockReturnValue({
      topics: [
        createTopic(),
        createTopic({ id: 'topic-beta', name: 'Beta topic', orderKey: 'b' }),
        createTopic({ id: 'topic-gamma', name: 'Gamma topic', orderKey: 'c' })
      ],
      error: undefined,
      isLoading: false
    })
    hookMocks.useAssistants.mockReturnValue({ assistants: [createAssistant()] })
    hookMocks.usePins.mockReturnValue({ pinnedIds: ['topic-beta'], togglePin: hookMocks.togglePin })

    render(<HistoryRecordsPage mode="assistant" open onClose={vi.fn()} onRecordSelect={vi.fn()} />)

    const alphaCheckbox = within(screen.getByText('Alpha topic').closest('[role="row"]') as HTMLElement).getByRole(
      'checkbox'
    )
    const betaCheckbox = within(screen.getByText('Beta topic').closest('[role="row"]') as HTMLElement).getByRole(
      'checkbox'
    )
    const gammaCheckbox = within(screen.getByText('Gamma topic').closest('[role="row"]') as HTMLElement).getByRole(
      'checkbox'
    )

    expect(betaCheckbox).toBeDisabled()
    fireEvent.click(betaCheckbox)
    expect(betaCheckbox).toHaveAttribute('aria-checked', 'false')

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all' }))

    expect(alphaCheckbox).toHaveAttribute('aria-checked', 'true')
    expect(betaCheckbox).toHaveAttribute('aria-checked', 'false')
    expect(gammaCheckbox).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('button', { name: /Batch Delete/ })).toHaveTextContent('Batch Delete (2)')
  })

  it('bulk moves selected topics to another assistant from the query toolbar', async () => {
    hookMocks.useTopics.mockReturnValue({
      topics: [
        createTopic(),
        createTopic({ id: 'topic-beta', name: 'Beta topic', orderKey: 'b' }),
        createTopic({ id: 'topic-gamma', name: 'Gamma topic', orderKey: 'c' })
      ],
      error: undefined,
      isLoading: false
    })
    hookMocks.useAssistants.mockReturnValue({
      assistants: [createAssistant(), createAssistant({ id: 'assistant-beta', name: 'Beta assistant', emoji: 'B' })]
    })
    const onClose = vi.fn()
    const onRecordSelect = vi.fn()

    render(<HistoryRecordsPage mode="assistant" open onClose={onClose} onRecordSelect={onRecordSelect} />)

    const alphaRow = screen.getByText('Alpha topic').closest('[role="row"]') as HTMLElement
    const betaRow = screen.getByText('Beta topic').closest('[role="row"]') as HTMLElement
    fireEvent.click(within(alphaRow).getByRole('checkbox'))
    fireEvent.click(within(betaRow).getByRole('checkbox'))

    fireEvent.click(screen.getByRole('button', { name: /Batch Move/ }))

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('Move selected conversations')
    expect(dialog).toHaveTextContent('Move 2 selected conversation(s) to the target assistant.')
    expect(hookMocks.updateTopic).not.toHaveBeenCalled()

    fireEvent.click(within(dialog).getByRole('button', { name: /Beta assistant/ }))
    hookMocks.batchUpdateTopics.mockResolvedValueOnce([
      { status: 'fulfilled', value: createTopic({ id: 'topic-alpha', assistantId: 'assistant-beta' }) },
      { status: 'fulfilled', value: createTopic({ id: 'topic-beta', assistantId: 'assistant-beta' }) }
    ])
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Move' }))
    })

    expect(hookMocks.batchUpdateTopics).toHaveBeenCalledWith([
      { id: 'topic-alpha', dto: { assistantId: 'assistant-beta' } },
      { id: 'topic-beta', dto: { assistantId: 'assistant-beta' } }
    ])
    expect(hookMocks.updateTopic).not.toHaveBeenCalled()
    expect(window.toast.success).toHaveBeenCalledWith('Moved 2 conversation(s)')
    expect(onRecordSelect).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('drops already-moved topics from the selection when a bulk move partially fails', async () => {
    hookMocks.useTopics.mockReturnValue({
      topics: [
        createTopic(),
        createTopic({ id: 'topic-beta', name: 'Beta topic', orderKey: 'b' }),
        createTopic({ id: 'topic-gamma', name: 'Gamma topic', orderKey: 'c' })
      ],
      error: undefined,
      isLoading: false
    })
    hookMocks.useAssistants.mockReturnValue({
      assistants: [createAssistant(), createAssistant({ id: 'assistant-beta', name: 'Beta assistant', emoji: 'B' })]
    })
    hookMocks.batchUpdateTopics.mockResolvedValueOnce([
      { status: 'fulfilled', value: createTopic({ id: 'topic-alpha', assistantId: 'assistant-beta' }) },
      { status: 'rejected', reason: new Error('move failed') }
    ])

    render(<HistoryRecordsPage mode="assistant" open onClose={vi.fn()} onRecordSelect={vi.fn()} />)

    const alphaRow = screen.getByText('Alpha topic').closest('[role="row"]') as HTMLElement
    const betaRow = screen.getByText('Beta topic').closest('[role="row"]') as HTMLElement
    fireEvent.click(within(alphaRow).getByRole('checkbox'))
    fireEvent.click(within(betaRow).getByRole('checkbox'))

    fireEvent.click(screen.getByRole('button', { name: /Batch Move/ }))

    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: /Beta assistant/ }))
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Move' }))
    })

    expect(hookMocks.batchUpdateTopics).toHaveBeenCalledWith([
      { id: 'topic-alpha', dto: { assistantId: 'assistant-beta' } },
      { id: 'topic-beta', dto: { assistantId: 'assistant-beta' } }
    ])
    expect(window.toast.warning).toHaveBeenCalledWith('Moved 1 of 2 conversation(s); 1 failed')
    expect(window.toast.error).not.toHaveBeenCalled()
    expect(window.toast.success).not.toHaveBeenCalled()

    // The successfully-moved topic is pruned from the selection; the failed one stays selected.
    const alphaCheckbox = within(screen.getByText('Alpha topic').closest('[role="row"]') as HTMLElement).getByRole(
      'checkbox'
    )
    const betaCheckbox = within(screen.getByText('Beta topic').closest('[role="row"]') as HTMLElement).getByRole(
      'checkbox'
    )
    expect(alphaCheckbox).toHaveAttribute('aria-checked', 'false')
    expect(betaCheckbox).toHaveAttribute('aria-checked', 'true')
  })

  it('renders the overlay shell without transition animation', () => {
    hookMocks.useTopics.mockReturnValue({ topics: [createTopic()], error: undefined, isLoading: false })
    hookMocks.useAssistants.mockReturnValue({ assistants: [createAssistant()] })

    render(<HistoryRecordsPage mode="assistant" open onClose={vi.fn()} onRecordSelect={vi.fn()} />)

    const overlay = screen.getByTestId('history-records-page')
    expect(overlay).toHaveClass('z-40')
    expect(overlay).toHaveClass('bg-card')
    expect(overlay).not.toHaveStyle({ willChange: 'clip-path' })
  })

  it('renders the overlay inside the owning container instead of the first home page element', () => {
    hookMocks.useTopics.mockReturnValue({ topics: [createTopic()], error: undefined, isLoading: false })
    hookMocks.useAssistants.mockReturnValue({ assistants: [createAssistant()] })

    const firstHomePage = document.getElementById('home-page') as HTMLElement
    const owningContainer = document.createElement('div')
    document.body.appendChild(owningContainer)

    render(<HistoryRecordsPage mode="assistant" open onClose={vi.fn()} onRecordSelect={vi.fn()} />, {
      container: owningContainer
    })

    expect(within(owningContainer).getByTestId('history-records-page')).toBeInTheDocument()
    expect(within(firstHomePage).queryByTestId('history-records-page')).not.toBeInTheDocument()
  })

  it('matches external assistant source and selected-source order', () => {
    hookMocks.useTopics.mockReturnValue({
      topics: [
        createTopic({ id: 'topic-beta', assistantId: 'assistant-beta', name: 'Beta topic', orderKey: 'a' }),
        createTopic({ id: 'topic-alpha-b', name: 'Alpha B', orderKey: 'b' }),
        createTopic({ id: 'topic-alpha-a', name: 'Alpha A', orderKey: 'a' })
      ],
      error: undefined,
      isLoading: false
    })
    hookMocks.useAssistants.mockReturnValue({
      assistants: [
        createAssistant(),
        createAssistant({ id: 'assistant-beta', name: 'Beta assistant', emoji: 'B' }),
        createAssistant({ id: 'assistant-gamma', name: 'Gamma assistant', emoji: 'G' })
      ]
    })

    render(<HistoryRecordsPage mode="assistant" open onClose={vi.fn()} onRecordSelect={vi.fn()} />)

    const alphaSource = screen.getByRole('button', { name: /Alpha assistant 2/ })
    const betaSource = screen.getByRole('button', { name: /Beta assistant 1/ })
    const gammaSource = screen.getByRole('button', { name: /Gamma assistant 0/ })
    expect(Boolean(alphaSource.compareDocumentPosition(betaSource) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true)
    expect(Boolean(betaSource.compareDocumentPosition(gammaSource) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true)

    fireEvent.click(alphaSource)

    const alphaA = screen.getByText('Alpha A').closest('[role="row"]') as HTMLElement
    const alphaB = screen.getByText('Alpha B').closest('[role="row"]') as HTMLElement
    expect(Boolean(alphaA.compareDocumentPosition(alphaB) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true)

    fireEvent.click(gammaSource)

    expect(screen.queryByText('Alpha A')).not.toBeInTheDocument()
    expect(screen.queryByText('Alpha B')).not.toBeInTheDocument()
    expect(screen.queryByText('Beta topic')).not.toBeInTheDocument()
    expect(screen.getByText('No conversations')).toBeInTheDocument()
  })

  it('groups empty and missing assistant topics under one unlinked source', () => {
    hookMocks.useTopics.mockReturnValue({
      topics: [
        createTopic({ id: 'topic-alpha', name: 'Alpha topic', orderKey: 'a' }),
        createTopic({ id: 'topic-unlinked', assistantId: undefined, name: 'Local orphan topic', orderKey: 'b' }),
        createTopic({
          id: 'topic-missing',
          assistantId: 'assistant-missing',
          name: 'Missing assistant topic',
          orderKey: 'c'
        })
      ],
      error: undefined,
      isLoading: false
    })
    hookMocks.useAssistants.mockReturnValue({ assistants: [createAssistant()] })

    render(<HistoryRecordsPage mode="assistant" open onClose={vi.fn()} onRecordSelect={vi.fn()} />)

    const unlinkedSource = screen.getByRole('button', { name: /Unlinked assistant 2/ })
    expect(screen.queryByRole('button', { name: /Default assistant/ })).not.toBeInTheDocument()

    fireEvent.click(unlinkedSource)

    expect(screen.getByText('Local orphan topic')).toBeInTheDocument()
    expect(screen.getByText('Missing assistant topic')).toBeInTheDocument()
    expect(screen.queryByText('Alpha topic')).not.toBeInTheDocument()
  })

  it('unmounts the overlay immediately when closed', () => {
    hookMocks.useTopics.mockReturnValue({ topics: [createTopic()], error: undefined, isLoading: false })
    hookMocks.useAssistants.mockReturnValue({ assistants: [createAssistant()] })

    const props = {
      mode: 'assistant' as const,
      onClose: vi.fn(),
      onRecordSelect: vi.fn()
    }

    const { rerender } = render(<HistoryRecordsPage {...props} open />)
    expect(screen.getByTestId('history-records-page')).toBeInTheDocument()

    rerender(<HistoryRecordsPage {...props} open={false} />)
    expect(screen.queryByTestId('history-records-page')).not.toBeInTheDocument()
  })

  it('renders the external topic context menu for history rows', () => {
    hookMocks.useTopics.mockReturnValue({
      topics: [createTopic(), createTopic({ id: 'topic-beta', name: 'Beta topic' })],
      error: undefined,
      isLoading: false
    })
    hookMocks.useAssistants.mockReturnValue({ assistants: [createAssistant()] })

    render(<HistoryRecordsPage mode="assistant" open onClose={vi.fn()} onRecordSelect={vi.fn()} />)

    const alphaMenu = screen.getByText('Alpha topic').closest('[data-testid="context-menu"]')
    const menuContent = alphaMenu?.querySelector('[data-testid="context-menu-content"]')

    expect(menuContent ?? null).toBeInTheDocument()
    expect(menuContent).toHaveClass('z-50')
    expect(Array.from(menuContent?.querySelectorAll('[data-testid="context-menu-separator"]') ?? [])).toHaveLength(2)
    expect(Array.from(menuContent?.children ?? []).map((child) => child.textContent)).toEqual([
      'Generate conversation name',
      'Edit conversation name',
      'Pin Conversation',
      'Clear messages',
      '',
      'Save to notes',
      'Save to knowledge base',
      'ExportExport as ImageExport as MarkdownExport as Markdown with ReasoningExport as WordExport to NotionExport to YuqueExport to ObsidianExport to JoplinExport to Siyuan',
      'CopyCopy as ImageCopy as MarkdownCopy as Plain Text',
      '',
      'Delete'
    ])
  })

  it('pins a topic from the history row context menu without selecting the row', async () => {
    hookMocks.useTopics.mockReturnValue({ topics: [createTopic()], error: undefined, isLoading: false })
    hookMocks.useAssistants.mockReturnValue({ assistants: [createAssistant()] })
    const onClose = vi.fn()
    const onRecordSelect = vi.fn()

    render(<HistoryRecordsPage mode="assistant" open onClose={onClose} onRecordSelect={onRecordSelect} />)

    const alphaMenu = screen.getByText('Alpha topic').closest('[data-testid="context-menu"]')
    const menuContent = alphaMenu?.querySelector('[data-testid="context-menu-content"]')
    fireEvent.click(within(menuContent as HTMLElement).getByRole('button', { name: 'Pin Conversation' }))
    await act(async () => {
      await flushAnimationFrame()
    })

    expect(hookMocks.togglePin).toHaveBeenCalledWith('topic-alpha')
    expect(onRecordSelect).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('clears a selected topic when pinning it from the history row action column', async () => {
    hookMocks.useTopics.mockReturnValue({ topics: [createTopic()], error: undefined, isLoading: false })
    hookMocks.useAssistants.mockReturnValue({ assistants: [createAssistant()] })

    render(<HistoryRecordsPage mode="assistant" open onClose={vi.fn()} onRecordSelect={vi.fn()} />)

    const alphaRow = screen.getByText('Alpha topic').closest('[role="row"]') as HTMLElement
    const checkbox = within(alphaRow).getByRole('checkbox')
    fireEvent.click(checkbox)
    expect(checkbox).toHaveAttribute('aria-checked', 'true')

    await act(async () => {
      fireEvent.click(within(alphaRow).getByTestId('history-pin-button'))
      await flushAnimationFrame()
    })

    expect(hookMocks.togglePin).toHaveBeenCalledWith('topic-alpha')
    await vi.waitFor(() => expect(checkbox).toHaveAttribute('aria-checked', 'false'))
  })

  it('deletes a topic from the history row action column without selecting the row', async () => {
    hookMocks.useTopics.mockReturnValue({
      topics: [createTopic(), createTopic({ id: 'topic-beta', name: 'Beta topic' })],
      error: undefined,
      isLoading: false
    })
    hookMocks.useAssistants.mockReturnValue({ assistants: [createAssistant()] })
    const onClose = vi.fn()
    const onRecordSelect = vi.fn()

    render(<HistoryRecordsPage mode="assistant" open onClose={onClose} onRecordSelect={onRecordSelect} />)

    const alphaRow = screen.getByText('Alpha topic').closest('[role="row"]')
    expect(alphaRow).not.toBeNull()
    fireEvent.click(within(alphaRow as HTMLElement).getByTestId('history-delete-button'))

    expect(screen.getByRole('dialog')).toHaveTextContent('Delete Conversations')
    expect(hookMocks.deleteTopic).not.toHaveBeenCalled()

    await act(async () => {
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }))
      await flushAnimationFrame()
    })

    expect(hookMocks.deleteTopic).toHaveBeenCalledWith('topic-alpha')
    expect(onRecordSelect).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('renames a topic from the history row context menu dialog without selecting the row', async () => {
    hookMocks.useTopics.mockReturnValue({ topics: [createTopic()], error: undefined, isLoading: false })
    hookMocks.useAssistants.mockReturnValue({ assistants: [createAssistant()] })
    const onClose = vi.fn()
    const onRecordSelect = vi.fn()

    render(<HistoryRecordsPage mode="assistant" open onClose={onClose} onRecordSelect={onRecordSelect} />)

    const alphaMenu = screen.getByText('Alpha topic').closest('[data-testid="context-menu"]')
    const menuContent = alphaMenu?.querySelector('[data-testid="context-menu-content"]')
    fireEvent.click(within(menuContent as HTMLElement).getByRole('button', { name: 'Edit conversation name' }))
    await act(async () => {
      await flushAnimationFrame()
    })

    expect(hookMocks.promptShow).not.toHaveBeenCalled()
    expect(onRecordSelect).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(hookMocks.updateTopic).not.toHaveBeenCalled()

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('Edit conversation name')
    const input = within(dialog).getByLabelText('Name')
    expect(hookMocks.updateTopic).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: 'Renamed topic' } })
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' })
      await flushAnimationFrame()
    })

    await vi.waitFor(() =>
      expect(hookMocks.updateTopic).toHaveBeenCalledWith('topic-alpha', {
        name: 'Renamed topic',
        isNameManuallyEdited: true
      })
    )
    expect(window.toast.success).toHaveBeenCalledWith('Saved')
  })

  it('shows an error when topic rename from history fails', async () => {
    hookMocks.useTopics.mockReturnValue({ topics: [createTopic()], error: undefined, isLoading: false })
    hookMocks.useAssistants.mockReturnValue({ assistants: [createAssistant()] })
    hookMocks.updateTopic.mockRejectedValueOnce(new Error('Rename failed'))

    render(<HistoryRecordsPage mode="assistant" open onClose={vi.fn()} onRecordSelect={vi.fn()} />)

    const alphaMenu = screen.getByText('Alpha topic').closest('[data-testid="context-menu"]')
    const menuContent = alphaMenu?.querySelector('[data-testid="context-menu-content"]')
    fireEvent.click(within(menuContent as HTMLElement).getByRole('button', { name: 'Edit conversation name' }))
    await act(async () => {
      await flushAnimationFrame()
    })

    const dialog = screen.getByRole('dialog')
    const input = within(dialog).getByLabelText('Name')
    fireEvent.change(input, { target: { value: 'Renamed topic' } })
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' })
      await flushAnimationFrame()
    })

    await vi.waitFor(() =>
      expect(hookMocks.updateTopic).toHaveBeenCalledWith('topic-alpha', {
        name: 'Renamed topic',
        isNameManuallyEdited: true
      })
    )
    expect(window.toast.error).toHaveBeenCalledWith('Rename failed')
    expect(window.toast.success).not.toHaveBeenCalled()
  })

  it('does not persist empty or unchanged topic names from history rename dialog', async () => {
    hookMocks.useTopics.mockReturnValue({ topics: [createTopic()], error: undefined, isLoading: false })
    hookMocks.useAssistants.mockReturnValue({ assistants: [createAssistant()] })

    const { unmount } = render(<HistoryRecordsPage mode="assistant" open onClose={vi.fn()} onRecordSelect={vi.fn()} />)

    const alphaMenu = screen.getByText('Alpha topic').closest('[data-testid="context-menu"]')
    const menuContent = alphaMenu?.querySelector('[data-testid="context-menu-content"]')
    fireEvent.click(within(menuContent as HTMLElement).getByRole('button', { name: 'Edit conversation name' }))
    await act(async () => {
      await flushAnimationFrame()
    })
    const emptyDialog = screen.getByRole('dialog')
    const emptyInput = within(emptyDialog).getByLabelText('Name')
    fireEvent.change(emptyInput, { target: { value: '   ' } })
    fireEvent.click(within(emptyDialog).getByRole('button', { name: 'Save' }))

    expect(hookMocks.updateTopic).not.toHaveBeenCalled()

    unmount()
    hookMocks.updateTopic.mockClear()
    render(<HistoryRecordsPage mode="assistant" open onClose={vi.fn()} onRecordSelect={vi.fn()} />)

    const nextAlphaMenu = screen.getByText('Alpha topic').closest('[data-testid="context-menu"]')
    const nextMenuContent = nextAlphaMenu?.querySelector('[data-testid="context-menu-content"]')
    fireEvent.click(within(nextMenuContent as HTMLElement).getByRole('button', { name: 'Edit conversation name' }))
    await act(async () => {
      await flushAnimationFrame()
    })
    const unchangedDialog = screen.getByRole('dialog')
    const unchangedInput = within(unchangedDialog).getByLabelText('Name')
    fireEvent.change(unchangedInput, { target: { value: 'Alpha topic' } })
    await act(async () => {
      fireEvent.keyDown(unchangedInput, { key: 'Enter' })
      await flushAnimationFrame()
    })

    expect(hookMocks.updateTopic).not.toHaveBeenCalled()
  })

  it('confirms topic deletion from the history row context menu', async () => {
    hookMocks.useTopics.mockReturnValue({
      topics: [createTopic(), createTopic({ id: 'topic-beta', name: 'Beta topic' })],
      error: undefined,
      isLoading: false
    })
    hookMocks.useAssistants.mockReturnValue({ assistants: [createAssistant()] })

    render(<HistoryRecordsPage mode="assistant" open onClose={vi.fn()} onRecordSelect={vi.fn()} />)

    const alphaMenu = screen.getByText('Alpha topic').closest('[data-testid="context-menu"]')
    const menuContent = alphaMenu?.querySelector('[data-testid="context-menu-content"]')
    fireEvent.click(within(menuContent as HTMLElement).getByRole('button', { name: 'Delete' }))
    await act(async () => {
      await flushCommandMenuAction()
    })

    expect(window.modal.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Delete Conversations' }))
    expect(hookMocks.deleteTopic).not.toHaveBeenCalled()

    const confirmOptions = vi.mocked(window.modal.confirm).mock.calls.at(-1)?.[0]
    await act(async () => {
      await confirmOptions?.onOk?.()
      await flushAnimationFrame()
    })

    expect(hookMocks.deleteTopic).toHaveBeenCalledWith('topic-alpha')
  })

  it('switches to the adjacent topic after deleting the active topic from the history row context menu', async () => {
    hookMocks.useTopics.mockReturnValue({
      topics: [createTopic(), createTopic({ id: 'topic-beta', name: 'Beta topic' })],
      error: undefined,
      isLoading: false
    })
    hookMocks.useAssistants.mockReturnValue({ assistants: [createAssistant()] })
    const onRecordSelect = vi.fn()

    render(
      <HistoryRecordsPage
        mode="assistant"
        open
        activeRecordId="topic-alpha"
        onClose={vi.fn()}
        onRecordSelect={onRecordSelect}
      />
    )

    const alphaMenu = screen.getByText('Alpha topic').closest('[data-testid="context-menu"]')
    const menuContent = alphaMenu?.querySelector('[data-testid="context-menu-content"]')
    fireEvent.click(within(menuContent as HTMLElement).getByRole('button', { name: 'Delete' }))
    await act(async () => {
      await flushCommandMenuAction()
    })

    const confirmOptions = vi.mocked(window.modal.confirm).mock.calls.at(-1)?.[0]
    await act(async () => {
      await confirmOptions?.onOk?.()
      await flushAnimationFrame()
    })

    expect(hookMocks.deleteTopic).toHaveBeenCalledWith('topic-alpha')
    expect(onRecordSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'topic-beta', name: 'Beta topic' }))
  })

  it('clears the active topic after bulk deleting the last history topic', async () => {
    hookMocks.useTopics.mockReturnValue({ topics: [createTopic()], error: undefined, isLoading: false })
    hookMocks.useAssistants.mockReturnValue({ assistants: [createAssistant()] })
    hookMocks.deleteTopics.mockResolvedValueOnce({ deletedIds: ['topic-alpha'], deletedCount: 1 })
    const onRecordSelect = vi.fn()

    render(
      <HistoryRecordsPage
        mode="assistant"
        open
        activeRecordId="topic-alpha"
        onClose={vi.fn()}
        onRecordSelect={onRecordSelect}
      />
    )

    const alphaRow = screen.getByText('Alpha topic').closest('[role="row"]') as HTMLElement
    fireEvent.click(within(alphaRow).getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: /Batch Delete/ }))
    await act(async () => {
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }))
    })

    expect(hookMocks.deleteTopics).toHaveBeenCalledWith(['topic-alpha'])
    expect(onRecordSelect).toHaveBeenCalledWith(null)
  })

  it('does not switch topics after deleting a non-active history row', async () => {
    hookMocks.useTopics.mockReturnValue({
      topics: [createTopic(), createTopic({ id: 'topic-beta', name: 'Beta topic' })],
      error: undefined,
      isLoading: false
    })
    hookMocks.useAssistants.mockReturnValue({ assistants: [createAssistant()] })
    const onRecordSelect = vi.fn()

    render(
      <HistoryRecordsPage
        mode="assistant"
        open
        activeRecordId="topic-beta"
        onClose={vi.fn()}
        onRecordSelect={onRecordSelect}
      />
    )

    const alphaMenu = screen.getByText('Alpha topic').closest('[data-testid="context-menu"]')
    const menuContent = alphaMenu?.querySelector('[data-testid="context-menu-content"]')
    fireEvent.click(within(menuContent as HTMLElement).getByRole('button', { name: 'Delete' }))
    await act(async () => {
      await flushCommandMenuAction()
    })

    const confirmOptions = vi.mocked(window.modal.confirm).mock.calls.at(-1)?.[0]
    await act(async () => {
      await confirmOptions?.onOk?.()
      await flushAnimationFrame()
    })

    expect(hookMocks.deleteTopic).toHaveBeenCalledWith('topic-alpha')
    expect(onRecordSelect).not.toHaveBeenCalled()
  })

  it('keeps the active topic unchanged when history deletion fails', async () => {
    hookMocks.useTopics.mockReturnValue({
      topics: [createTopic(), createTopic({ id: 'topic-beta', name: 'Beta topic' })],
      error: undefined,
      isLoading: false
    })
    hookMocks.useAssistants.mockReturnValue({ assistants: [createAssistant()] })
    hookMocks.deleteTopic.mockRejectedValueOnce(new Error('Delete failed'))
    const onRecordSelect = vi.fn()

    render(
      <HistoryRecordsPage
        mode="assistant"
        open
        activeRecordId="topic-alpha"
        onClose={vi.fn()}
        onRecordSelect={onRecordSelect}
      />
    )

    const alphaMenu = screen.getByText('Alpha topic').closest('[data-testid="context-menu"]')
    const menuContent = alphaMenu?.querySelector('[data-testid="context-menu-content"]')
    fireEvent.click(within(menuContent as HTMLElement).getByRole('button', { name: 'Delete' }))
    await act(async () => {
      await flushCommandMenuAction()
    })

    const confirmOptions = vi.mocked(window.modal.confirm).mock.calls.at(-1)?.[0]
    await act(async () => {
      await confirmOptions?.onOk?.()
      await flushAnimationFrame()
    })

    expect(hookMocks.deleteTopic).toHaveBeenCalledWith('topic-alpha')
    expect(onRecordSelect).not.toHaveBeenCalled()
  })
})

describe('HistoryRecordsPage locale resources', () => {
  it('defines the real history and delete dialog keys used by the page', () => {
    const requiredGlobalKeys = [
      'chat.topics.manage.delete.confirm.content',
      'chat.topics.manage.delete.confirm.title',
      'common.back',
      'common.cancel',
      'common.delete',
      'common.required_field',
      'common.save'
    ]
    const requiredRecordKeys = [
      'agentSubtitle',
      'agentTitle',
      'assistantSubtitle',
      'bulkMove',
      'bulkMoveTopics.confirm',
      'bulkMoveTopics.description',
      'bulkMoveTopics.empty',
      'bulkMoveTopics.error',
      'bulkMoveTopics.partialSuccess',
      'bulkMoveTopics.placeholder',
      'bulkMoveTopics.success',
      'bulkMoveTopics.target',
      'bulkMoveTopics.title',
      'empty.description',
      'empty.sessionsDescription',
      'empty.sessionsTitle',
      'empty.title',
      'loading.description',
      'loading.sessionsDescription',
      'loading.sessionsTitle',
      'loading.title',
      'resultCount',
      'searchSession',
      'searchTopic',
      'shortTitle',
      'sidebar.searchAssistant',
      'sidebar.status',
      'sidebar.unknownAssistant',
      'status.completed',
      'status.failed',
      'status.running',
      'table.emptyValue',
      'table.messages',
      'table.actions',
      'table.session',
      'table.time',
      'table.title',
      'title'
    ]
    const originalLocaleResources = [enUS, zhCN, zhTW]
    const runtimeLocaleResources = [enUS, zhCN, zhTW, deDE, elGR, esES, frFR, jaJP, ptPT, roRO, ruRU, viVN]

    for (const resource of runtimeLocaleResources) {
      for (const key of requiredGlobalKeys) {
        expect(getNestedValue(resource, key)).toEqual(expect.any(String))
      }
    }

    for (const resource of originalLocaleResources) {
      const history = getNestedValue(resource, 'history') as Record<string, unknown>
      const records = getNestedValue(resource, 'history.records') as Record<string, unknown>

      expect(history.records).toBeTypeOf('object')
      expect(history.v2).toBeUndefined()
      for (const key of requiredRecordKeys) {
        expect(getNestedValue(records, key)).toEqual(expect.any(String))
      }
    }
  })
})

function getNestedValue(source: Record<string, unknown>, key: string) {
  return key.split('.').reduce<unknown>((value, segment) => {
    if (!value || typeof value !== 'object') return undefined

    return (value as Record<string, unknown>)[segment]
  }, source)
}
