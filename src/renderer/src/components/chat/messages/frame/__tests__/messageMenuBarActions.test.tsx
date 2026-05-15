import type { MessageListActions } from '@renderer/components/chat/messages/types'
import { DEFAULT_MESSAGE_MENUBAR_BUTTON_IDS, getMessageMenuBarConfig } from '@renderer/config/registry/messageMenuBar'
import { TopicType } from '@renderer/types'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@renderer/services/MessagesService', () => ({
  getMessageTitle: vi.fn()
}))

vi.mock('@renderer/components/Popups/InspectMessagePopup', () => ({
  default: {
    show: vi.fn()
  }
}))

vi.mock('@renderer/trace/pages/Component', () => ({
  TraceIcon: () => null
}))

vi.mock('@renderer/utils/copy', () => ({
  copyMessageAsPlainText: vi.fn()
}))

vi.mock('@renderer/utils/export', () => ({
  messageToMarkdown: vi.fn()
}))

import type { MessageMenuBarActionContext } from '../messageMenuBarActions'
import { resolveMessageMenuBarMenuActions, resolveMessageMenuBarToolbarActions } from '../messageMenuBarActions'

const t = ((key: string) => key) as any

function createContext(overrides: Partial<MessageMenuBarActionContext> = {}): MessageMenuBarActionContext {
  const actions = {} as MessageListActions

  return {
    actions,
    message: {
      id: 'message-1',
      role: 'assistant',
      topicId: 'topic-1',
      parentId: 'parent-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      status: 'success'
    },
    messageParts: [],
    messageForExport: {
      id: 'message-1',
      role: 'assistant',
      topicId: 'topic-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      status: 'success',
      parts: []
    } as any,
    messageContainerRef: { current: null } as any,
    mainTextContent: 'hello',
    toolbarButtonIds: new Set(DEFAULT_MESSAGE_MENUBAR_BUTTON_IDS),
    exportMenuOptions: {
      image: false,
      markdown: false,
      markdown_reason: false,
      notion: false,
      yuque: false,
      joplin: false,
      obsidian: false,
      siyuan: false,
      docx: false,
      plain_text: false
    },
    confirmDeleteMessage: false,
    confirmRegenerateMessage: false,
    copied: false,
    setCopied: vi.fn(),
    enableDeveloperMode: false,
    isAssistantMessage: true,
    isProcessing: false,
    isUserMessage: false,
    isUseful: false,
    isEditable: true,
    startEditing: vi.fn(),
    abortTranslation: vi.fn(),
    t,
    ...overrides
  }
}

describe('messageMenuBarActions', () => {
  it('keeps write actions hidden when capabilities are absent', () => {
    const toolbarActions = resolveMessageMenuBarToolbarActions(
      createContext({
        message: {
          id: 'message-1',
          role: 'user',
          topicId: 'topic-1',
          parentId: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          status: 'success'
        },
        isAssistantMessage: false,
        isUserMessage: true
      })
    )

    expect(toolbarActions.map((action) => action.id)).toEqual(['copy'])
  })

  it('resolves assistant toolbar actions from capabilities', () => {
    const toolbarActions = resolveMessageMenuBarToolbarActions(
      createContext({
        actions: {
          deleteMessage: vi.fn(),
          exportToNotes: vi.fn(),
          regenerateMessage: vi.fn(),
          regenerateMessageWithModel: vi.fn(),
          getTranslationUpdater: vi.fn()
        } as MessageListActions,
        isGrouped: true
      })
    )

    expect(toolbarActions.map((action) => action.id)).toEqual([
      'copy',
      'assistant-regenerate',
      'assistant-mention-model',
      'translate',
      'useful',
      'notes',
      'delete',
      'more-menu'
    ])
  })

  it('keeps session scope capability-driven for toolbar actions', () => {
    const sessionConfig = getMessageMenuBarConfig(TopicType.Session)
    const toolbarActions = resolveMessageMenuBarToolbarActions(
      createContext({
        actions: {
          deleteMessage: vi.fn(),
          exportToNotes: vi.fn(),
          regenerateMessage: vi.fn(),
          regenerateMessageWithModel: vi.fn(),
          getTranslationUpdater: vi.fn()
        } as MessageListActions,
        toolbarButtonIds: new Set(sessionConfig.buttonIds)
      })
    )

    expect(toolbarActions.map((action) => action.id)).toEqual([
      'copy',
      'assistant-regenerate',
      'assistant-mention-model',
      'translate',
      'notes',
      'delete',
      'more-menu'
    ])
  })

  it('keeps menu actions capability-driven instead of filtering by session roots', () => {
    const menuActions = resolveMessageMenuBarMenuActions(
      createContext({
        actions: {
          exportMessageAsMarkdown: vi.fn(),
          saveTextFile: vi.fn(),
          startMessageBranch: vi.fn(),
          toggleMultiSelectMode: vi.fn()
        } as MessageListActions,
        selection: {
          enabled: true,
          isMultiSelectMode: false,
          selectedMessageIds: []
        },
        exportMenuOptions: {
          image: false,
          markdown: true,
          markdown_reason: false,
          notion: false,
          yuque: false,
          joplin: false,
          obsidian: false,
          siyuan: false,
          docx: false,
          plain_text: false
        }
      })
    )

    expect(menuActions.map((action) => action.id)).toEqual(['new-branch', 'multi-select', 'save', 'export'])
    expect(menuActions[2]?.children.map((action) => action.id)).toEqual(['save.file'])
    expect(menuActions[3]?.children.map((action) => action.id)).toEqual(['export.markdown'])
  })

  it('disables streaming-unsafe toolbar actions while keeping copy enabled', () => {
    const toolbarActions = resolveMessageMenuBarToolbarActions(
      createContext({
        actions: {
          deleteMessage: vi.fn(),
          regenerateMessage: vi.fn()
        } as MessageListActions,
        isProcessing: true
      })
    )

    expect(toolbarActions.find((action) => action.id === 'copy')?.availability.enabled).toBe(true)
    expect(toolbarActions.find((action) => action.id === 'assistant-regenerate')?.availability.enabled).toBe(false)
    expect(toolbarActions.find((action) => action.id === 'delete')?.availability.enabled).toBe(false)
  })
})
