import type { Assistant } from '@shared/data/types/assistant'
import type { Topic } from '@shared/data/types/topic'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import type { InputHTMLAttributes, ReactNode } from 'react'
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
  const React = await import('react')
  const itemHandler = (onSelect: ((event: Event) => void) | undefined, props: Record<string, unknown>) => ({
    ...props,
    'data-disabled': props.disabled ? '' : undefined,
    disabled: props.disabled as boolean | undefined,
    onClick: (event: Event) => onSelect?.(event),
    type: 'button'
  })

  return {
    Button: ({ children, loading: _loading, ...props }: { children?: ReactNode; loading?: boolean }) => (
      <button type="button" {...props}>
        {children}
      </button>
    ),
    Checkbox: ({ checked, onCheckedChange, ...props }: any) => (
      <button
        {...props}
        type="button"
        role="checkbox"
        aria-checked={checked === 'indeterminate' ? 'mixed' : Boolean(checked)}
        onClick={(event) => {
          props.onClick?.(event)
          onCheckedChange?.(!checked)
        }}
      />
    ),
    ConfirmDialog: ({
      cancelText,
      confirmText,
      content,
      contentClassName,
      description,
      onConfirm,
      open,
      overlayClassName,
      title
    }: any) =>
      open ? (
        <div role="dialog" className={contentClassName} data-overlay-class={overlayClassName}>
          <h2>{title}</h2>
          {description && <p>{description}</p>}
          {content}
          <button type="button">{cancelText ?? 'Cancel'}</button>
          <button type="button" onClick={onConfirm}>
            {confirmText ?? 'Confirm'}
          </button>
        </div>
      ) : null,
    ContextMenu: ({ children }: { children?: ReactNode }) => <div data-testid="context-menu">{children}</div>,
    ContextMenuContent: ({ children, ...props }: { children?: ReactNode }) => (
      <div data-testid="context-menu-content" {...props}>
        {children}
      </div>
    ),
    ContextMenuItem: ({ children, onSelect, ...props }: any) =>
      React.createElement('button', itemHandler(onSelect, props), children),
    ContextMenuItemContent: ({ children, icon, shortcut, ...props }: any) => (
      <span {...props}>
        {icon}
        {children}
        {shortcut ? <span>{shortcut}</span> : null}
      </span>
    ),
    ContextMenuSeparator: (props: any) => <hr data-testid="context-menu-separator" {...props} />,
    ContextMenuShortcut: ({ children, ...props }: { children?: ReactNode }) => <span {...props}>{children}</span>,
    ContextMenuSub: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    ContextMenuSubContent: ({ children, ...props }: { children?: ReactNode }) => <div {...props}>{children}</div>,
    ContextMenuSubTrigger: ({ children, ...props }: { children?: ReactNode }) => (
      <button type="button" {...props}>
        {children}
      </button>
    ),
    ContextMenuTrigger: ({ children }: { children?: ReactNode }) => <>{children}</>,
    Dialog: ({ children, open }: { children?: ReactNode; open?: boolean }) => (open ? <>{children}</> : null),
    DialogContent: ({ children, showCloseButton: _showCloseButton, ...props }: any) => (
      <div role="dialog" {...props}>
        {children}
      </div>
    ),
    DialogFooter: ({ children, ...props }: { children?: ReactNode }) => <div {...props}>{children}</div>,
    DialogHeader: ({ children, ...props }: { children?: ReactNode }) => <div {...props}>{children}</div>,
    DialogTitle: ({ children, ...props }: { children?: ReactNode }) => <h2 {...props}>{children}</h2>,
    EmptyState: ({ description, title }: { description?: string; title: string }) => (
      <div>
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
    ),
    FieldError: ({ children, ...props }: { children?: ReactNode }) => <p {...props}>{children}</p>,
    Input: (props: InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
    Label: ({ children, ...props }: { children?: ReactNode }) => <label {...props}>{children}</label>,
    RowFlex: ({ children, ...props }: { children?: ReactNode }) => <div {...props}>{children}</div>,
    SelectDropdown: ({ items, onSelect, renderItem, renderSelected, selectedId, placeholder }: any) => {
      const selected = items.find((item: { id: string }) => item.id === selectedId)
      return (
        <div>
          <button type="button" aria-label={placeholder}>
            {selected ? renderSelected(selected) : placeholder}
          </button>
          {items.map((item: { id: string }) => (
            <button type="button" key={item.id} onClick={() => onSelect(item.id)}>
              {renderItem(item, item.id === selectedId)}
            </button>
          ))}
        </div>
      )
    },
    Skeleton: (props: Record<string, unknown>) => <div {...props} />
  }
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

vi.mock('@renderer/pages/library/dialogs', () => ({
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
        'chat.default.topic.name': 'New topic',
        'chat.save.topic.knowledge.menu_title': 'Save to knowledge base',
        'chat.topics.auto_rename': 'Generate topic name',
        'chat.topics.clear.title': 'Clear messages',
        'chat.topics.copy.image': 'Copy as Image',
        'chat.topics.copy.md': 'Copy as Markdown',
        'chat.topics.copy.plain_text': 'Copy as Plain Text',
        'chat.topics.copy.title': 'Copy',
        'chat.topics.edit.title': 'Edit topic name',
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
        'chat.topics.manage.delete.confirm.content': 'Delete {{count}} topic(s)?',
        'chat.topics.manage.delete.confirm.title': 'Delete Topics',
        'chat.topics.pin': 'Pin Topic',
        'chat.topics.unpin': 'Unpin Topic',
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
        'common.select': 'Select',
        'common.unnamed': 'Untitled',
        'history.records.bulkDelete': 'Batch Delete',
        'history.records.bulkDeleteTopics.description': 'Delete {{count}} selected topic(s)?',
        'history.records.bulkDeleteTopics.title': 'Delete selected topics',
        'history.records.bulkMove': 'Batch Move',
        'history.records.bulkMoveTopics.confirm': 'Move',
        'history.records.bulkMoveTopics.description': 'Move {{count}} selected topic(s) to the target assistant.',
        'history.records.bulkMoveTopics.empty': 'No assistants available',
        'history.records.bulkMoveTopics.error': 'Failed to move topics',
        'history.records.bulkMoveTopics.placeholder': 'Select assistant',
        'history.records.bulkMoveTopics.success': 'Moved {{count}} topic(s)',
        'history.records.bulkMoveTopics.target': 'Target assistant',
        'history.records.bulkMoveTopics.title': 'Move selected topics',
        'history.records.assistantSubtitle': '{{count}} topics',
        'history.records.empty.description': 'No topics for the current filters.',
        'history.records.empty.title': 'No topics',
        'history.records.resultCount': '{{count}} results',
        'history.records.searchTopic': 'Search topics...',
        'history.records.shortTitle': 'History',
        'history.records.sidebar.searchAssistant': 'Search assistants...',
        'history.records.sidebar.unknownAssistant': 'Unlinked assistant',
        'history.records.table.actions': 'Actions',
        'history.records.table.emptyValue': '-',
        'history.records.table.time': 'Time',
        'history.records.table.title': 'Title',
        'history.records.title': 'Topic history',
        'notes.save': 'Save to notes',
        'selector.common.pinned_title': 'Pinned'
      }
      const options = typeof fallbackOrOptions === 'object' ? fallbackOrOptions : maybeOptions
      const defaultValue = typeof fallbackOrOptions === 'string' ? fallbackOrOptions : undefined
      const template = labels[key] ?? defaultValue ?? key
      return template.replace('{{count}}', String(options?.count ?? ''))
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
    source: 'user',
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
    expect(screen.getByText('1 topics')).toBeInTheDocument()
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getByTestId('history-virtual-list')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()
    const pinButton = screen.getByTestId('history-pin-button')
    expect(pinButton).toHaveAccessibleName('Unpin Topic')
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

    fireEvent.click(screen.getByRole('button', { name: 'Batch Delete' }))

    expect(screen.getByRole('dialog')).toHaveTextContent('Delete selected topics')
    expect(screen.getByRole('dialog')).toHaveTextContent('Delete 2 selected topic(s)?')
    expect(hookMocks.deleteTopics).not.toHaveBeenCalled()

    await act(async () => {
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }))
    })

    expect(hookMocks.deleteTopics).toHaveBeenCalledWith(['topic-alpha', 'topic-beta'])
    expect(onRecordSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'topic-gamma' }))
    expect(onClose).not.toHaveBeenCalled()
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

    fireEvent.click(screen.getByRole('button', { name: 'Batch Move' }))

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('Move selected topics')
    expect(dialog).toHaveTextContent('Move 2 selected topic(s) to the target assistant.')
    expect(hookMocks.updateTopic).not.toHaveBeenCalled()

    fireEvent.click(within(dialog).getByRole('button', { name: /Beta assistant/ }))
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Move' }))
    })

    expect(hookMocks.updateTopic).toHaveBeenCalledTimes(2)
    expect(hookMocks.updateTopic).toHaveBeenNthCalledWith(1, 'topic-alpha', { assistantId: 'assistant-beta' })
    expect(hookMocks.updateTopic).toHaveBeenNthCalledWith(2, 'topic-beta', { assistantId: 'assistant-beta' })
    expect(window.toast.success).toHaveBeenCalledWith('Moved 2 topic(s)')
    expect(onRecordSelect).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('renders the overlay shell without transition animation', () => {
    hookMocks.useTopics.mockReturnValue({ topics: [createTopic()], error: undefined, isLoading: false })
    hookMocks.useAssistants.mockReturnValue({ assistants: [createAssistant()] })

    render(
      <HistoryRecordsPage
        mode="assistant"
        open
        origin={createTestDomRect({ x: 20, y: 30, width: 20, height: 20 })}
        onClose={vi.fn()}
        onRecordSelect={vi.fn()}
      />
    )

    const overlay = screen.getByTestId('history-records-page')
    expect(overlay).toHaveClass('z-40')
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
    expect(screen.getByText('No topics')).toBeInTheDocument()
  })

  it('groups empty and missing assistant topics under one unlinked source', () => {
    hookMocks.useTopics.mockReturnValue({
      topics: [
        createTopic({ id: 'topic-alpha', name: 'Alpha topic', orderKey: 'a' }),
        createTopic({ id: 'topic-unlinked', assistantId: null, name: 'Local orphan topic', orderKey: 'b' }),
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
      origin: createTestDomRect({ x: 20, y: 30, width: 20, height: 20 }),
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
  })

  it('pins a topic from the history row context menu without selecting the row', async () => {
    hookMocks.useTopics.mockReturnValue({ topics: [createTopic()], error: undefined, isLoading: false })
    hookMocks.useAssistants.mockReturnValue({ assistants: [createAssistant()] })
    const onClose = vi.fn()
    const onRecordSelect = vi.fn()

    render(<HistoryRecordsPage mode="assistant" open onClose={onClose} onRecordSelect={onRecordSelect} />)

    const alphaMenu = screen.getByText('Alpha topic').closest('[data-testid="context-menu"]')
    const menuContent = alphaMenu?.querySelector('[data-testid="context-menu-content"]')
    fireEvent.click(within(menuContent as HTMLElement).getByRole('button', { name: 'Pin Topic' }))
    await act(async () => {
      await flushAnimationFrame()
    })

    expect(hookMocks.togglePin).toHaveBeenCalledWith('topic-alpha')
    expect(onRecordSelect).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
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

    expect(screen.getByRole('dialog')).toHaveTextContent('Delete Topics')
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
    fireEvent.click(within(menuContent as HTMLElement).getByRole('button', { name: 'Edit topic name' }))
    await act(async () => {
      await flushAnimationFrame()
    })

    expect(hookMocks.promptShow).not.toHaveBeenCalled()
    expect(onRecordSelect).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(hookMocks.updateTopic).not.toHaveBeenCalled()

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('Edit topic name')
    const input = within(dialog).getByLabelText('Name')
    expect(hookMocks.updateTopic).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: 'Renamed topic' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await vi.waitFor(() =>
      expect(hookMocks.updateTopic).toHaveBeenCalledWith('topic-alpha', {
        name: 'Renamed topic',
        isNameManuallyEdited: true
      })
    )
  })

  it('does not persist empty or unchanged topic names from history rename dialog', async () => {
    hookMocks.useTopics.mockReturnValue({ topics: [createTopic()], error: undefined, isLoading: false })
    hookMocks.useAssistants.mockReturnValue({ assistants: [createAssistant()] })

    const { unmount } = render(<HistoryRecordsPage mode="assistant" open onClose={vi.fn()} onRecordSelect={vi.fn()} />)

    const alphaMenu = screen.getByText('Alpha topic').closest('[data-testid="context-menu"]')
    const menuContent = alphaMenu?.querySelector('[data-testid="context-menu-content"]')
    fireEvent.click(within(menuContent as HTMLElement).getByRole('button', { name: 'Edit topic name' }))
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
    fireEvent.click(within(nextMenuContent as HTMLElement).getByRole('button', { name: 'Edit topic name' }))
    await act(async () => {
      await flushAnimationFrame()
    })
    const unchangedDialog = screen.getByRole('dialog')
    const unchangedInput = within(unchangedDialog).getByLabelText('Name')
    fireEvent.change(unchangedInput, { target: { value: 'Alpha topic' } })
    fireEvent.keyDown(unchangedInput, { key: 'Enter' })

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

    expect(window.modal.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Delete Topics' }))
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

function createTestDomRect({ height, width, x, y }: { height: number; width: number; x: number; y: number }) {
  return {
    bottom: y + height,
    height,
    left: x,
    right: x + width,
    top: y,
    width,
    x,
    y,
    toJSON: () => ({ bottom: y + height, height, left: x, right: x + width, top: y, width, x, y })
  } satisfies DOMRectReadOnly
}
