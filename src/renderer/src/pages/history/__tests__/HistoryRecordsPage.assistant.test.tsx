import type { Assistant } from '@shared/data/types/assistant'
import type { Topic } from '@shared/data/types/topic'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import type { InputHTMLAttributes, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hookMocks = vi.hoisted(() => ({
  deleteTopic: vi.fn(),
  finishTopicRenaming: vi.fn(),
  getTopicMessages: vi.fn(),
  promptShow: vi.fn(),
  saveToKnowledge: vi.fn(),
  startTopicRenaming: vi.fn(),
  togglePin: vi.fn(),
  updateTopic: vi.fn(),
  useAgents: vi.fn(),
  useAllTopics: vi.fn(),
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
    Button: ({ children, ...props }: { children?: ReactNode }) => (
      <button type="button" {...props}>
        {children}
      </button>
    ),
    ConfirmDialog: ({
      cancelText,
      confirmText,
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
    EmptyState: ({ description, title }: { description?: string; title: string }) => (
      <div>
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
    ),
    Input: (props: InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
    Skeleton: (props: Record<string, unknown>) => <div {...props} />
  }
})

vi.mock('@renderer/components/VirtualList', () => ({
  DynamicVirtualList: <T,>({ children, list }: { children: (item: T, index: number) => ReactNode; list: T[] }) => (
    <div>
      {list.map((item, index) => (
        <div key={(item as { id?: string }).id ?? index}>{children(item, index)}</div>
      ))}
    </div>
  )
}))

vi.mock('@renderer/data/hooks/useCache', () => ({
  useCache: hookMocks.useCache
}))

vi.mock('@renderer/data/hooks/usePreference', () => ({
  useMultiplePreferences: hookMocks.useMultiplePreferences
}))

vi.mock('@renderer/hooks/agents/useAgentDataApi', () => ({
  useAgents: hookMocks.useAgents
}))

vi.mock('@renderer/hooks/agents/useAgentSessionStreamStatuses', () => ({
  useAgentSessionStreamStatuses: vi.fn(() => new Map())
}))

vi.mock('@renderer/hooks/agents/useSessionDataApi', () => ({
  useSessions: hookMocks.useSessions,
  useUpdateSession: hookMocks.useUpdateSession
}))

vi.mock('@renderer/hooks/useAssistant', () => ({
  useAssistants: hookMocks.useAssistants
}))

vi.mock('@renderer/hooks/usePins', () => ({
  usePins: hookMocks.usePins
}))

vi.mock('@renderer/hooks/useTopicDataApi', () => ({
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
  useAllTopics: hookMocks.useAllTopics,
  useTopicMutations: () => ({
    deleteTopic: hookMocks.deleteTopic,
    updateTopic: hookMocks.updateTopic
  })
}))

vi.mock('@renderer/hooks/useNotesSettings', () => ({
  useNotesSettings: () => ({ notesPath: '/notes' })
}))

vi.mock('@renderer/hooks/useTopic', () => ({
  finishTopicRenaming: hookMocks.finishTopicRenaming,
  getTopicMessages: hookMocks.getTopicMessages,
  startTopicRenaming: hookMocks.startTopicRenaming
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
    t: (key: string, fallback?: string, options?: Record<string, unknown>) => {
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
        'common.assistant': 'Assistant',
        'common.cancel': 'Cancel',
        'common.close': 'Close',
        'common.delete': 'Delete',
        'history.records.assistantSubtitle': '{{count}} topics',
        'history.records.resultCount': '{{count}} results',
        'history.records.searchTopic': 'Search topics...',
        'history.records.table.emptyValue': '-',
        'history.records.table.time': 'Time',
        'history.records.table.title': 'Title',
        'history.records.title': 'Topic history',
        'notes.save': 'Save to notes'
      }
      const template = labels[key] ?? fallback ?? key
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
      toolUseMode: 'function',
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

describe('HistoryRecordsPage assistant mode', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="home-page"></div><div id="agent-page"></div>'
    Object.assign(window, {
      toast: {
        error: vi.fn(),
        success: vi.fn(),
        warning: vi.fn()
      }
    })
    hookMocks.useAgents.mockReset()
    hookMocks.useAllTopics.mockReset()
    hookMocks.useAssistants.mockReset()
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

  it('selects the clicked topic and closes history', () => {
    hookMocks.useAllTopics.mockReturnValue({ topics: [createTopic()], error: undefined, isLoading: false })
    hookMocks.useAssistants.mockReturnValue({ assistants: [createAssistant()] })

    const onClose = vi.fn()
    const onTopicSelect = vi.fn()

    render(<HistoryRecordsPage mode="assistant" open onClose={onClose} onTopicSelect={onTopicSelect} />)

    expect(screen.queryByText('Messages')).not.toBeInTheDocument()
    expect(screen.queryByText('消息')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Alpha topic'))

    expect(onTopicSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'topic-alpha',
        name: 'Alpha topic',
        messages: [],
        pinned: false
      })
    )
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(hookMocks.useSessions).not.toHaveBeenCalled()
    expect(hookMocks.useAgents).not.toHaveBeenCalled()
  })

  it('renders the animated overlay shell from the trigger origin', () => {
    hookMocks.useAllTopics.mockReturnValue({ topics: [createTopic()], error: undefined, isLoading: false })
    hookMocks.useAssistants.mockReturnValue({ assistants: [createAssistant()] })

    const portalRoot = document.getElementById('home-page')
    vi.spyOn(portalRoot!, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 1200,
      height: 800
    } as DOMRect)

    render(
      <HistoryRecordsPage
        mode="assistant"
        open
        origin={createTestDomRect({ x: 20, y: 30, width: 20, height: 20 })}
        onClose={vi.fn()}
        onTopicSelect={vi.fn()}
      />
    )

    expect(screen.getByTestId('history-records-page-motion')).toBeInTheDocument()
  })

  it('keeps the overlay mounted long enough for the close animation', () => {
    hookMocks.useAllTopics.mockReturnValue({ topics: [createTopic()], error: undefined, isLoading: false })
    hookMocks.useAssistants.mockReturnValue({ assistants: [createAssistant()] })

    const props = {
      mode: 'assistant' as const,
      origin: createTestDomRect({ x: 20, y: 30, width: 20, height: 20 }),
      onClose: vi.fn(),
      onTopicSelect: vi.fn()
    }

    const { rerender } = render(<HistoryRecordsPage {...props} open />)
    expect(screen.getByTestId('history-records-page-motion')).toBeInTheDocument()

    rerender(<HistoryRecordsPage {...props} open={false} />)
    expect(screen.getByTestId('history-records-page-motion')).toBeInTheDocument()
  })

  it('renders the external topic context menu for history rows', () => {
    hookMocks.useAllTopics.mockReturnValue({
      topics: [createTopic(), createTopic({ id: 'topic-beta', name: 'Beta topic' })],
      error: undefined,
      isLoading: false
    })
    hookMocks.useAssistants.mockReturnValue({ assistants: [createAssistant()] })

    render(<HistoryRecordsPage mode="assistant" open onClose={vi.fn()} onTopicSelect={vi.fn()} />)

    const alphaMenu = screen.getByText('Alpha topic').closest('[data-testid="context-menu"]')
    const menuContent = alphaMenu?.querySelector('[data-testid="context-menu-content"]')

    expect(menuContent ?? null).toBeInTheDocument()
    expect(menuContent).toHaveClass('z-[1001]')
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

  it('pins a topic from the history row context menu without selecting the row', () => {
    hookMocks.useAllTopics.mockReturnValue({ topics: [createTopic()], error: undefined, isLoading: false })
    hookMocks.useAssistants.mockReturnValue({ assistants: [createAssistant()] })
    const onClose = vi.fn()
    const onTopicSelect = vi.fn()

    render(<HistoryRecordsPage mode="assistant" open onClose={onClose} onTopicSelect={onTopicSelect} />)

    const alphaMenu = screen.getByText('Alpha topic').closest('[data-testid="context-menu"]')
    const menuContent = alphaMenu?.querySelector('[data-testid="context-menu-content"]')
    fireEvent.click(within(menuContent as HTMLElement).getByRole('button', { name: 'Pin Topic' }))

    expect(hookMocks.togglePin).toHaveBeenCalledWith('topic-alpha')
    expect(onTopicSelect).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('renames a topic from the history row context menu inline without selecting the row', async () => {
    hookMocks.useAllTopics.mockReturnValue({ topics: [createTopic()], error: undefined, isLoading: false })
    hookMocks.useAssistants.mockReturnValue({ assistants: [createAssistant()] })
    const onClose = vi.fn()
    const onTopicSelect = vi.fn()

    render(<HistoryRecordsPage mode="assistant" open onClose={onClose} onTopicSelect={onTopicSelect} />)

    const alphaMenu = screen.getByText('Alpha topic').closest('[data-testid="context-menu"]')
    const menuContent = alphaMenu?.querySelector('[data-testid="context-menu-content"]')
    fireEvent.click(within(menuContent as HTMLElement).getByRole('button', { name: 'Edit topic name' }))

    expect(hookMocks.promptShow).not.toHaveBeenCalled()
    expect(onTopicSelect).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()

    const input = screen.getByLabelText('Edit topic name')
    fireEvent.blur(input)
    await vi.waitFor(() => expect(input).toHaveFocus())
    expect(input.closest('[data-testid="history-topic-rename-field"]')).toHaveClass('focus-within:ring-2')
    fireEvent.change(input, { target: { value: 'Renamed topic' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await vi.waitFor(() =>
      expect(hookMocks.updateTopic).toHaveBeenCalledWith('topic-alpha', {
        name: 'Renamed topic',
        isNameManuallyEdited: true
      })
    )
  })

  it('does not persist empty or unchanged topic names from history inline rename', () => {
    hookMocks.useAllTopics.mockReturnValue({ topics: [createTopic()], error: undefined, isLoading: false })
    hookMocks.useAssistants.mockReturnValue({ assistants: [createAssistant()] })

    const { unmount } = render(<HistoryRecordsPage mode="assistant" open onClose={vi.fn()} onTopicSelect={vi.fn()} />)

    const alphaMenu = screen.getByText('Alpha topic').closest('[data-testid="context-menu"]')
    const menuContent = alphaMenu?.querySelector('[data-testid="context-menu-content"]')
    fireEvent.click(within(menuContent as HTMLElement).getByRole('button', { name: 'Edit topic name' }))
    fireEvent.change(screen.getByLabelText('Edit topic name'), { target: { value: '   ' } })
    fireEvent.blur(screen.getByLabelText('Edit topic name'))

    expect(hookMocks.updateTopic).not.toHaveBeenCalled()

    unmount()
    hookMocks.updateTopic.mockClear()
    render(<HistoryRecordsPage mode="assistant" open onClose={vi.fn()} onTopicSelect={vi.fn()} />)

    const nextAlphaMenu = screen.getByText('Alpha topic').closest('[data-testid="context-menu"]')
    const nextMenuContent = nextAlphaMenu?.querySelector('[data-testid="context-menu-content"]')
    fireEvent.click(within(nextMenuContent as HTMLElement).getByRole('button', { name: 'Edit topic name' }))
    fireEvent.change(screen.getByLabelText('Edit topic name'), { target: { value: 'Alpha topic' } })
    fireEvent.keyDown(screen.getByLabelText('Edit topic name'), { key: 'Enter' })

    expect(hookMocks.updateTopic).not.toHaveBeenCalled()
  })

  it('confirms topic deletion from the history row context menu', async () => {
    hookMocks.useAllTopics.mockReturnValue({
      topics: [createTopic(), createTopic({ id: 'topic-beta', name: 'Beta topic' })],
      error: undefined,
      isLoading: false
    })
    hookMocks.useAssistants.mockReturnValue({ assistants: [createAssistant()] })

    render(<HistoryRecordsPage mode="assistant" open onClose={vi.fn()} onTopicSelect={vi.fn()} />)

    const alphaMenu = screen.getByText('Alpha topic').closest('[data-testid="context-menu"]')
    const menuContent = alphaMenu?.querySelector('[data-testid="context-menu-content"]')
    fireEvent.click(within(menuContent as HTMLElement).getByRole('button', { name: 'Delete' }))

    expect(screen.getByRole('dialog')).toHaveTextContent('Delete Topics')
    expect(screen.getByRole('dialog')).toHaveClass('z-[1002]')
    expect(screen.getByRole('dialog')).toHaveAttribute('data-overlay-class', 'z-[1001]')
    expect(hookMocks.deleteTopic).not.toHaveBeenCalled()

    await act(async () => {
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }))
    })

    expect(hookMocks.deleteTopic).toHaveBeenCalledWith('topic-alpha')
  })
})

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
