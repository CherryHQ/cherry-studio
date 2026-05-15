import { defaultMessageMenuConfig, type MessageListActions } from '@renderer/components/chat/messages/types'
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

vi.mock('@renderer/utils/export', () => ({
  messageToMarkdown: vi.fn(),
  messageToPlainText: vi.fn(() => 'plain text')
}))

import type { MessageMenuBarActionContext } from '../messageMenuBarActions'
import {
  executeMessageMenuBarAction,
  resolveMessageMenuBarMenuActions,
  resolveMessageMenuBarToolbarActions,
  resolveMessageMenuBarTranslationItems
} from '../messageMenuBarActions'

const t = ((key: string) => key) as any

function createContext(overrides: Partial<MessageMenuBarActionContext> = {}): MessageMenuBarActionContext {
  const baseActions = {
    copyText: vi.fn(),
    copyImage: vi.fn(),
    notifySuccess: vi.fn(),
    notifyWarning: vi.fn(),
    notifyError: vi.fn()
  } as MessageListActions

  return {
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
    menuConfig: defaultMessageMenuConfig,
    copied: false,
    setCopied: vi.fn(),
    isAssistantMessage: true,
    isProcessing: false,
    isTranslating: false,
    hasTranslationBlocks: false,
    isUserMessage: false,
    isUseful: false,
    isEditable: true,
    translateLanguages: [],
    startEditingMessage: vi.fn(),
    t,
    ...overrides,
    actions: {
      ...baseActions,
      ...overrides.actions
    }
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
          renderRegenerateModelPicker: vi.fn(),
          translateMessage: vi.fn()
        } as MessageListActions,
        translateLanguages: [{ langCode: 'en', emoji: '🇺🇸', label: 'English' } as any],
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
          renderRegenerateModelPicker: vi.fn(),
          translateMessage: vi.fn()
        } as MessageListActions,
        translateLanguages: [{ langCode: 'en', emoji: '🇺🇸', label: 'English' } as any],
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
        menuConfig: {
          ...defaultMessageMenuConfig,
          exportMenuOptions: {
            ...defaultMessageMenuConfig.exportMenuOptions,
            markdown: true
          }
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

  it('resolves translation language items through the injected translate action', async () => {
    const translateMessage = vi.fn()
    const language = { langCode: 'fr', label: 'French' } as any
    const translationItems = resolveMessageMenuBarTranslationItems(
      createContext({
        actions: { translateMessage } as MessageListActions,
        translateLanguages: [language],
        getTranslationLanguageLabel: () => 'French'
      })
    )

    expect(translationItems).toHaveLength(1)
    expect(translationItems[0]).toMatchObject({ key: 'fr', label: 'French' })

    const item = translationItems[0]
    if (!item || 'type' in item) {
      throw new Error('Expected a translation action item')
    }

    await item.onSelect()

    expect(translateMessage).toHaveBeenCalledWith('message-1', language, 'hello')
  })

  it('keeps copy-translation item available without translate capability', () => {
    const translationItems = resolveMessageMenuBarTranslationItems(
      createContext({
        hasTranslationBlocks: true,
        messageParts: [{ type: 'data-translation', data: { content: 'translated text' } }] as any
      })
    )

    expect(translationItems.map((item) => item.key)).toEqual(['translate-copy'])
  })

  it('enables the translate toolbar action as abort while translation is running', () => {
    const toolbarActions = resolveMessageMenuBarToolbarActions(
      createContext({
        actions: { abortMessageTranslation: vi.fn() } as MessageListActions,
        isTranslating: true
      })
    )

    expect(toolbarActions.find((action) => action.id === 'translate')?.availability.enabled).toBe(true)
  })

  it('routes copy through the injected clipboard action', async () => {
    const copyText = vi.fn()
    const setCopied = vi.fn()
    const context = createContext({
      actions: { copyText } as MessageListActions,
      setCopied
    })

    await executeMessageMenuBarAction('copy', context)

    expect(copyText).toHaveBeenCalledWith('hello', { successMessage: 'message.copied' })
    expect(setCopied).toHaveBeenCalledWith(true)
  })
})
